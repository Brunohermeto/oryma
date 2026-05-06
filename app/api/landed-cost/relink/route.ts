/**
 * POST /api/landed-cost/relink
 *
 * Re-vincula import_items aos produtos por SKU, recalcula CMP e
 * aplica o CMP retroativamente a todas as vendas existentes.
 *
 * Fluxo:
 *   1. Busca import_items com product_id NULL → vincula por SKU
 *   2. Recalcula landed cost / CMP para todas as NF-e
 *   3. Aplica CMP a todas as vendas (sale_costs) — preenche histórico
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

  // 2. Carrega produtos (uma única query)
  const { data: products } = await db.from('products').select('id, sku')
  const productMap = Object.fromEntries((products ?? []).map(p => [p.sku.toUpperCase(), p.id]))

  // 3. Vincula itens sem product_id
  let linked = 0
  const ordersToRecalc = new Set<string>()

  for (const item of unlinked ?? []) {
    const productId = productMap[item.sku.toUpperCase()]
    if (!productId) continue
    await db.from('import_items').update({ product_id: productId }).eq('id', item.id)
    ordersToRecalc.add(item.import_order_id)
    linked++
  }

  // 4. Sempre recalcula TODAS as ordens (não só as recém-vinculadas)
  const { data: allOrders } = await db.from('import_orders').select('id')
  for (const order of allOrders ?? []) {
    ordersToRecalc.add(order.id)
  }

  let recalculated = 0
  for (const orderId of ordersToRecalc) {
    try {
      await recalculateLandedCost(orderId)
      recalculated++
    } catch { continue }
  }

  // 5. Aplica CMP a TODAS as vendas com product_id (preenche sale_costs histórico)
  //    Bulk: carrega CMPs e vendas de uma vez, faz upsert em lote — evita timeout
  const [{ data: latestCmps }, { data: allSales }] = await Promise.all([
    db.from('cmp_costs')
      .select('id, product_id, cmp_value')
      .order('calculated_at', { ascending: false }),
    db.from('sales')
      .select('id, product_id, gross_price, marketplace_commission, marketplace_shipping_fee, quantity, cancellation')
      .not('product_id', 'is', null),
  ])

  // Mapa: product_id → CMP mais recente (primeiro por ordem DESC de calculated_at)
  const cmpMap = new Map<string, { id: string; value: number }>()
  for (const c of latestCmps ?? []) {
    if (!cmpMap.has(c.product_id)) {
      cmpMap.set(c.product_id, { id: c.id, value: Number(c.cmp_value) })
    }
  }

  // Monta registros de sale_costs em bulk
  const saleCostRows: Array<{
    sale_id: string
    cmp_cost_id: string | null
    unit_cost_applied: number
    total_cost: number
    margin_value: number
    margin_pct: number
  }> = []

  for (const sale of allSales ?? []) {
    const cmp = cmpMap.get(sale.product_id)
    if (!cmp) continue
    const qty        = Number(sale.quantity) || 1
    const totalCost  = cmp.value * qty
    const netRevenue = Number(sale.gross_price)
                     - Number(sale.marketplace_commission ?? 0)
                     - Number(sale.marketplace_shipping_fee ?? 0)
                     - Number(sale.cancellation ?? 0)
    const marginValue = netRevenue - totalCost
    const marginPct   = netRevenue > 0 ? marginValue / netRevenue : 0
    saleCostRows.push({
      sale_id:            sale.id,
      cmp_cost_id:        cmp.id,
      unit_cost_applied:  cmp.value,
      total_cost:         totalCost,
      margin_value:       marginValue,
      margin_pct:         marginPct,
    })
  }

  // Upsert em lotes de 500 (PostgREST aceita bem)
  let salesUpdated = 0
  const BATCH = 500
  for (let i = 0; i < saleCostRows.length; i += BATCH) {
    const batch = saleCostRows.slice(i, i + BATCH)
    const { error } = await db.from('sale_costs').upsert(batch, { onConflict: 'sale_id' })
    if (!error) salesUpdated += batch.length
  }

  return NextResponse.json({
    ok: true,
    linked,
    orders_recalculated: recalculated,
    sales_updated: salesUpdated,
    message: `CMP calculado (${recalculated} NF-e) · ${salesUpdated} vendas atualizadas`,
  })
}
