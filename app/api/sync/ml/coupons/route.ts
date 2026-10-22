/**
 * POST /api/sync/ml/coupons?from=AAAA-MM-DD&to=AAAA-MM-DD&limit=60
 * Cupom de cada pedido do ML (/orders/{id}/discounts) → sales.cupom_*.
 * Só pedidos ainda não conferidos (cupom_codigo NULL); o chamador repete até
 * processed=0. Ver lib/marketing/cupons.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { cupomML, type CampanhaML } from '@/lib/marketing/cupons'
import { brazilDaysAgo, brazilToday } from '@/lib/utils/brazil-time'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const from = sp.get('from') ?? brazilDaysAgo(5), to = sp.get('to') ?? brazilToday()
  const limit = Math.min(Number(sp.get('limit') ?? 60), 120)
  const db = createSupabaseServiceClient()

  const rows = await fetchAll<{ id: string; external_order_id: string; gross_price: number; sale_date: string }>(() =>
    db.from('sales').select('id, external_order_id, gross_price, sale_date').eq('marketplace', 'mercado_livre')
      .gte('sale_date', from).lte('sale_date', to).is('cupom_codigo', null).order('id'))
  const pedidos = new Map<string, typeof rows>()
  for (const r of rows) { const o = r.external_order_id.match(/^ml_(\d+)_/)?.[1]; if (!o) continue; if (!pedidos.has(o)) pedidos.set(o, []); pedidos.get(o)!.push(r) }

  // campanhas de cupom do vendedor (nome/código/valor/vigência)
  const seller = await getMercadoLivreSellerId()
  const camp = await mlGet<{ results?: Array<Record<string, unknown>> }>(`/seller-promotions/users/${seller}`, { app_version: 'v2' }).catch(() => ({ results: [] }))
  const campanhas: CampanhaML[] = (camp.results ?? []).filter(c => /COUPON/.test(String(c.type))).map(c => ({
    nome: String(c.name ?? ''), codigo: String(c.coupon_code ?? c.id),
    fixo: c.fixed_amount != null ? Number(c.fixed_amount) : null, pct: c.percentage != null ? Number(c.percentage) : null,
    ini: String(c.start_date ?? '').slice(0, 10), fim: String(c.finish_date ?? '9999').slice(0, 10),
  }))

  let processed = 0, updated = 0, comCupom = 0
  const erros: string[] = []
  const lote = [...pedidos.entries()].slice(0, limit)
  for (let i = 0; i < lote.length; i += 6) {
    await Promise.all(lote.slice(i, i + 6).map(async ([id, itens]) => {
      try {
        const d = await mlGet<{ details?: [] }>(`/orders/${id}/discounts`)
        const total = itens.reduce((s, x) => s + Number(x.gross_price), 0)
        const c = cupomML(d.details, campanhas, itens[0].sale_date, total)
        if (c.codigo) comCupom++
        for (const x of itens) {
          const share = total > 0 ? Number(x.gross_price) / total : 1 / itens.length
          const { error } = await db.from('sales').update({
            cupom_codigo: c.codigo, cupom_vendedor: Math.round(c.vendedor * share * 100) / 100,
            cupom_marketplace: Math.round(c.marketplace * share * 100) / 100,
          }).eq('id', x.id)
          if (!error) updated++
        }
        processed++
      } catch (e) { if (erros.length < 3) erros.push(`${id}: ${String(e).slice(0, 80)}`) }
    }))
  }
  return NextResponse.json({ ok: true, processed, com_cupom: comCupom, sales_updated: updated, restantes: pedidos.size - processed, erros })
}
