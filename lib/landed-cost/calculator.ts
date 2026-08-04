import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { isReturned } from '@/lib/sales/returned'

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

  // 1. Load order (issue_date define a vigência do CMP; CFOP diz se é importação)
  const { data: order } = await db
    .from('import_orders')
    .select('issue_date, cfop')
    .eq('id', importOrderId)
    .single()

  const effectiveDate = order?.issue_date ?? new Date().toISOString().slice(0, 10)
  // CFOP da NF é a fonte oficial: 3xxx = importação direta; 1xxx/2xxx = compra nacional.
  // Fallback (NF antiga sem CFOP gravado): presença de II indica importação.
  const orderIsImport = order?.cfop ? String(order.cfop).startsWith('3') : null

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
    const isImport = orderIsImport ?? Number(item.unit_ii) > 0
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
 * Custo por vigência de NF de entrada (regra do Bruno, 2026-07-24):
 * NÃO usamos média ponderada entre notas — cada NF de entrada define o custo
 * do produto A PARTIR da sua emissão. A linha do tempo fica:
 *   NF de fev → custo X vale de fev até a próxima nota
 *   NF de jun → custo Y vale de jun em diante
 * (Média só ENTRE itens da mesma nota — variantes de cor com mesmo preço.)
 * Lançamentos manuais em outras datas são preservados.
 */
export async function recalculateCmp(productId: string, _effectiveDate?: string): Promise<number | null> {
  const db = createSupabaseServiceClient()

  // SKU travado (kits/conjuntos): só o custo manual vale — NF não mexe
  const { data: prod } = await db.from('products')
    .select('cost_locked').eq('id', productId).maybeSingle()
  if (prod?.cost_locked) return null

  const { data: batches } = await db
    .from('unit_costs')
    .select('total_unit_cost, quantity_in_batch, import_order_id')
    .eq('product_id', productId)

  if (!batches?.length) return null

  const orderIds = [...new Set(batches.map(b => b.import_order_id))]
  const { data: orders } = await db
    .from('import_orders').select('id, issue_date').in('id', orderIds)
  const dateByOrder = new Map((orders ?? []).map(o => [o.id, o.issue_date as string]))

  // custo por data de emissão (média apenas dentro da mesma nota)
  const byDate = new Map<string, { v: number; q: number }>()
  for (const b of batches) {
    const d = dateByOrder.get(b.import_order_id) ?? '1900-01-01'
    const cur = byDate.get(d) ?? { v: 0, q: 0 }
    cur.v += Number(b.total_unit_cost) * Number(b.quantity_in_batch)
    cur.q += Number(b.quantity_in_batch)
    byDate.set(d, cur)
  }

  // Regrava a linha do tempo COMPLETA: apaga TODO custo não-manual do produto
  // (manual = total_stock_qty 1). Limpar só as datas com lote deixava camadas
  // fantasmas de recálculos antigos (era da média ponderada) vencendo a
  // vigência — caso MOVE DUO 2026-07-30: fantasma de 09/03 escondia a NF.
  const { data: olds } = await db
    .from('cmp_costs').select('id')
    .eq('product_id', productId)
    .neq('total_stock_qty', 1)
  if (olds?.length) {
    const oldIds = olds.map(o => o.id)
    await db.from('sale_costs').update({ cmp_cost_id: null }).in('cmp_cost_id', oldIds)
    await db.from('cmp_costs').delete().in('id', oldIds)
  }

  const now = new Date().toISOString()
  let lastValue: number | null = null
  for (const [date, { v, q }] of [...byDate.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (q === 0) continue
    const value = v / q
    await db.from('cmp_costs').insert({
      product_id:        productId,
      cmp_value:         value,
      total_stock_qty:   q,
      total_stock_value: v,
      calculated_at:     now,
      effective_date:    date,
    })
    lastValue = value
  }
  return lastValue
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
/**
 * Créditos recuperáveis por unidade (PIS + COFINS + ICMS) do lote de
 * IMPORTAÇÃO vigente na data da venda. Cada compra alimenta a base de crédito
 * por produto (regra do Bruno, 2026-07-28) — a margem da venda devolve esse
 * crédito, pois o débito da NF de saída entra cheio.
 * Compra NACIONAL não entra aqui: seus créditos já são abatidos no custo.
 */
async function getImportCreditAtDate(productId: string, saleDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  // Sem embed unit_costs→import_orders (não há FK declarada): junta em código
  const { data: rows } = await db.from('unit_costs')
    .select('pis_credit_unit, cofins_credit_unit, icms_credit_unit, quantity_in_batch, import_order_id')
    .eq('product_id', productId)
  if (!rows?.length) return 0
  const orderIds = [...new Set(rows.map(r => r.import_order_id))]
  const { data: orders } = await db.from('import_orders')
    .select('id, issue_date, cfop').in('id', orderIds)
  const byOrder = new Map((orders ?? []).map(o => [o.id, o]))

  const lots = rows.map(r => {
    const o = byOrder.get(r.import_order_id)
    return {
      date: (o?.issue_date as string) ?? '1900-01-01',
      isImport: String(o?.cfop ?? '').startsWith('3'),
      credit: Number(r.pis_credit_unit ?? 0) + Number(r.cofins_credit_unit ?? 0) + Number(r.icms_credit_unit ?? 0),
      qty: Number(r.quantity_in_batch ?? 0),
    }
  })
  // O crédito acompanha o MESMO lote que deu o custo (vigência do CMP):
  // lote mais recente com emissão <= data da venda, entre TODOS os lotes.
  // Se esse lote for nacional, crédito = 0 (já abatido no custo).
  const eligible = lots.filter(l => l.date <= saleDate)
  const pool = eligible.length ? eligible : lots
  const vigente = pool.reduce((best, l) => (l.date > best ? l.date : best), pool[0].date)
  const batch = pool.filter(l => l.date === vigente && l.isImport)
  if (!batch.length) return 0
  const q = batch.reduce((s, b) => s + b.qty, 0) || 1
  return batch.reduce((s, b) => s + b.credit * b.qty, 0) / q
}

export async function applyCmpToSale(saleId: string): Promise<void> {
  const db = createSupabaseServiceClient()

  const { data: sale } = await db
    .from('sales')
    .select('product_id, gross_price, shipping_received, marketplace_commission, marketplace_shipping_fee, marketplace_fixed_fee, ads_cost, cancellation, discounts, rebate, quantity, sale_date, sale_taxes(pis, cofins, icms, icms_difal, ipi)')
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
  // ATENÇÃO: shipping_received (frete pago pelo COMPRADOR) NÃO é receita —
  // no Mercado Envios esse valor vai para o ML/transportadora, nunca chega
  // ao vendedor (regra do Bruno, 2026-07-29). Fica gravado só como informação.
  // - marketplace_commission (comissão do canal)
  // - marketplace_shipping_fee (frete pago pelo vendedor ao canal/transportadora)
  // - ads_cost            (investimento em anúncios)
  // - cancellation        (devoluções/cancelamentos)
  // - discounts           (cupons/descontos concedidos ao comprador)
  // + rebate              (rebates recebidos: desconto tarifário ML, bonificação fornecedor, etc.)
  const netRevenue = Number(sale.gross_price)
                   - Number(sale.marketplace_commission ?? 0)
                   - Number(sale.marketplace_shipping_fee ?? 0)
                   - Number((sale as any).marketplace_fixed_fee ?? 0)
                   - Number(sale.ads_cost            ?? 0)
                   - Number(sale.cancellation        ?? 0)
                   - Number(sale.discounts           ?? 0)
                   + Number(sale.rebate              ?? 0)
                   - saleTaxes
  // Crédito da importação (PIS+COFINS+ICMS por unidade): devolvido à margem,
  // pois o débito da saída entra cheio e a compra gera crédito por produto
  const importCredit = (await getImportCreditAtDate(sale.product_id, sale.sale_date)) * qty

  // Sem NF-e ainda (impostos ausentes) → margem NULL ("em cálculo"),
  // não um número inflado com custos que ainda não chegaram.
  // Venda DEVOLVIDA também fica sem margem (mesma regra do relink): dinheiro
  // estornado, mercadoria de volta ao estoque, tarifas estornadas pelo canal.
  const hasTaxes    = !!t
  const contaMargem = hasTaxes && !isReturned(sale as any)
  const marginValue = contaMargem ? netRevenue - totalCost + importCredit : null
  // Margem % sobre o faturamento bruto (definição do Bruno)
  const gross       = Number(sale.gross_price)
  const marginPct   = contaMargem && gross > 0 ? (netRevenue - totalCost + importCredit) / gross : null

  await db.from('sale_costs').upsert({
    sale_id:           saleId,
    cmp_cost_id:       cmp.id,
    unit_cost_applied: cmp.value,
    total_cost:        totalCost,
    margin_value:      marginValue,
    margin_pct:        marginPct,
    import_credit:     Math.round(importCredit * 100) / 100,
  }, { onConflict: 'sale_id' })
}
