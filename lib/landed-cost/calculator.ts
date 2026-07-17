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

  // 1. Load order (for issue_date — define effective_date of the new CMP)
  const { data: order } = await db
    .from('import_orders')
    .select('issue_date')
    .eq('id', importOrderId)
    .single()

  const effectiveDate = order?.issue_date ?? new Date().toISOString().slice(0, 10)

  // 2. Load all items for this import order
  const { data: items } = await db
    .from('import_items')
    .select('*')
    .eq('import_order_id', importOrderId)

  if (!items?.length) return

  // 3. Load all additional costs for this order
  const { data: costs } = await db
    .from('import_costs')
    .select('*')
    .eq('import_order_id', importOrderId)

  // 4. Total FOB value of the order (base for proportional distribution)
  const totalFobOrder = items.reduce((s, i) => s + Number(i.total_fob_value), 0)

  // 5. Total additional costs to distribute
  const totalAdditional = (costs ?? []).reduce((s, c) => s + Number(c.amount), 0)

  // 6. Delete existing unit_costs for this order (full recalculation)
  await db.from('unit_costs').delete().eq('import_order_id', importOrderId)

  const affectedProductIds: string[] = []

  for (const item of items) {
    if (!item.product_id) continue // Skip unmatched items

    const fobUnitCost  = Number(item.unit_fob_value)
    const itemFobTotal = Number(item.total_fob_value)
    const qty          = Number(item.quantity) || 1

    // Regra crédito/débito (Lucro Real não cumulativo, definida pelo Bruno 2026-07-17):
    // custo = desembolso líquido dos créditos recuperáveis (ICMS, PIS, COFINS).
    // II e IPI: sem crédito → custo real.
    //
    // Compra NACIONAL (unit_ii = 0): o preço unitário (fob) já EMBUTE
    //   ICMS/PIS/COFINS → subtrai os créditos; IPI é cobrado por fora → soma.
    // IMPORTAÇÃO (unit_ii > 0): o FOB não inclui impostos; ICMS/PIS/COFINS
    //   pagos no desembaraço voltam como crédito → não entram; II e IPI somam.
    const isImport = Number(item.unit_ii) > 0
    const taxesUnitCost = isImport
      ? Number(item.unit_ii) + Number(item.unit_ipi)
      : Number(item.unit_ipi)
        - Number(item.unit_icms_gnre)
        - Number(item.unit_pis_imp)
        - Number(item.unit_cofins_imp)

    const fobShare           = totalFobOrder > 0 ? itemFobTotal / totalFobOrder : 0
    const additionalTotal    = totalAdditional * fobShare
    const additionalUnitCost = additionalTotal / qty
    const totalUnitCost      = fobUnitCost + taxesUnitCost + additionalUnitCost

    await db.from('unit_costs').insert({
      import_item_id:       item.id,
      product_id:           item.product_id,
      import_order_id:      importOrderId,
      fob_unit_cost:        fobUnitCost,
      taxes_unit_cost:      taxesUnitCost,
      additional_unit_cost: additionalUnitCost,
      total_unit_cost:      totalUnitCost,
      quantity_in_batch:    qty,
      pis_credit_unit:      Number(item.unit_pis_imp),
      cofins_credit_unit:   Number(item.unit_cofins_imp),
      icms_credit_unit:     Number(item.unit_icms_gnre),
    })

    affectedProductIds.push(item.product_id)
  }

  // 7. Mark order as costs_complete if it has additional costs
  if ((costs ?? []).length > 0) {
    await db.from('import_orders').update({ costs_complete: true }).eq('id', importOrderId)
  }

  // 8. Recalculate CMP for all affected products, usando a data da NF-e como vigência
  const uniqueProductIds = [...new Set(affectedProductIds)]
  for (const productId of uniqueProductIds) {
    await recalculateCmp(productId, effectiveDate)
  }
}

/**
 * Calculates Custo Médio Ponderado (CMP) for a product
 * across all import batches, weighted by batch quantity.
 *
 * CMP = Σ(total_unit_cost × quantity_in_batch) / Σ(quantity_in_batch)
 *
 * effectiveDate: data da NF-e de entrada que originou este recálculo.
 * Determina a partir de quando este CMP se aplica às vendas.
 */
export async function recalculateCmp(productId: string, effectiveDate?: string): Promise<number | null> {
  const db = createSupabaseServiceClient()

  const { data: batches } = await db
    .from('unit_costs')
    .select('total_unit_cost, quantity_in_batch')
    .eq('product_id', productId)

  if (!batches?.length) return null

  const totalQty   = batches.reduce((s, b) => s + Number(b.quantity_in_batch), 0)
  const totalValue = batches.reduce((s, b) => s + Number(b.total_unit_cost) * Number(b.quantity_in_batch), 0)

  if (totalQty === 0) return null

  const cmpValue = totalValue / totalQty
  const now      = new Date().toISOString()

  await db.from('cmp_costs').insert({
    product_id:        productId,
    cmp_value:         cmpValue,
    total_stock_qty:   totalQty,
    total_stock_value: totalValue,
    calculated_at:     now,
    effective_date:    effectiveDate ?? now.slice(0, 10),
  })

  return cmpValue
}

/**
 * Returns the CMP for a product that was effective on a given date.
 * Uses the most recent CMP whose effective_date <= saleDate.
 * Falls back to the most recent CMP overall if none found before the date.
 */
export async function getCmpAtDate(
  productId: string,
  saleDate: string
): Promise<{ id: string; value: number } | null> {
  const db = createSupabaseServiceClient()

  // CMP vigente NA data da venda (effective_date <= saleDate)
  const { data: atDate } = await db
    .from('cmp_costs')
    .select('id, cmp_value')
    .eq('product_id', productId)
    .lte('effective_date', saleDate)
    // desempate entre recálculos com a mesma vigência: o mais recente vence
    .order('effective_date', { ascending: false })
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (atDate) return { id: atDate.id, value: Number(atDate.cmp_value) }

  // Fallback: venda anterior ao primeiro lote importado — usa o CMP mais antigo disponível
  const { data: earliest } = await db
    .from('cmp_costs')
    .select('id, cmp_value')
    .eq('product_id', productId)
    .order('effective_date', { ascending: true })
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (earliest) return { id: earliest.id, value: Number(earliest.cmp_value) }

  return null
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
    .order('effective_date', { ascending: false })
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? Number(data.cmp_value) : null
}

/**
 * After a sale, records the CMP that was effective at the sale date.
 * Uses getCmpAtDate so each sale reflects the cost of that period.
 */
export async function applyCmpToSale(saleId: string): Promise<void> {
  const db = createSupabaseServiceClient()

  const { data: sale } = await db
    .from('sales')
    .select('product_id, gross_price, shipping_received, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, discounts, rebate, quantity, sale_date, sale_taxes(pis, cofins, icms, icms_difal, ipi)')
    .eq('id', saleId)
    .single()

  if (!sale?.product_id) return

  const cmp = await getCmpAtDate(sale.product_id, sale.sale_date)
  if (!cmp) return

  const qty = Number(sale.quantity) || 1
  const totalCost = cmp.value * qty

  // Débitos da NF-e de saída (regra crédito/débito: imposto da venda é custo da venda)
  const t = Array.isArray(sale.sale_taxes) ? sale.sale_taxes[0] : sale.sale_taxes
  const saleTaxes = t
    ? Number(t.pis ?? 0) + Number(t.cofins ?? 0) + Number(t.icms ?? 0)
    + Number(t.icms_difal ?? 0) + Number(t.ipi ?? 0)
    : 0

  // Receita líquida completa:
  // + gross_price         (preço do produto)
  // + shipping_received   (frete cobrado do comprador → é receita do vendedor)
  // - marketplace_commission (comissão do canal)
  // - marketplace_shipping_fee (frete pago pelo vendedor ao canal/transportadora)
  // - ads_cost            (investimento em anúncios)
  // - cancellation        (devoluções/cancelamentos)
  // - discounts           (cupons/descontos concedidos ao comprador)
  // + rebate              (rebates recebidos: desconto tarifário ML, bonificação fornecedor, etc.)
  const netRevenue = Number(sale.gross_price)
                   + Number(sale.shipping_received  ?? 0)
                   - Number(sale.marketplace_commission ?? 0)
                   - Number(sale.marketplace_shipping_fee ?? 0)
                   - Number(sale.ads_cost            ?? 0)
                   - Number(sale.cancellation        ?? 0)
                   - Number(sale.discounts           ?? 0)
                   + Number(sale.rebate              ?? 0)
                   - saleTaxes
  // Sem NF-e ainda (impostos ausentes) → margem NULL ("em cálculo"),
  // não um número inflado com custos que ainda não chegaram
  const hasTaxes    = !!t
  const marginValue = hasTaxes ? netRevenue - totalCost : null
  // Margem % sobre o faturamento bruto (definição do Bruno)
  const gross       = Number(sale.gross_price)
  const marginPct   = hasTaxes && gross > 0 ? (netRevenue - totalCost) / gross : null

  await db.from('sale_costs').upsert({
    sale_id:           saleId,
    cmp_cost_id:       cmp.id,
    unit_cost_applied: cmp.value,
    total_cost:        totalCost,
    margin_value:      marginValue,
    margin_pct:        marginPct,
  }, { onConflict: 'sale_id' })
}
