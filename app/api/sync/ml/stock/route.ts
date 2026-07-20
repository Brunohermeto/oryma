/**
 * POST /api/sync/ml/stock
 *
 * Estoque Full do Mercado Livre → products.stock_full.
 * O estoque no CD do ML não existe no Bling — precisa ser conciliado:
 * estoque total = stock_quantity (galpão, via Bling) + stock_full (marketplaces).
 *
 * Fluxo: lista anúncios ativos → multiget (inventory_id) →
 * /inventories/{id}/stock/fulfillment → soma por produto
 * (anúncio→produto via histórico de vendas: MLB → product_id).
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db  = createSupabaseServiceClient()
  const uid = await getMercadoLivreSellerId()
  if (!uid) return NextResponse.json({ error: 'Seller ID ML não encontrado' }, { status: 500 })

  // 1. Anúncios ativos do vendedor
  const itemIds: string[] = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await mlGet<{ results?: string[]; paging?: { total?: number } }>(
      `/users/${uid}/items/search?status=active&limit=100&offset=${offset}`
    )
    itemIds.push(...(page.results ?? []))
    if ((page.results ?? []).length < 100) break
    await sleep(120)
  }

  // 2. Multiget: inventory_id de cada anúncio (Full tem; galpão não)
  const withInventory: Array<{ mlb: string; inventoryId: string }> = []
  for (let i = 0; i < itemIds.length; i += 20) {
    const batch = itemIds.slice(i, i + 20)
    const res = await mlGet<Array<{ body?: { id?: string; inventory_id?: string | null } }>>(
      `/items?ids=${batch.join(',')}&attributes=id,inventory_id`
    )
    for (const r of res ?? []) {
      if (r.body?.inventory_id) withInventory.push({ mlb: r.body.id!, inventoryId: r.body.inventory_id })
    }
    await sleep(120)
  }

  // 3. Estoque fulfillment por inventory
  const stockByMlb = new Map<string, number>()
  for (const it of withInventory) {
    try {
      await sleep(120)
      const s = await mlGet<{ available_quantity?: number }>(
        `/inventories/${it.inventoryId}/stock/fulfillment`
      )
      stockByMlb.set(it.mlb, Number(s.available_quantity ?? 0))
    } catch { /* inventory sem stock — ignora */ }
  }

  // 4. Anúncio → produto (via histórico de vendas, que já tem o vínculo por EAN)
  const { data: saleLinks } = await db.from('sales')
    .select('external_order_id, product_id')
    .eq('marketplace', 'mercado_livre')
    .not('product_id', 'is', null)
    .order('sale_date', { ascending: false })
    .limit(3000)

  const productByMlb = new Map<string, string>()
  for (const s of saleLinks ?? []) {
    const mlb = s.external_order_id?.split('_')[2]
    if (mlb && !productByMlb.has(mlb)) productByMlb.set(mlb, s.product_id)
  }

  const fullByProduct = new Map<string, number>()
  const unmatched: string[] = []
  for (const [mlb, qty] of stockByMlb) {
    const pid = productByMlb.get(mlb)
    if (pid) fullByProduct.set(pid, (fullByProduct.get(pid) ?? 0) + qty)
    else if (qty > 0) unmatched.push(`${mlb}:${qty}`)
  }

  // 5. Grava: zera e aplica os valores atuais
  await db.from('products').update({ stock_full: 0 }).gt('stock_full', 0)
  let updated = 0
  for (const [pid, qty] of fullByProduct) {
    const { error } = await db.from('products').update({ stock_full: qty }).eq('id', pid)
    if (!error) updated++
  }

  return NextResponse.json({
    ok: true,
    anuncios_ativos: itemIds.length,
    anuncios_full: withInventory.length,
    produtos_atualizados: updated,
    unidades_full_total: [...stockByMlb.values()].reduce((s, v) => s + v, 0),
    anuncios_sem_vinculo: unmatched.slice(0, 10),
  })
}
