/**
 * POST /api/ads/map  { marketplace, campaign_id, campaign_name?, product_skus: string[] }
 * Vínculo campanha → produtos escolhido UMA vez (campanha sem código de produto
 * no nome). Vale para os próximos uploads e é aplicado já nos períodos enviados:
 * atualiza ads_metrics e refaz o rateio + margem desses períodos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { aplicaPeriodoAds } from '@/lib/marketing/ads-apply'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const b = await request.json().catch(() => ({}))
  const marketplace = String(b.marketplace ?? ''), campaign_id = String(b.campaign_id ?? '')
  const skus = Array.isArray(b.product_skus) ? b.product_skus.map(String) : []
  if (!['shopee', 'amazon'].includes(marketplace) || !campaign_id) {
    return NextResponse.json({ error: 'marketplace e campaign_id são obrigatórios' }, { status: 400 })
  }
  const db = createSupabaseServiceClient()
  await db.from('ads_campaign_products').upsert({
    marketplace, campaign_id, campaign_name: b.campaign_name ?? null, product_skus: skus, updated_at: new Date().toISOString(),
  })
  const { data: periodos } = await db.from('ads_metrics').update({ product_skus: skus })
    .eq('marketplace', marketplace).eq('campaign_id', campaign_id).select('date_from, date_to')
  const unicos = [...new Set((periodos ?? []).map(p => `${p.date_from}|${p.date_to}`))]
  for (const p of unicos) {
    const [de, ate] = p.split('|')
    await aplicaPeriodoAds(db, marketplace, de, ate)
  }
  return NextResponse.json({ ok: true, periodos_refeitos: unicos.length })
}
