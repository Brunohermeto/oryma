/**
 * POST /api/sync/shopee/costs?days=15
 *
 * Reprocessa o financeiro (escrow) das vendas Shopee recentes. O sync normal só
 * relê 2 dias, mas a Shopee finaliza comissão/serviço (e o ajuste de ação
 * comercial que vira a LÍQUIDA) alguns dias depois da venda. Este passo pega os
 * pedidos que ainda estão com custo provisório/zerado e atualiza:
 *   comissão líquida (ou bruta provisória) · serviço líquido · frete = 0 (neutro).
 */
import { NextRequest, NextResponse } from 'next/server'
import { shopeeGet } from '@/lib/integrations/shopee'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days  = Number(request.nextUrl.searchParams.get('days') ?? 15)
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 120)
  const db = createSupabaseServiceClient()
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

  const { data: sales } = await db.from('sales')
    .select('id, external_order_id, gross_price, marketplace_commission')
    .eq('marketplace', 'shopee').gte('sale_date', since)

  // agrupa por pedido; prioriza os que ainda estão SEM comissão
  const byOrder = new Map<string, Array<{ id: string; gross_price: number; hasComm: boolean }>>()
  for (const s of sales ?? []) {
    const sn = s.external_order_id.replace(/^shopee_/, '').split('_')[0]
    if (!byOrder.has(sn)) byOrder.set(sn, [])
    byOrder.get(sn)!.push({ id: s.id, gross_price: Number(s.gross_price), hasComm: Number(s.marketplace_commission) > 0 })
  }
  const fila = [...byOrder.entries()].sort((a, b) =>
    Number(a[1].every(x => x.hasComm)) - Number(b[1].every(x => x.hasComm)))

  let processed = 0, updated = 0
  for (const [sn, items] of fila) {
    if (processed >= limit) break
    processed++
    await sleep(250)
    let inc: Record<string, number> | undefined
    try {
      const esc = await shopeeGet<{ response?: { order_income?: Record<string, number> } }>(
        '/payment/get_escrow_detail', { order_sn: sn })
      inc = esc.response?.order_income
    } catch { continue }
    if (!inc) continue
    const comm = ((Number(inc.net_commission_fee) > 0 ? inc.net_commission_fee : inc.commission_fee) ?? 0)
    const serv = ((Number(inc.net_service_fee) > 0 ? inc.net_service_fee : inc.service_fee) ?? 0)
    const cupom = (Number(inc.voucher_from_seller ?? 0) + Number(inc.voucher_from_shopee ?? 0))
    if (comm <= 0) continue // financeiro ainda não liberado
    const total = items.reduce((a, x) => a + x.gross_price, 0)
    for (const it of items) {
      const share = total > 0 ? it.gross_price / total : 1 / items.length
      const { error } = await db.from('sales').update({
        marketplace_commission: Math.round(comm * share * 100) / 100,
        marketplace_fixed_fee: Math.round(serv * share * 100) / 100,
        marketplace_shipping_fee: 0,
        discounts: Math.round(cupom * share * 100) / 100,
      }).eq('id', it.id)
      if (!error) updated++
    }
  }

  return NextResponse.json({ ok: true, processed, updated, pedidos: byOrder.size })
}
