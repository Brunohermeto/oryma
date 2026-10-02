/**
 * POST /api/sync/ml/ads?from=YYYY-MM-DD&to=YYYY-MM-DD  (padrão: últimos 3 dias)
 *
 * Gasto do Mercado Ads (Product Ads) POR ANÚNCIO e POR DIA, direto da API de
 * publicidade (/advertising/MLB/advertisers/{id}/product_ads/ads/search), e
 * rateio por venda do mesmo anúncio no mesmo dia (lib/marketing/allocate-ads).
 * Substitui o rateio antigo pelo extrato (PADS do billing, por dia inteiro e
 * sujeito ao limite de 5 req/min — set/2026 ficou com metade dos Ads).
 * Até ~5 dias por chamada (60s); o ciclo diário relê os últimos dias porque o
 * ML consolida as métricas com atraso.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getValidMercadoLivreToken } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { gravaAdsDoDia } from '@/lib/marketing/allocate-ads'
import { skusMlPorAnuncio } from '@/lib/marketing/ads-products'
import { brazilDaysAgo, brazilToday } from '@/lib/utils/brazil-time'

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

  const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const qFrom = request.nextUrl.searchParams.get('from'), qTo = request.nextUrl.searchParams.get('to')
  const from = isDate(qFrom) ? qFrom : brazilDaysAgo(2)
  const to = isDate(qTo) ? qTo : brazilToday()

  const token = await getValidMercadoLivreToken()
  const api = async (path: string, version: string) => {
    for (let t = 0; t < 4; t++) {
      const r = await fetch(`https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}`, 'api-version': version } })
      if (r.status === 429) { await sleep(5000 * (t + 1)); continue }
      if (!r.ok) throw new Error(`ML ads ${r.status}: ${(await r.text()).slice(0, 120)}`)
      return r.json()
    }
    throw new Error('ML ads: limite de requisições')
  }

  const adv = (await api('/advertising/advertisers?product_id=PADS', '1'))?.advertisers?.[0]?.advertiser_id
  if (!adv) return NextResponse.json({ ok: false, error: 'conta sem anunciante Product Ads' }, { status: 400 })

  const db = createSupabaseServiceClient()
  const skusPorMlb = await skusMlPorAnuncio(db)
  // nomes das campanhas (só p/ exibir no painel; falha aqui não impede o resto)
  const nomeCampanha = new Map<string, string>()
  try {
    for (let off = 0; off < 1000; off += 50) {
      const c = await api(`/advertising/MLB/advertisers/${adv}/product_ads/campaigns/search?limit=50&offset=${off}`, '2')
      for (const x of c.results ?? []) nomeCampanha.set(String(x.id), x.name)
      if (off + 50 >= Number(c.paging?.total ?? 0)) break
    }
  } catch { /* segue sem nomes */ }
  const dias: Array<{ dia: string; gasto: number; anuncios: number; vendas: number; sem_venda: number }> = []
  for (let d = new Date(`${from}T12:00:00`); d <= new Date(`${to}T12:00:00`); d.setDate(d.getDate() + 1)) {
    const dia = d.toISOString().slice(0, 10)
    const custo = new Map<string, number>()
    const linhas: Record<string, unknown>[] = []
    for (let off = 0; ; off += 50) {
      const j = await api(`/advertising/MLB/advertisers/${adv}/product_ads/ads/search?limit=50&offset=${off}&date_from=${dia}&date_to=${dia}&metrics=cost,clicks,prints,units_quantity,total_amount`, '2')
      for (const a of j.results ?? []) {
        const m = a.metrics ?? {}
        const c = Number(m.cost ?? 0)
        if (c > 0) custo.set(a.item_id, (custo.get(a.item_id) ?? 0) + c)
        // painel de Ads: guarda o dia (o ML apaga métricas com mais de 90 dias)
        if (c > 0 || Number(m.clicks ?? 0) > 0) linhas.push({
          marketplace: 'mercado_livre', date_from: dia, date_to: dia, source: 'api',
          campaign_id: String(a.campaign_id ?? ''), campaign_name: nomeCampanha.get(String(a.campaign_id)) ?? null,
          ad_ref: a.item_id, ad_title: a.title ?? null,
          product_skus: skusPorMlb.get(a.item_id) ?? [],
          impressions: Number(m.prints ?? 0), clicks: Number(m.clicks ?? 0), cost: c,
          ad_sales: Number(m.total_amount ?? 0), ad_orders: Number(m.units_quantity ?? 0),
        })
      }
      if (off + 50 >= Number(j.paging?.total ?? 0)) break
    }
    if (linhas.length) {
      const { error } = await db.from('ads_metrics').upsert(linhas, { onConflict: 'marketplace,date_from,date_to,campaign_id,ad_ref' })
      if (error) throw new Error(`ads_metrics: ${error.message}`)
    }
    // venda ML: external_order_id = ml_{pedido}_{MLB do anúncio}
    const r = await gravaAdsDoDia(db, 'mercado_livre', dia, custo, s => s.external_order_id.split('_')[2] ?? null)
    dias.push({ dia, gasto: Math.round([...custo.values()].reduce((a, b) => a + b, 0) * 100) / 100, anuncios: custo.size, vendas: r.vendas, sem_venda: r.semVenda })
  }
  return NextResponse.json({ ok: true, advertiser: adv, dias })
}
