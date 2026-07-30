/**
 * POST /api/sync/magalu/finance — repasse financeiro da Magalu por venda.
 *
 * Fonte: /seller/v1/financial-analysis/orders (só pedidos Delivered/Canceled,
 * janela máxima de 15 dias). Grava por item (regras canônicas):
 *  - rebate  = CRÉDITOS de PROMOTION (reembolso da Magalu em campanha
 *    coparticipada — o "estorno" deles; soma positivo na margem)
 *  - marketplace_shipping_fee = DÉBITOS − CRÉDITOS de SHIPPING_COST
 *    (frete que a Magalu efetivamente cobra do seller)
 */
import { NextRequest, NextResponse } from 'next/server'
import { magaluGet } from '@/lib/integrations/magalu'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

interface FinanceOrdersResponse {
  results?: Array<{
    external_id?: string
    extras?: { order_code?: string }
    transactions?: Array<{
      type?: string
      category?: string
      value?: number
      normalizer?: number
      entity?: { id?: string; extras?: { sku?: string } }
    }>
  }>
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(Number(request.nextUrl.searchParams.get('days') ?? 14), 15)
  const db = createSupabaseServiceClient()
  const gte = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  const lte = new Date().toISOString().slice(0, 10)

  let updated = 0
  let orders = 0
  for (let offset = 0; offset < 2000; offset += 50) {
    const res = await magaluGet<FinanceOrdersResponse>('/seller/v1/financial-analysis/orders', {
      purchased_at__gte: gte, purchased_at__lte: lte,
      _limit: '50', _offset: String(offset),
    })
    const results = res.results ?? []
    for (const order of results) {
      orders++
      const code = order.extras?.order_code ?? order.external_id
      if (!code) continue

      const bySku = new Map<string, { rebate: number; freight: number }>()
      for (const tx of order.transactions ?? []) {
        const sku = tx.entity?.extras?.sku ?? tx.entity?.id
        if (!sku) continue
        const v = (tx.value ?? 0) / (tx.normalizer ?? 100)
        if (!bySku.has(sku)) bySku.set(sku, { rebate: 0, freight: 0 })
        const agg = bySku.get(sku)!
        if (tx.category === 'PROMOTION' && tx.type === 'CREDIT') agg.rebate += v
        if (tx.category === 'SHIPPING_COST') agg.freight += tx.type === 'DEBIT' ? v : -v
      }

      for (const [sku, agg] of bySku) {
        if (!agg.rebate && !agg.freight) continue
        const { data } = await db.from('sales').update({
          ...(agg.rebate > 0 ? { rebate: agg.rebate } : {}),
          ...(agg.freight > 0 ? { marketplace_shipping_fee: agg.freight } : {}),
        }).eq('external_order_id', `magalu_${code}_${sku}`).select('id')
        if (data?.length) updated++
      }
    }
    if (results.length < 50) break
  }

  return NextResponse.json({ ok: true, orders, updated, window: `${gte}..${lte}` })
}
