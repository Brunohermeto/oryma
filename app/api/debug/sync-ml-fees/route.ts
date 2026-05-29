/**
 * POST /api/debug/sync-ml-fees
 *
 * Busca fee_details de cada pedido ML individualmente para preencher:
 *   - marketplace_commission  (comissão ml_fee)
 *   - marketplace_shipping_fee (frete cobrado ao vendedor)
 *   - rebate                  (descontos/cashback negativos)
 *
 * A API de busca em massa (/orders/search) não retorna fee_details.
 * Este endpoint faz backfill chamando /orders/{id} para cada venda.
 *
 * Body: { batch: 25, offset: 0 }
 *   - batch: quantas vendas processar por chamada (default 25)
 *   - offset: paginação (default 0) — incrementar para processar tudo
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { mlGet } from '@/lib/integrations/mercado-livre'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface MLFeeDetail {
  type: string
  amount?: number
  fee_amount?: number
}

interface MLOrderDetail {
  id: number
  fee_details?: MLFeeDetail[]
  order_items?: Array<{ sale_fee?: number; unit_price: number; quantity: number }>
  payments?: Array<{ marketplace_fee?: number; shipping_cost?: number }>
  shipping?: { cost?: number; receiver_address?: { cost?: number } }
}

function extractFromFeeDetails(feeDetails: MLFeeDetail[]) {
  let commission  = 0
  let shipping    = 0
  let rebate      = 0

  for (const fee of feeDetails) {
    const amount = Number(fee.amount ?? fee.fee_amount ?? 0)
    const type   = (fee.type ?? '').toLowerCase()

    if (type === 'ml_fee') {
      commission = Math.abs(amount)
    } else if (
      type.includes('shipping') ||
      type.includes('carrier')  ||
      type.includes('logistic') ||
      type === 'fulfillment'
    ) {
      if (amount > 0) shipping += amount
    } else if (amount < 0) {
      // Valores negativos = rebates / descontos devolvidos ao vendedor
      rebate += Math.abs(amount)
    }
  }

  return { commission, shipping, rebate }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db   = createSupabaseServiceClient()
  const body = await request.json().catch(() => ({}))
  const batchSize = Math.min(Number(body.batch ?? 25), 40)
  const offset    = Number(body.offset ?? 0)

  // Busca vendas ML com frete=0 E rebate=0 (provavelmente não preenchidas)
  // Ordena por mais recentes primeiro
  const { data: sales, error: salesErr } = await db
    .from('sales')
    .select('id, external_order_id, sku, marketplace_commission, marketplace_shipping_fee, rebate')
    .eq('marketplace', 'mercado_livre')
    .eq('marketplace_shipping_fee', 0)
    .order('sale_date', { ascending: false })
    .range(offset, offset + batchSize - 1)

  if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })
  if (!sales?.length) {
    return NextResponse.json({
      ok: true, fixed: 0, total_processed: 0,
      message: 'Nenhuma venda ML com frete=0 encontrada neste offset',
    })
  }

  let fixed  = 0
  let errors = 0
  const log: string[] = [`Processando ${sales.length} vendas (offset ${offset})`]

  for (const sale of sales) {
    const match = sale.external_order_id?.match(/^ml_(\d+)_/)
    if (!match) { log.push(`SKIP ${sale.id.slice(-8)}: formato inválido`); continue }

    const orderId = match[1]

    try {
      await sleep(180)

      const order = await mlGet<MLOrderDetail>(`/orders/${orderId}`)

      let commission = Number(sale.marketplace_commission ?? 0)
      let shipping   = 0
      let rebate     = 0

      if (order.fee_details?.length) {
        const extracted = extractFromFeeDetails(order.fee_details)
        commission = extracted.commission || commission   // mantém se já tinha valor
        shipping   = extracted.shipping
        rebate     = extracted.rebate
      } else {
        // Fallback: sale_fee do item para comissão
        if (commission === 0 && order.order_items?.length) {
          commission = order.order_items.reduce((s, i) => s + Number(i.sale_fee ?? 0), 0)
        }
        // Fallback: shipping do pagamento
        if (order.payments?.[0]?.shipping_cost) {
          shipping = Math.abs(Number(order.payments[0].shipping_cost))
        }
      }

      const updates: Record<string, number> = {}
      if (commission > 0) updates.marketplace_commission  = commission
      if (shipping   > 0) updates.marketplace_shipping_fee = shipping
      if (rebate     > 0) updates.rebate                  = rebate

      if (Object.keys(updates).length === 0) {
        log.push(`- ${sale.sku?.slice(0,10)} ${sale.id.slice(-8)}: sem dados em fee_details`)
        continue
      }

      const { error: updErr } = await db
        .from('sales')
        .update(updates)
        .eq('id', sale.id)

      if (updErr) {
        log.push(`ERRO ${sale.id.slice(-8)}: ${updErr.message}`)
        errors++
      } else {
        log.push(`✓ ${sale.sku?.slice(0,10)} ${sale.id.slice(-8)}: comissão=${commission.toFixed(2)} frete=${shipping.toFixed(2)} rebate=${rebate.toFixed(2)}`)
        fixed++
      }

    } catch (err) {
      log.push(`ERRO ${sale.id.slice(-8)}: ${String(err).slice(0, 60)}`)
      errors++
    }
  }

  return NextResponse.json({
    ok: errors === 0,
    fixed,
    errors,
    total_processed: sales.length,
    next_offset: offset + batchSize,
    has_more: sales.length === batchSize,
    message: `${fixed} vendas atualizadas de ${sales.length} processadas`,
    log,
  })
}
