/**
 * POST /api/landed-cost/relink
 *
 * Re-vincula import_items e sales aos produtos por SKU, recalcula CMP
 * e aplica o CMP correto para a data de cada venda (CMP histórico).
 *
 * Fluxo:
 *   1. import_items com product_id NULL → vincula por SKU
 *   2. Recalcula landed cost / CMP para todas as NF-e (com effective_date)
 *   3. sales com product_id NULL → vincula por SKU
 *   4. Para cada venda, aplica o CMP vigente NA DATA DA VENDA
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

  // 3. Vincula import_items sem product_id
  let linked = 0
  const ordersToRecalc = new Set<string>()
  for (const item of unlinked ?? []) {
    const productId = productMap[item.sku.toUpperCase()]
    if (!productId) continue
    await db.from('import_items').update({ product_id: productId }).eq('id', item.id)
    ordersToRecalc.add(item.import_order_id)
    linked++
  }

  // 4. Recalcula TODAS as ordens (gera cmp_costs com effective_date = issue_date da NF-e)
  const { data: allOrders } = await db.from('import_orders').select('id')
  for (const order of allOrders ?? []) ordersToRecalc.add(order.id)

  let recalculated = 0
  for (const orderId of ordersToRecalc) {
    try { await recalculateLandedCost(orderId); recalculated++ } catch { continue }
  }

  // 5. Vincula sales sem product_id por SKU
  const { data: unlinkedSales } = await db
    .from('sales').select('id, sku')
    .is('product_id', null).not('sku', 'is', null)

  let salesLinked = 0
  for (const sale of unlinkedSales ?? []) {
    const productId = productMap[sale.sku?.toUpperCase()]
    if (!productId) continue
    await db.from('sales').update({ product_id: productId }).eq('id', sale.id)
    salesLinked++
  }

  // 6. Aplica CMP histórico a TODAS as vendas
  //    Para cada venda usa o CMP com effective_date <= sale_date (CMP vigente na época)
  //    Bulk: carrega todos os CMPs ordenados por data e todas as vendas de uma vez

  const [{ data: allCmps }, { data: allSales }] = await Promise.all([
    db.from('cmp_costs')
      .select('id, product_id, cmp_value, effective_date')
      .order('effective_date', { ascending: true })
      .limit(10000),
    db.from('sales')
      .select('id, product_id, gross_price, shipping_received, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, discounts, rebate, quantity, sale_date')
      .not('product_id', 'is', null)
      .limit(10000),
  ])

  // Mapa: product_id → CMPs ordenados por effective_date ASC
  const cmpsByProduct = new Map<string, Array<{ id: string; value: number; date: string }>>()
  for (const c of allCmps ?? []) {
    if (!cmpsByProduct.has(c.product_id)) cmpsByProduct.set(c.product_id, [])
    cmpsByProduct.get(c.product_id)!.push({
      id:    c.id,
      value: Number(c.cmp_value),
      date:  c.effective_date ?? '1900-01-01',
    })
  }

  // Para cada venda: encontra o CMP com effective_date <= sale_date (mais recente antes da venda)
  function getCmpForDate(productId: string, saleDate: string) {
    const list = cmpsByProduct.get(productId)
    if (!list?.length) return null
    // Lista está em ASC — pega o último com date <= saleDate
    let best = null
    for (const c of list) {
      if (c.date <= saleDate) best = c
      else break
    }
    return best ?? list[0] // fallback: CMP mais antigo se venda anterior ao primeiro lote
  }

  const saleCostRows: Array<{
    sale_id: string; cmp_cost_id: string | null
    unit_cost_applied: number; total_cost: number
    margin_value: number; margin_pct: number
  }> = []

  for (const sale of allSales ?? []) {
    const cmp = getCmpForDate(sale.product_id, sale.sale_date)
    if (!cmp) continue
    const qty         = Number(sale.quantity) || 1
    const totalCost   = cmp.value * qty
    const netRevenue  = Number(sale.gross_price)
                      + Number(sale.shipping_received        ?? 0)
                      - Number(sale.marketplace_commission   ?? 0)
                      - Number(sale.marketplace_shipping_fee ?? 0)
                      - Number(sale.ads_cost                 ?? 0)
                      - Number(sale.cancellation             ?? 0)
                      - Number(sale.discounts                ?? 0)
                      + Number(sale.rebate                   ?? 0)
    const marginValue = netRevenue - totalCost
    const marginPct   = netRevenue > 0 ? marginValue / netRevenue : 0
    saleCostRows.push({
      sale_id: sale.id, cmp_cost_id: cmp.id,
      unit_cost_applied: cmp.value, total_cost: totalCost,
      margin_value: marginValue, margin_pct: marginPct,
    })
  }

  // Delete + insert (sem dependência de UNIQUE constraint)
  let salesUpdated = 0
  let insertError: string | null = null
  const BATCH = 500

  if (saleCostRows.length > 0) {
    const saleIds = saleCostRows.map(r => r.sale_id)

    // Delete existentes
    for (let i = 0; i < saleIds.length; i += BATCH)
      await db.from('sale_costs').delete().in('sale_id', saleIds.slice(i, i + BATCH))

    // Insert — tenta primeiro em batch; se falhar, insere um a um para identificar o erro
    for (let i = 0; i < saleCostRows.length; i += BATCH) {
      const batch = saleCostRows.slice(i, i + BATCH)
      const { error } = await db.from('sale_costs').insert(batch)
      if (!error) {
        salesUpdated += batch.length
      } else {
        insertError = error.message
        // Tenta um a um para identificar linha problemática
        for (const row of batch) {
          const { error: rowErr } = await db.from('sale_costs').insert(row)
          if (!rowErr) salesUpdated++
          else if (!insertError) insertError = `row ${row.sale_id.slice(-6)}: ${rowErr.message}`
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    linked,
    sales_linked: salesLinked,
    orders_recalculated: recalculated,
    sales_updated: salesUpdated,
    sale_cost_rows_built: saleCostRows.length,
    insert_error: insertError,
    cmp_products_found: cmpsByProduct.size,
    message: insertError
      ? `⚠️ Erro ao salvar custos: ${insertError}`
      : `CMP calculado (${recalculated} NF-e) · ${salesLinked} vendas vinculadas · ${salesUpdated} vendas atualizadas`,
  })
}
