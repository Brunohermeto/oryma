/**
 * POST /api/debug/fix-commission
 * Corrige comissão de vendas onde marketplace_commission < threshold.
 * Busca cada pedido individualmente no ML para obter fee_details correto.
 * Processa em lotes de 20 para evitar timeout.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { mlGet } from '@/lib/integrations/mercado-livre'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface MLOrderDetail {
  id: number
  fee_details?: Array<{ type: string; amount: number; fee_amount?: number }>
  order_items?: Array<{ item: { seller_sku?: string }; sale_fee?: number; unit_price: number; quantity: number }>
  payments?: Array<{ marketplace_fee?: number }>
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const body = await request.json().catch(() => ({}))
  const batchSize  = Number(body.batch ?? 20)
  const maxCommission = Number(body.max_commission ?? 5)  // vendas com comissão < R$5 são suspeitas

  // Busca vendas ML com comissão suspeita (< threshold)
  const { data: sales, error: salesErr } = await db
    .from('sales')
    .select('id, external_order_id, sku, gross_price, marketplace_commission')
    .eq('marketplace', 'mercado_livre')
    .lt('marketplace_commission', maxCommission)
    .order('id', { ascending: false })
    .limit(batchSize)

  if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })
  if (!sales?.length) return NextResponse.json({ ok: true, message: 'Nenhuma venda com comissão suspeita encontrada', fixed: 0 })

  const log: string[] = [`${sales.length} vendas com comissão < R$${maxCommission}`]
  let fixed = 0
  let errors = 0

  for (const sale of sales) {
    // external_order_id formato: ml_{order_id}_{item_id}
    const match = sale.external_order_id?.match(/^ml_(\d+)_/)
    if (!match) { log.push(`SKIP ${sale.id.slice(-8)}: formato inválido`); continue }

    const orderId = match[1]

    try {
      await sleep(200) // rate limit

      const order = await mlGet<MLOrderDetail>(`/orders/${orderId}`)

      // Extrai comissão de fee_details (ml_fee = taxa de venda)
      let commission = 0
      if (order.fee_details?.length) {
        const mlFee = order.fee_details.find(f => f.type === 'ml_fee')
        if (mlFee) commission = Math.abs(Number(mlFee.amount ?? mlFee.fee_amount ?? 0))
      }

      // Fallback: sale_fee do item
      if (commission === 0 && order.order_items?.length) {
        commission = order.order_items.reduce((s, i) => s + Number(i.sale_fee ?? 0), 0)
      }

      // Fallback: marketplace_fee do pagamento
      if (commission === 0 && order.payments?.length) {
        commission = Math.abs(Number(order.payments[0].marketplace_fee ?? 0))
      }

      if (commission > 0 && commission !== sale.marketplace_commission) {
        const { error: updateErr } = await db
          .from('sales')
          .update({ marketplace_commission: commission })
          .eq('id', sale.id)

        if (updateErr) {
          log.push(`ERRO ${sale.id.slice(-8)}: ${updateErr.message}`)
          errors++
        } else {
          log.push(`✓ ${sale.sku} ${sale.id.slice(-8)}: ${sale.marketplace_commission} → ${commission.toFixed(2)}`)
          fixed++
        }
      } else {
        log.push(`- ${sale.sku} ${sale.id.slice(-8)}: comissão=${commission} (sem mudança)`)
      }
    } catch (err) {
      log.push(`ERRO ${sale.id.slice(-8)}: ${String(err)}`)
      errors++
    }
  }

  return NextResponse.json({
    ok: errors === 0,
    fixed,
    errors,
    total_processed: sales.length,
    message: `${fixed} comissões corrigidas de ${sales.length} processadas`,
    log,
  })
}
