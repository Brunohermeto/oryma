/**
 * POST /api/sync/ml/shipping
 *
 * Enriquecimento: busca frete real do vendedor (e rebate) para vendas ML
 * que estão com marketplace_shipping_fee = 0.
 *
 * Processa poucos pedidos por chamada (padrão das rotas de NF-e) para não
 * estourar o timeout do Vercel — o chamador repete até remaining = 0.
 *
 * Fontes, em ordem:
 *   1. /orders/{id} → fee_details (frete tipo shipping/envios, rebate = valores negativos)
 *   2. /shipments/{shipping.id}/costs → senders_real_cost / sender_cost
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface MLFeeDetail { type?: string; amount?: number; fee_amount?: number }

function isShippingFee(type: string): boolean {
  return type.includes('shipping') || type.includes('envios') || type.includes('frete') ||
    ['mercadoenvios', 'mercadoenvios_ml', 'carrier_fee', 'logistic', 'fulfillment'].includes(type)
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body  = await request.json().catch(() => ({}))
  const days  = Number(body.days ?? 45)
  const limit = Number(body.limit ?? 12)
  // Pedidos já tentados nesta sessão cujo frete veio 0 — evita reprocessar para sempre
  const skip  = new Set<string>(Array.isArray(body.skip) ? body.skip : [])

  const db = createSupabaseServiceClient()

  // Vendas ML sem frete, agrupadas por pedido
  const { data: rows } = await db.from('sales')
    .select('id, external_order_id, gross_price')
    .eq('marketplace', 'mercado_livre')
    .eq('marketplace_shipping_fee', 0)
    .gte('sale_date', brazilDaysAgo(days))
    .order('sale_date', { ascending: false })
    .limit(500)

  const orders = new Map<string, { saleIds: string[]; prices: number[] }>()
  for (const r of rows ?? []) {
    const orderId = r.external_order_id?.match(/^ml_(\d+)_/)?.[1]
    if (!orderId || skip.has(orderId)) continue
    if (!orders.has(orderId)) orders.set(orderId, { saleIds: [], prices: [] })
    orders.get(orderId)!.saleIds.push(r.id)
    orders.get(orderId)!.prices.push(Number(r.gross_price ?? 0))
  }

  const batch = [...orders.entries()].slice(0, limit)
  let updated = 0
  let sampleFees: unknown = null
  const errors: string[] = []

  for (const [orderId, order] of batch) {
    try {
      await sleep(200)
      const detail = await mlGet<{
        fee_details?: MLFeeDetail[]
        shipping?: { id?: number }
      }>(`/orders/${orderId}`)

      if (!sampleFees && detail.fee_details?.length) sampleFees = detail.fee_details

      let shipping = 0
      let rebate   = 0
      for (const fee of detail.fee_details ?? []) {
        const amount = Number(fee.amount ?? fee.fee_amount ?? 0)
        const type   = (fee.type ?? '').toLowerCase()
        if (amount > 0 && isShippingFee(type)) shipping += amount
        else if (amount < 0) rebate += Math.abs(amount)
      }

      // logistic_type só existe no shipment (não vem em /orders) — é a única
      // forma confiável de saber se a venda é Full (NF-e emitida pelo ML)
      let fulfillment: string | null = null
      if (detail.shipping?.id) {
        await sleep(150)
        const shipment = await mlGet<{ logistic_type?: string }>(
          `/shipments/${detail.shipping.id}`
        ).catch(() => null)
        if (shipment?.logistic_type) {
          fulfillment = shipment.logistic_type === 'fulfillment' ? 'full_ml' : 'galpao'
        }

        if (shipping === 0) {
          await sleep(150)
          const costs = await mlGet<{ senders_real_cost?: number; sender_cost?: number }>(
            `/shipments/${detail.shipping.id}/costs`
          ).catch(() => null)
          shipping = Number(costs?.senders_real_cost ?? 0) || Number(costs?.sender_cost ?? 0)
        }
      }

      const total = order.prices.reduce((s, p) => s + p, 0)
      const n     = order.saleIds.length
      for (let i = 0; i < n; i++) {
        const share  = total > 0 ? order.prices[i] / total : 1 / n
        const fields: Record<string, number | string> = {}
        if (shipping > 0) fields.marketplace_shipping_fee = shipping * share
        if (rebate   > 0) fields.rebate = rebate * share
        if (fulfillment)  fields.fulfillment_type = fulfillment
        if (!Object.keys(fields).length) continue
        const { error } = await db.from('sales').update(fields).eq('id', order.saleIds[i])
        if (error) throw new Error(error.message)
        updated++
      }
    } catch (err) {
      errors.push(`${orderId}: ${String(err).slice(0, 120)}`)
    }
  }

  return NextResponse.json({
    ok: true,
    processed_orders: batch.length,
    processed_ids: batch.map(([id]) => id),
    sales_updated: updated,
    remaining_orders: orders.size - batch.length,
    sample_fee_details: sampleFees,
    errors,
  })
}
