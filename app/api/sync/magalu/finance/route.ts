/**
 * POST /api/sync/magalu/finance — repasse financeiro da Magalu por venda.
 *
 * Fonte: /seller/v1/financial-analysis/orders (só pedidos Delivered/Canceled,
 * janela máxima de 15 dias). Grava por item (regras canônicas):
 *  - rebate  = CRÉDITOS de PROMOTION (reembolso da Magalu em campanha
 *    coparticipada — o "estorno" deles; soma positivo na margem)
 *  - marketplace_shipping_fee = coparticipação de frete (SHIPPING_SHARE, em
 *    /transactions); SHIPPING_COST é o frete do comprador — não é custo nosso
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
  // ?from=&to= (YYYY-MM-DD, até 15 dias — limite da API): backfill do histórico;
  // sem eles, os últimos `days` dias (ciclo diário)
  const qFrom = request.nextUrl.searchParams.get('from')
  const qTo   = request.nextUrl.searchParams.get('to')
  const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const gte = isDate(qFrom) ? qFrom : new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  const lte = isDate(qTo) ? qTo : new Date().toISOString().slice(0, 10)

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

      // SHIPPING_COST do pedido = frete que o COMPRADOR pagou e a Magalu Entregas
      // retém — passa direto, não é custo nosso (29/10/2026: pedido
      // 1542770112937123 cobrava R$ 199,90 indevidos). O custo de frete real é a
      // coparticipação, que vem à parte (abaixo).
      const bySku = new Map<string, number>()
      for (const tx of order.transactions ?? []) {
        const sku = tx.entity?.extras?.sku ?? tx.entity?.id
        if (!sku || tx.category !== 'PROMOTION' || tx.type !== 'CREDIT') continue
        bySku.set(sku, (bySku.get(sku) ?? 0) + (tx.value ?? 0) / (tx.normalizer ?? 100))
      }
      for (const [sku, rebate] of bySku) {
        const { data } = await db.from('sales').update({ rebate })
          .eq('external_order_id', `magalu_${code}_${sku}`).select('id')
        if (data?.length) updated++
      }
    }
    if (results.length < 50) break
  }

  // Coparticipação de frete (SHIPPING_SHARE): lançamento SEPARADO do pedido, só em
  // /transactions (por data de criação, 1–23 dias após a venda) — é o "Coparticipação
  // de frete" do extrato. Vale para galpão E Full. Existe na API a partir de jul/26.
  const copart = new Map<string, number>()
  for (let offset = 0; offset < 5000; offset += 100) {
    const res = await magaluGet<{ results?: Array<{ category?: string; type?: string; value?: number; normalizer?: number; order_id?: string }> }>(
      '/seller/v1/financial-analysis/transactions', {
        created_at__gte: gte, created_at__lte: `${lte}T23:59:59Z`, _limit: '100', _offset: String(offset),
      })
    const rs = res.results ?? []
    for (const t of rs) {
      if (t.category !== 'SHIPPING_SHARE' || !t.order_id) continue
      const v = (t.value ?? 0) / (t.normalizer ?? 100)
      copart.set(t.order_id, (copart.get(t.order_id) ?? 0) + (t.type === 'DEBIT' ? v : -v))
    }
    if (rs.length < 100) break
  }
  let copartGravados = 0
  for (const [code, total] of copart) {
    const { data: linhas } = await db.from('sales').select('id, gross_price').like('external_order_id', `magalu_${code}_%`)
    const soma = (linhas ?? []).reduce((s, l) => s + Number(l.gross_price), 0)
    for (const l of linhas ?? []) {
      const share = soma > 0 ? Number(l.gross_price) / soma : 1 / linhas!.length
      await db.from('sales').update({ marketplace_shipping_fee: Math.round(Math.max(total, 0) * share * 100) / 100 }).eq('id', l.id)
      copartGravados++
    }
  }

  return NextResponse.json({ ok: true, orders, updated, coparticipacao: copartGravados, window: `${gte}..${lte}` })
}
