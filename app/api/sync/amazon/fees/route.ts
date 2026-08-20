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
      RefundEventList?: Array<{
        ShipmentItemAdjustmentList?: Array<{
          SellerSKU?: string
          ItemChargeAdjustmentList?: Array<{ ChargeType?: string; ChargeAmount?: { CurrencyAmount?: number } }>
          ItemFeeAdjustmentList?: Array<{ FeeType?: string; FeeAmount?: { CurrencyAmount?: number } }>
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

  // Fila: vendas do período — sem taxas ainda OU todas (p/ capturar devoluções tardias).
  // O painel da Amazon é líquido de devoluções; gravamos devolução em cancellation.
  const { data: sales } = await db.from('sales')
    .select('id, external_order_id, marketplace_commission, cancellation, rebate, sale_date')
    .eq('marketplace', 'amazon')
    .gte('sale_date', since)
    .order('sale_date', { ascending: true })

  // agrupa por pedido: external_order_id = amz_{orderId}_{SellerSKU cru}
  const byOrder = new Map<string, Array<{ id: string; external_order_id: string; marketplace_commission: number; cancellation: number; rebate: number }>>()
  for (const s of sales ?? []) {
    const orderId = s.external_order_id.split('_')[1]
    if (!byOrder.has(orderId)) byOrder.set(orderId, [])
    byOrder.get(orderId)!.push(s)
  }

  let processed = 0
  let updated = 0
  // prioridade: sem comissão primeiro e, entre eles, venda mais ANTIGA primeiro
  // (mais provável de já ter eventos publicados — evita re-verificar sempre os mesmos)
  const queue = [...byOrder.entries()].sort((a, b) =>
    Number(b[1].some(r => !Number(r.marketplace_commission))) - Number(a[1].some(r => !Number(r.marketplace_commission))))
  for (const [orderId, rows] of queue) {
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
        if (!row || Number(row.marketplace_commission) > 0) continue

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

    // Devoluções: painel da Amazon é líquido de devoluções — abatemos em cancellation.
    // Na devolução a Amazon ESTORNA as tarifas (Commission, AmazonForAllFee vêm
    // POSITIVAS) e cobra a administração do reembolso (RefundCommission vem
    // NEGATIVA): a soma crua já é o estorno líquido e vai para `rebate`, mantendo
    // a comissão bruta intacta (regra 1). Sem isso, tarifa devolvida continuava
    // debitada e a venda aparecia com margem de -97%.
    const refundBySku = new Map<string, number>()
    const rebateBySku = new Map<string, number>()
    for (const refund of ev.payload?.FinancialEvents?.RefundEventList ?? []) {
      for (const item of refund.ShipmentItemAdjustmentList ?? []) {
        if (!item.SellerSKU) continue
        const val = (item.ItemChargeAdjustmentList ?? [])
          .filter(c => c.ChargeType === 'Principal' || c.ChargeType === 'Tax')
          .reduce((s, c) => s + Math.abs(c.ChargeAmount?.CurrencyAmount ?? 0), 0)
        const feesBack = (item.ItemFeeAdjustmentList ?? [])
          .reduce((s, f) => s + (f.FeeAmount?.CurrencyAmount ?? 0), 0)
        if (val > 0)  refundBySku.set(item.SellerSKU, (refundBySku.get(item.SellerSKU) ?? 0) + val)
        if (feesBack) rebateBySku.set(item.SellerSKU, (rebateBySku.get(item.SellerSKU) ?? 0) + feesBack)
      }
    }
    for (const rawSku of new Set([...refundBySku.keys(), ...rebateBySku.keys()])) {
      const row = rows.find(r => r.external_order_id === `amz_${orderId}_${rawSku}`)
      if (!row) continue
      const cancellation = Math.round((refundBySku.get(rawSku) ?? 0) * 100) / 100
      const rebate       = Math.round((rebateBySku.get(rawSku) ?? 0) * 100) / 100
      if (Math.abs(Number(row.cancellation) - cancellation) < 0.01
       && Math.abs(Number(row.rebate ?? 0)  - rebate)       < 0.01) continue
      await db.from('sales').update({ cancellation, rebate }).eq('id', row.id)
      updated++
    }
  }

  // "pendentes" = pedidos que REALMENTE ainda estão sem comissão (não o tamanho
  // da janela). A maioria é lag normal da Amazon (publica o financeiro ~1-2 sem
  // após a venda) e se resolve sozinha; não é fila travada.
  const pendentes = [...byOrder.values()].filter(rows => rows.some(r => !Number(r.marketplace_commission))).length
  return NextResponse.json({ ok: true, processed, updated, pendentes_sem_comissao: pendentes, remaining: pendentes })
}
