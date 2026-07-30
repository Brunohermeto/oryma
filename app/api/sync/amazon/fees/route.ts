/**
 * POST /api/sync/amazon/fees — taxas reais por venda via Finances API.
 *
 * Eventos financeiros só existem alguns dias após o envio; vendas sem comissão
 * continuam na fila e são retentadas no ciclo diário até os eventos aparecerem.
 *
 * Regras canônicas: Commission BRUTA em marketplace_commission; demais tarifas
 * (AmazonForAll, tecnologia) em marketplace_fixed_fee; frete FBA por unidade em
 * marketplace_shipping_fee; frete cobrado do cliente em shipping_received
 * (NUNCA receita); bruto = Principal + Tax (= valor da NF).
 */
import { NextRequest, NextResponse } from 'next/server'
import { amazonGet } from '@/lib/integrations/amazon'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface FinancialEventsResponse {
  payload?: {
    FinancialEvents?: {
      ShipmentEventList?: Array<{
        AmazonOrderId?: string
        ShipmentItemList?: Array<{
          SellerSKU?: string
          ItemChargeList?: Array<{ ChargeType?: string; ChargeAmount?: { CurrencyAmount?: number } }>
          ItemFeeList?: Array<{ FeeType?: string; FeeAmount?: { CurrencyAmount?: number } }>
          PromotionList?: Array<{ PromotionAmount?: { CurrencyAmount?: number } }>
        }>
      }>
    }
  }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days  = Number(request.nextUrl.searchParams.get('days') ?? 30)
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 15)
  const db = createSupabaseServiceClient()
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

  const { data: sales } = await db.from('sales')
    .select('id, external_order_id')
    .eq('marketplace', 'amazon')
    .eq('marketplace_commission', 0)
    .gte('sale_date', since)

  // agrupa por pedido: external_order_id = amz_{orderId}_{SellerSKU cru}
  const byOrder = new Map<string, Array<{ id: string; external_order_id: string }>>()
  for (const s of sales ?? []) {
    const orderId = s.external_order_id.split('_')[1]
    if (!byOrder.has(orderId)) byOrder.set(orderId, [])
    byOrder.get(orderId)!.push(s)
  }

  let processed = 0
  let updated = 0
  for (const [orderId, rows] of byOrder) {
    if (processed >= limit) break
    processed++
    await sleep(600) // Finances API: ~0.5 req/s

    let ev: FinancialEventsResponse
    try {
      ev = await amazonGet<FinancialEventsResponse>(`/finances/v0/orders/${orderId}/financialEvents`)
    } catch { continue }

    for (const ship of ev.payload?.FinancialEvents?.ShipmentEventList ?? []) {
      for (const item of ship.ShipmentItemList ?? []) {
        const row = rows.find(r => r.external_order_id === `amz_${orderId}_${item.SellerSKU}`)
        if (!row) continue

        const charge = (t: string) => item.ItemChargeList?.find(c => c.ChargeType === t)?.ChargeAmount?.CurrencyAmount ?? 0
        const fees = item.ItemFeeList ?? []
        const fee = (t: string) => Math.abs(fees.find(f => f.FeeType === t)?.FeeAmount?.CurrencyAmount ?? 0)
        // tudo que não é comissão/frete vira tarifa fixa (AmazonForAllFee, TechnologyFee…)
        const fixedFee = fees
          .filter(f => !['Commission', 'FBAPerUnitFulfillmentFee', 'ShippingChargeback', 'GiftwrapChargeback'].includes(f.FeeType ?? ''))
          .reduce((s, f) => s + Math.abs(f.FeeAmount?.CurrencyAmount ?? 0), 0)
        const promos = Math.abs((item.PromotionList ?? []).reduce((s, p) => s + (p.PromotionAmount?.CurrencyAmount ?? 0), 0))

        const gross = charge('Principal') + charge('Tax')
        await db.from('sales').update({
          ...(gross > 0 ? { gross_price: gross } : {}),
          shipping_received: charge('ShippingCharge') + charge('ShippingTax'),
          marketplace_commission: fee('Commission'),
          marketplace_fixed_fee: fixedFee,
          marketplace_shipping_fee: fee('FBAPerUnitFulfillmentFee'),
          discounts: promos,
        }).eq('id', row.id)
        updated++
      }
    }
  }

  return NextResponse.json({ ok: true, processed, updated, remaining: byOrder.size - processed })
}
