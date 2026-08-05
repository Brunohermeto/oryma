/**
 * POST /api/sync/amazon/stock
 *
 * Estoque FBA da Amazon → products.stock_fba.
 * Mesma conciliação do Full ML: estoque total = galpão (Bling) + Full ML +
 * FBA Amazon (+ Magalu fulfillment quando houver).
 * SKUs FBA usam sufixo _FBA/-FBA → normaliza para casar com o cadastro.
 */
import { NextRequest, NextResponse } from 'next/server'
import { amazonGet } from '@/lib/integrations/amazon'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const MKT_BR = 'A2Q3Y263D00KWC'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseServiceClient()

  // Estoque FBA por SKU (paginado)
  const bySku = new Map<string, number>()
  let nextToken: string | undefined
  do {
    const res = await amazonGet<{
      payload?: { inventorySummaries?: Array<{ sellerSku?: string; totalQuantity?: number }> }
      pagination?: { nextToken?: string }
    }>('/fba/inventory/v1/summaries', {
      granularityType: 'Marketplace', granularityId: MKT_BR, marketplaceIds: MKT_BR,
      ...(nextToken ? { nextToken } : {}),
    })
    for (const s of res.payload?.inventorySummaries ?? []) {
      const sku = (s.sellerSku ?? '').replace(/[_-]FBA$/i, '').trim()
      if (!sku) continue
      bySku.set(sku, (bySku.get(sku) ?? 0) + Number(s.totalQuantity ?? 0))
    }
    nextToken = res.pagination?.nextToken
  } while (nextToken)

  const { data: products } = await db.from('products').select('id, sku, stock_fba').limit(3000)
  let updated = 0
  const semProduto: string[] = []
  const pBySku = new Map((products ?? []).map(p => [String(p.sku).toUpperCase(), p]))
  for (const [sku, qty] of bySku) {
    const p = pBySku.get(sku.toUpperCase())
    if (!p) { if (qty > 0) semProduto.push(`${sku}:${qty}`); continue }
    if (Number(p.stock_fba ?? 0) !== qty) {
      const { error } = await db.from('products').update({ stock_fba: qty }).eq('id', p.id)
      if (!error) updated++
    }
  }
  // zera quem saiu do FBA
  const vistos = new Set([...bySku.keys()].map(s => s.toUpperCase()))
  for (const p of products ?? []) {
    if (Number(p.stock_fba ?? 0) > 0 && !vistos.has(String(p.sku).toUpperCase())) {
      await db.from('products').update({ stock_fba: 0 }).eq('id', p.id)
      updated++
    }
  }

  return NextResponse.json({
    ok: true,
    skus_fba: bySku.size,
    unidades_fba_total: [...bySku.values()].reduce((s, v) => s + v, 0),
    produtos_atualizados: updated,
    skus_sem_produto: semProduto.slice(0, 10),
  })
}
