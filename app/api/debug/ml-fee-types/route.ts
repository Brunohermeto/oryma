/**
 * GET /api/debug/ml-fee-types
 * Busca os fee_details de uma amostra de pedidos ML para ver
 * quais tipos (type) existem. Ajuda a diagnosticar por que
 * frete, rebate ou comissão não são extraídos corretamente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { mlGet } from '@/lib/integrations/mercado-livre'

export const dynamic     = 'force-dynamic'
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // Pega 5 vendas ML de ~30 dias atrás (liquidadas — fee_details disponível após entrega+8 dias)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10)
  const { data: sales } = await db
    .from('sales')
    .select('id, external_order_id, sku, gross_price, marketplace_commission, marketplace_shipping_fee, rebate, sale_date')
    .eq('marketplace', 'mercado_livre')
    .gte('sale_date', thirtyDaysAgo)
    .lte('sale_date', fifteenDaysAgo)  // entre 15 e 30 dias atrás (certamente liquidadas)
    .order('sale_date', { ascending: false })
    .limit(5)

  const results = []

  for (const sale of sales ?? []) {
    const match = sale.external_order_id?.match(/^ml_(\d+)_/)
    if (!match) continue

    await sleep(200)
    try {
      // Testa tanto /orders/{id} quanto /payments/{payment_id}
      const order = await mlGet<{
        id: number
        fee_details?: Array<{ type: string; amount?: number; fee_amount?: number }>
        payments?: Array<{ id: number; marketplace_fee?: number; shipping_cost?: number; coupon_amount?: number; status?: string }>
      }>(`/orders/${match[1]}`)

      const paymentId = order.payments?.[0]?.id
      let paymentDetail: Record<string, unknown> | null = null
      let releaseDetail: unknown[] = []

      // Tenta buscar o detalhe do pagamento
      if (paymentId) {
        await sleep(200)
        try {
          paymentDetail = await mlGet<Record<string, unknown>>(`/payments/${paymentId}`)
        } catch { paymentDetail = null }
      }

      // Tenta buscar movements/releases do pedido via conta do vendedor
      await sleep(200)
      try {
        const { data: mlCred } = await (await import('@/lib/integrations/credentials')).getCredential('mercado_livre') as any
        const sellerId = (mlCred?.extra as any)?.seller_id
        if (sellerId) {
          const movements = await mlGet<{ results?: unknown[] }>(
            `/users/${sellerId}/movements/listing`,
            { order_id: match[1], limit: '5' }
          ).catch(() => ({ results: [] }))
          releaseDetail = movements?.results ?? []
        }
      } catch { releaseDetail = [] }

      results.push({
        sale_id: sale.id.slice(-8),
        sku: sale.sku,
        sale_date: sale.sale_date,
        gross_price: sale.gross_price,
        stored: {
          commission: sale.marketplace_commission,
          shipping: sale.marketplace_shipping_fee,
          rebate: sale.rebate,
        },
        order_fee_details: order.fee_details ?? [],
        order_payments: order.payments ?? [],
        payment_detail: paymentDetail,
        movements_sample: releaseDetail?.slice?.(0, 3) ?? [],
      })
    } catch (e) {
      results.push({ sale_id: sale.id.slice(-8), error: String(e) })
    }
  }

  return NextResponse.json({ samples: results }, { status: 200 })
}
