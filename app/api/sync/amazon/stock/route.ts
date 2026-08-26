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
  const bySku = new Map<string, number>()        // disponível (fulfillable)
  const transitoBySku = new Map<string, number>() // em trânsito (inbound)
  let nextToken: string | undefined
  do {
    const res = await amazonGet<{
      payload?: { inventorySummaries?: Array<{ sellerSku?: string; totalQuantity?: number; inventoryDetails?: {
        fulfillableQuantity?: number; inboundWorkingQuantity?: number; inboundShippedQuantity?: number; inboundReceivingQuantity?: number
      } }> }
      pagination?: { nextToken?: string }
    }>('/fba/inventory/v1/summaries', {
      granularityType: 'Marketplace', granularityId: MKT_BR, marketplaceIds: MKT_BR,
      details: 'true',   // precisamos do detalhamento p/ separar disponível × trânsito
      ...(nextToken ? { nextToken } : {}),
    })
    for (const s of res.payload?.inventorySummaries ?? []) {
      const sku = (s.sellerSku ?? '').replace(/[_-]FBA$/i, '').trim()
      if (!sku) continue
      const d = s.inventoryDetails ?? {}
      // disponível para venda AGORA (exclui trânsito, reservado, avariado)
      bySku.set(sku, (bySku.get(sku) ?? 0) + Number(d.fulfillableQuantity ?? 0))
      // em trânsito = a caminho do armazério (working + shipped + receiving)
      const transito = Number(d.inboundWorkingQuantity ?? 0) + Number(d.inboundShippedQuantity ?? 0) + Number(d.inboundReceivingQuantity ?? 0)
      transitoBySku.set(sku, (transitoBySku.get(sku) ?? 0) + transito)
    }
    nextToken = res.pagination?.nextToken
  } while (nextToken)

  const { data: products } = await db.from('products').select('id, sku, stock_fba, stock_fba_transito').limit(3000)
  let updated = 0
  const semProduto: string[] = []
  const pBySku = new Map((products ?? []).map(p => [String(p.sku).toUpperCase(), p]))
  // todos os SKUs vistos (com disponível OU com trânsito)
  const todosSkus = new Set([...bySku.keys(), ...transitoBySku.keys()])
  for (const sku of todosSkus) {
    const p = pBySku.get(sku.toUpperCase())
    const disp = bySku.get(sku) ?? 0
    const trans = transitoBySku.get(sku) ?? 0
    if (!p) { if (disp > 0 || trans > 0) semProduto.push(`${sku}:${disp}(+${trans})`); continue }
    if (Number(p.stock_fba ?? 0) !== disp || Number((p as any).stock_fba_transito ?? 0) !== trans) {
      const { error } = await db.from('products').update({ stock_fba: disp, stock_fba_transito: trans }).eq('id', p.id)
      if (!error) updated++
    }
  }
  // zera quem saiu do FBA por completo
  for (const p of products ?? []) {
    if ((Number(p.stock_fba ?? 0) > 0 || Number((p as any).stock_fba_transito ?? 0) > 0) && !todosSkus.has(String(p.sku).toUpperCase()) && !todosSkus.has(String(p.sku))) {
      await db.from('products').update({ stock_fba: 0, stock_fba_transito: 0 }).eq('id', p.id)
      updated++
    }
  }

  return NextResponse.json({
    ok: true,
    skus_fba: bySku.size,
    unidades_fba_disponivel: [...bySku.values()].reduce((s, v) => s + v, 0),
    unidades_fba_transito: [...transitoBySku.values()].reduce((s, v) => s + v, 0),
    produtos_atualizados: updated,
    skus_sem_produto: semProduto.slice(0, 10),
  })
}
