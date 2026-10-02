/**
 * POST /api/ads/upload  (multipart: canal = shopee|amazon, de, ate, file)
 * Upload quinzenal dos relatórios de Ads (Shopee "Dados Gerais de Anúncios";
 * Amazon export de Campanhas). Substitui o que já existia para o MESMO canal e
 * período (reenviar não duplica), vincula anúncio → produtos e rateia o gasto
 * nas vendas do período (regra do Bruno, 02/10/2026).
 * Devolve as campanhas com gasto que ficaram SEM produto (Amazon sem ASIN no
 * nome) para o Bruno escolher o produto uma vez (POST /api/ads/map).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { parseShopeeAds, parseAmazonCampaigns } from '@/lib/marketing/ads-reports'
import { skusShopee, skusAmazonPorAsin } from '@/lib/marketing/ads-products'
import { aplicaPeriodoAds } from '@/lib/marketing/ads-apply'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const form = await request.formData()
  const canal = String(form.get('canal') ?? '')
  const de = String(form.get('de') ?? ''), ate = String(form.get('ate') ?? '')
  const file = form.get('file') as File | null
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!['shopee', 'amazon'].includes(canal)) return NextResponse.json({ error: 'Canal inválido' }, { status: 400 })
  if (!isDate(de) || !isDate(ate) || de > ate) return NextResponse.json({ error: 'Informe o período (de/até) do relatório' }, { status: 400 })
  if (!file) return NextResponse.json({ error: 'Envie o arquivo do relatório' }, { status: 400 })

  let rows
  try {
    const text = await file.text()
    rows = canal === 'shopee' ? parseShopeeAds(text) : parseAmazonCampaigns(text)
  } catch (e) {
    return NextResponse.json({ error: String(e).replace('Error: ', '') }, { status: 400 })
  }
  if (!rows.length) return NextResponse.json({ error: 'Nenhuma linha de anúncio no arquivo' }, { status: 400 })

  const db = createSupabaseServiceClient()
  // anúncio → SKUs do cadastro
  const { data: manuais } = await db.from('ads_campaign_products').select('campaign_id, product_skus').eq('marketplace', canal)
  const manual = new Map((manuais ?? []).map(m => [m.campaign_id as string, m.product_skus as string[]]))
  const porRef = canal === 'shopee'
    ? await skusShopee(db, [...new Set(rows.map(r => r.ad_ref))])
    : await skusAmazonPorAsin(db)
  const linhas = rows.map(r => ({
    marketplace: canal, date_from: de, date_to: ate, source: 'upload',
    campaign_id: r.campaign_id, campaign_name: r.campaign_name, ad_ref: r.ad_ref, ad_title: r.ad_title,
    product_skus: manual.get(r.campaign_id) ?? porRef.get(r.ad_ref) ?? [],
    impressions: Math.round(r.impressions), clicks: Math.round(r.clicks),
    cost: r.cost, ad_sales: r.ad_sales, ad_orders: r.ad_orders,
  }))

  // reenviar o mesmo período substitui (não duplica)
  await db.from('ads_metrics').delete().eq('marketplace', canal).eq('date_from', de).eq('date_to', ate)
  const { error } = await db.from('ads_metrics').insert(linhas)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const r = await aplicaPeriodoAds(db, canal, de, ate)
  const semProduto = linhas.filter(l => l.cost > 0 && !l.product_skus.length)
    .map(l => ({ campaign_id: l.campaign_id, campaign_name: l.campaign_name, cost: l.cost }))
  return NextResponse.json({
    ok: true, canal, de, ate, anuncios: linhas.length,
    gasto: Math.round(r.gasto * 100) / 100, vendas_rateadas: r.vendas, sem_produto: semProduto,
  })
}
