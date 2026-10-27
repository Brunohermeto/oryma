/**
 * POST /api/sync/tiktok/fees?days=45&limit=30&offset=0
 * Extrato financeiro do TikTok por pedido (/finance/202309/orders/{id}/statement_transactions,
 * liberado depois da entrega) → comissão, frete/tarifas, devolução, rebate e repasse.
 * Ancorado no repasse real (settlement_amount), como a Shopee:
 *   bruto − devolução − comissão − tarifas + rebate = repasse
 * Pedido de exemplo 586292110929201092: 699 − 41,94 − 47,94 = 609,12 ✓
 */
import { NextRequest, NextResponse } from 'next/server'
import { tiktokApi } from '@/lib/integrations/tiktok'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

type Tx = Record<string, string | number | unknown>

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const days = Math.min(Number(sp.get('days') ?? 45), 365)
  const limit = Math.min(Number(sp.get('limit') ?? 30), 60)
  const offset = Number(sp.get('offset') ?? 0)
  const db = createSupabaseServiceClient()

  // pedidos ainda sem repasse registrado (o extrato só sai depois da entrega)
  const rows = await fetchAll<{ id: string; external_order_id: string; gross_price: number; payout_actual: number | null }>(() =>
    db.from('sales').select('id, external_order_id, gross_price, payout_actual').eq('marketplace', 'tiktok')
      .gte('sale_date', brazilDaysAgo(days)).is('payout_actual', null).order('id'))
  const pedidos = new Map<string, typeof rows>()
  for (const r of rows) { const o = r.external_order_id.split('_')[1]; if (!pedidos.has(o)) pedidos.set(o, []); pedidos.get(o)!.push(r) }
  const fila = [...pedidos.entries()].slice(offset, offset + limit)

  const n = (t: Tx, k: string) => Number(t[k] ?? 0)
  let processed = 0, updated = 0, semExtrato = 0, falhas = 0
  const erros: string[] = []
  for (let i = 0; i < fila.length; i += 5) {
    await Promise.all(fila.slice(i, i + 5).map(async ([id, itens]) => {
      processed++
      try {
        const d = await tiktokApi<{ statement_transactions?: Tx[] }>('GET', `/finance/202309/orders/${id}/statement_transactions`)
        const txs = d.statement_transactions ?? []
        if (!txs.length) { semExtrato++; return }
        const soma = (k: string) => txs.reduce((s, t) => s + n(t, k), 0)
        const repasse = soma('settlement_amount')
        const comissao = -soma('platform_commission_amount')
        // devolução = receita estornada (bruto estornado + desconto do vendedor estornado)
        const devolucao = Math.max(-(soma('gross_sales_refund_amount') + soma('seller_discount_refund_amount')), 0)
        const bruto = itens.reduce((s, x) => s + Number(x.gross_price), 0)
        const residuo = repasse - (bruto - devolucao - comissao)   // <0 = tarifas/frete; >0 = o TikTok devolveu (rebate)
        for (const x of itens) {
          const share = bruto > 0 ? Number(x.gross_price) / bruto : 1 / itens.length
          const r2 = (v: number) => Math.round(v * share * 100) / 100
          const { error } = await db.from('sales').update({
            marketplace_commission: r2(comissao), marketplace_fixed_fee: 0,
            marketplace_shipping_fee: r2(Math.max(-residuo, 0)), rebate: r2(Math.max(residuo, 0)),
            cancellation: r2(devolucao), payout_actual: r2(repasse),
          }).eq('id', x.id)
          if (!error) updated++
        }
      } catch (e) { falhas++; if (erros.length < 3) erros.push(`${id}: ${String(e).slice(0, 100)}`) }
    }))
  }
  // pulados = continuam na fila (sem extrato ainda ou erro): o chamador avança o offset só por eles
  return NextResponse.json({ ok: true, processed, updated, sem_extrato: semExtrato, pulados: semExtrato + falhas, pedidos: pedidos.size, erros })
}
