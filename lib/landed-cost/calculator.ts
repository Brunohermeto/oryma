import { createSupabaseServiceClient } from '@/lib/supabase/server'

/**
 * Recalculates unit costs for all items in an import order,
 * then recalculates CMP for all affected products.
 *
 * Call this after:
 * - A new import NF-e is processed
 * - A new import_cost (late-arriving expense) is added to an order
 */
export async function recalculateLandedCost(importOrderId: string): Promise<void> {
  const db = createSupabaseServiceClient()

  // 1. Load all items for this import order
  const { data: items } = await db
    .from('import_items')
    .select('*')
    .eq('import_order_id', importOrderId)

  if (!items?.length) return

  // 2. Load all additional costs for this order
  const { data: costs } = await db
    .from('import_costs')
    .select('*')
    .eq('import_order_id', importOrderId)

  // 3. Total FOB value of the order (base for proportional distribution)
  const totalFobOrder = items.reduce((s, i) => s + Number(i.total_fob_value), 0)

  // 4. Total additional costs to distribute
  const totalAdditional = (costs ?? []).reduce((s, c) => s + Number(c.amount), 0)

  // 5. Delete existing unit_costs for this order (full recalculation)
  await db.from('unit_costs').delete().eq('import_order_id', importOrderId)

  const affectedProductIds: string[] = []

  for (const item of items) {
    if (!item.product_id) continue // Skip unmatched items

    const fobUnitCost = Number(item.unit_fob_value)
    const itemFobTotal = Number(item.total_fob_value)
    const qty = Number(item.quantity) || 1

    // Per-unit taxes (already stored as per-unit in import_items)
    const taxesUnitCost =
      Number(item.unit_ii) +
      Number(item.unit_ipi) +
      Number(item.unit_pis_imp) +
      Number(item.unit_cofins_imp) +
      Number(item.unit_icms_gnre)

    // Prorate additional costs by FOB proportion
    const fobShare = totalFobOrder > 0 ? itemFobTotal / totalFobOrder : 0
    const additionalTotal = totalAdditional * fobShare
    const additionalUnitCost = additionalTotal / qty

    const totalUnitCost = fobUnitCost + taxesUnitCost + additionalUnitCost

    // Tax credits generated (for PIS/COFINS/ICMS apuration)
    const pisCredit = Number(item.unit_pis_imp)
    const cofinsCredit = Number(item.unit_cofins_imp)
    const icmsCredit = Number(item.unit_icms_gnre)

    await db.from('unit_costs').insert({
      import_item_id: item.id,
      product_id: item.product_id,
      import_order_id: importOrderId,
      fob_unit_cost: fobUnitCost,
      taxes_unit_cost: taxesUnitCost,
      additional_unit_cost: additionalUnitCost,
      total_unit_cost: totalUnitCost,
      quantity_in_batch: qty,
      pis_credit_unit: pisCredit,
      cofins_credit_unit: cofinsCredit,
      icms_credit_unit: icmsCredit,
    })

    affectedProductIds.push(item.product_id)
  }

  // 6. Mark order as costs_complete if it has additional costs
  if ((costs ?? []).length > 0) {
    await db.from('import_orders').update({ costs_complete: true }).eq('id', importOrderId)
  }

  // 7. Recalculate CMP for all affected products
  const uniqueProductIds = [...new Set(affectedProductIds)]
  for (const productId of uniqueProductIds) {
    await recalculateCmp(productId)
  }
}

/**
 * Calculates Custo Médio Ponderado (CMP) for a product
 * across all import batches, weighted by batch quantity.
 *
 * CMP = Σ(total_unit_cost × quantity_in_batch) / Σ(quantity_in_batch)
 */
export async function recalculateCmp(productId: string): Promise<number | null> {
  const db = createSupabaseServiceClient()

  const { data: batches } = await db
    .from('unit_costs')
    .select('total_unit_cost, quantity_in_batch')
    .eq('product_id', productId)
    .order('calculated_at', { ascending: false })

  if (!batches?.length) return null

  const totalQty = batches.reduce((s, b) => s + Number(b.quantity_in_batch), 0)
  const totalValue = batches.reduce((s, b) => s + Number(b.total_unit_cost) * Number(b.quantity_in_batch), 0)

  if (totalQty === 0) return null

  const cmpValue = totalValue / totalQty

  await db.from('cmp_costs').insert({
    product_id: productId,
    cmp_value: cmpValue,
    total_stock_qty: totalQty,
    total_stock_value: totalValue,
    calculated_at: new Date().toISOString(),
  })

  return cmpValue
}

/**
 * Returns the most recent CMP for a product.
 */
export async function getCurrentCmp(productId: string): Promise<number | null> {
  const db = createSupabaseServiceClient()
  const { data } = await db
    .from('cmp_costs')
    .select('cmp_value')
    .eq('product_id', productId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .single()
  return data ? Number(data.cmp_value) : null
}

/**
 * After a sale, records the CMP applied at the time of sale.
 * Also calculates and stores the margin for that sale.
 */
export async function applyCmpToSale(saleId: string): Promise<void> {
  const db = createSupabaseServiceClient()

  const { data: sale } = await db
    .from('sales')
    .select('product_id, gross_price, marketplace_commission, marketplace_shipping_fee, quantity')
    .eq('id', saleId)
    .single()

  if (!sale?.product_id) return

  const cmp = await getCurrentCmp(sale.product_id)
  if (cmp === null) return

  const { data: cmpRecord } = await db
    .from('cmp_costs')
    .select('id')
    .eq('product_id', sale.product_id)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .single()

  const qty = Number(sale.quantity) || 1
  const totalCost = cmp * qty
  const netRevenue = Number(sale.gross_price) - Number(sale.marketplace_commission) - Number(sale.marketplace_shipping_fee)
  const marginValue = netRevenue - totalCost
  const marginPct = netRevenue > 0 ? marginValue / netRevenue : 0

  await db.from('sale_costs').upsert({
    sale_id: saleId,
    cmp_cost_id: cmpRecord?.id ?? null,
    unit_cost_applied: cmp,
    total_cost: totalCost,
    margin_value: marginValue,
    margin_pct: marginPct,
  }, { onConflict: 'sale_id' })
}
