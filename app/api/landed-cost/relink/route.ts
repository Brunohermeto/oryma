/**
 * POST /api/landed-cost/relink
 *
 * Re-vincula import_items aos produtos por SKU e recalcula CMP.
 * Necessário quando:
 *   - A NF-e de entrada foi importada antes dos produtos serem cadastrados
 *   - import_items.product_id = NULL mas sku existe nos produtos
 *
 * Fluxo:
 *   1. Busca todos import_items com product_id NULL
 *   2. Tenta vincular por SKU exato na tabela products
 *   3. Atualiza product_id nos itens vinculados
 *   4. Chama recalculateLandedCost para cada import_order afetado
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // 1. Busca todos os import_items sem product_id mas com sku
  const { data: unlinked } = await db
    .from('import_items')
    .select('id, sku, import_order_id')
    .is('product_id', null)
    .not('sku', 'is', null)

  if (!unlinked?.length) {
    return NextResponse.json({ ok: true, linked: 0, message: 'Todos os itens já têm produto vinculado' })
  }

  // 2. Carrega produtos (uma única query)
  const { data: products } = await db.from('products').select('id, sku')
  const productMap = Object.fromEntries((products ?? []).map(p => [p.sku.toUpperCase(), p.id]))

  // 3. Vincula e atualiza
  let linked = 0
  const affectedOrders = new Set<string>()

  for (const item of unlinked) {
    const productId = productMap[item.sku.toUpperCase()]
    if (!productId) continue

    await db.from('import_items').update({ product_id: productId }).eq('id', item.id)
    affectedOrders.add(item.import_order_id)
    linked++
  }

  // 4. Recalcula CMP para cada import_order afetado
  let recalculated = 0
  for (const orderId of affectedOrders) {
    try {
      await recalculateLandedCost(orderId)
      recalculated++
    } catch { continue }
  }

  return NextResponse.json({
    ok: true,
    linked,
    orders_recalculated: recalculated,
    message: `${linked} itens vinculados a produtos, CMP calculado para ${recalculated} NF-e`,
  })
}
