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
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 40)
  const db = createSupabaseServiceClient()
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

  const { data: sales } = await db.from('sales')
    .select('id, external_order_id, gross_price, marketplace_commission, marketplace_fixed_fee, marketplace_shipping_fee, discounts, payout_actual')
    .eq('marketplace', 'shopee').gte('sale_date', since)

  // agrupa por pedido; prioriza os que ainda estão SEM comissão
  type Item = { id: string; gross_price: number; hasComm: boolean; comm: number; serv: number; ship: number; disc: number; pay: number | null }
  const byOrder = new Map<string, Array<Item>>()
  for (const s of sales ?? []) {
    const sn = s.external_order_id.replace(/^shopee_/, '').split('_')[0]
    if (!byOrder.has(sn)) byOrder.set(sn, [])
    byOrder.get(sn)!.push({
      id: s.id, gross_price: Number(s.gross_price), hasComm: Number(s.marketplace_commission) > 0,
      comm: Number(s.marketplace_commission ?? 0), serv: Number(s.marketplace_fixed_fee ?? 0),
      ship: Number(s.marketplace_shipping_fee ?? 0), disc: Number(s.discounts ?? 0),
      pay: s.payout_actual == null ? null : Number(s.payout_actual),
    })
  }
  // prioriza pedidos INCOMPLETOS: sem comissão OU sem repasse (payout_actual).
  // Assim o backfill histórico de repasse (pedidos que já têm comissão mas ainda
  // não têm o escrow gravado) também é alcançado, não só os pedidos novos.
  const completo = (its: Item[]) => its.every(x => x.hasComm && x.pay != null)
  const fila = [...byOrder.entries()].sort((a, b) =>
    Number(completo(a[1])) - Number(completo(b[1])))

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
    // repasse REAL da Shopee = escrow_amount (Renda estimada, o líquido que cai na conta)
    const escrow = Number(inc.escrow_amount ?? 0)
    if (comm <= 0) continue // financeiro ainda não liberado
    const total = items.reduce((a, x) => a + x.gross_price, 0)
    for (const it of items) {
      const share = total > 0 ? it.gross_price / total : 1 / items.length
      const nComm = Math.round(comm * share * 100) / 100
      const nServ = Math.round(serv * share * 100) / 100
      const nDisc = Math.round(cupom * share * 100) / 100
      const nPay  = escrow > 0 ? Math.round(escrow * share * 100) / 100 : null
      // só grava se algo mudou de verdade — assim o loop converge (updated=0 → para)
      // em vez de reescrever os mesmos valores toda rodada.
      if (it.comm === nComm && it.serv === nServ && it.ship === 0 && it.disc === nDisc && it.pay === nPay) continue
      const { error } = await db.from('sales').update({
        marketplace_commission: nComm,
        marketplace_fixed_fee: nServ,
        marketplace_shipping_fee: 0,
        discounts: nDisc,
        payout_actual: nPay,
      }).eq('id', it.id)
      if (!error) updated++
    }
  }

  return NextResponse.json({ ok: true, processed, updated, pedidos: byOrder.size })
}
