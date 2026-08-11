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
import { isReturned } from '@/lib/sales/returned'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) {
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
    // SKUs dos anúncios ≠ SKU do cadastro (EAN) — apelidos conhecidos,
    // confirmados pelo EAN das NF-e (venda galpão não passa pelo casamento por EAN)
    const SKU_ALIASES: Record<string, string> = {
      'MOVETRIO': '7908488106449', 'MOVEDUO': '7908488105732',
      '0209': '7908488108085', '020984': '7908488108221',
      '0109P': '7908488100980', '010984P': '7908488108290',
      '0210MG': '7908488108351', '021084MG': '7908488108313',
    }
    const skuUp = sale.sku?.toUpperCase()
    const productId = productMap[skuUp] ?? productMap[SKU_ALIASES[skuUp] ?? '']
    if (!productId) continue
    await db.from('sales').update({ product_id: productId }).eq('id', sale.id)
    salesLinked++
  }

  // 6. Aplica CMP histórico a TODAS as vendas
  //    Para cada venda usa o CMP com effective_date <= sale_date (CMP vigente na época)
  //    Bulk: carrega todos os CMPs ordenados por data e todas as vendas de uma vez

  // Pagina pelas tabelas em blocos de 1000 para contornar o max-rows do PostgREST
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll<T>(builder: () => any): Promise<T[]> {
    const PAGE = 1000
    const rows: T[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await (builder() as any).range(offset, offset + PAGE - 1)
      if (error || !data?.length) break
      rows.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return rows
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [allCmps, allSales, allTaxes]: [any[], any[], any[]] = await Promise.all([
    fetchAll<any>(() =>
      db.from('cmp_costs')
        .select('id, product_id, cmp_value, effective_date')
        // desempate entre recálculos com a mesma vigência: o mais recente vence
        // (a lista é ASC e o consumidor pega o último match)
        .order('effective_date', { ascending: true })
        .order('calculated_at', { ascending: true })
    ),
    fetchAll<any>(() =>
      db.from('sales')
        .select('id, product_id, marketplace, gross_price, shipping_received, marketplace_commission, marketplace_shipping_fee, marketplace_fixed_fee, ads_cost, cancellation, discounts, rebate, quantity, sale_date')
        .not('product_id', 'is', null)
    ),
    fetchAll<any>(() =>
      db.from('sale_taxes')
        .select('sale_id, pis, cofins, icms, icms_difal, ipi')
    ),
  ])

  // Mapa de impostos por sale_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taxBySale = new Map<string, any>()
  for (const t of allTaxes ?? []) taxBySale.set(t.sale_id, t)

  // ── Créditos de importação por produto (PIS+COFINS+ICMS por unidade, por lote) ──
  // Regra: o crédito acompanha o MESMO lote que dá o custo (vigência). Lote
  // nacional → crédito 0 (já abatido no custo). Espelha getImportCreditAtDate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [allUnitCosts, allImportOrders]: [any[], any[]] = await Promise.all([
    fetchAll<any>(() => db.from('unit_costs')
      .select('product_id, import_order_id, pis_credit_unit, cofins_credit_unit, icms_credit_unit, quantity_in_batch')),
    fetchAll<any>(() => db.from('import_orders').select('id, issue_date, cfop')),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderById = new Map<string, any>((allImportOrders ?? []).map(o => [o.id, o]))
  // product → lotes {date, isImport, credit, qty} ordenados ASC por data
  const lotsByProduct = new Map<string, Array<{ date: string; isImport: boolean; credit: number; qty: number }>>()
  for (const u of allUnitCosts ?? []) {
    const o = orderById.get(u.import_order_id)
    if (!lotsByProduct.has(u.product_id)) lotsByProduct.set(u.product_id, [])
    lotsByProduct.get(u.product_id)!.push({
      date: (o?.issue_date as string) ?? '1900-01-01',
      isImport: String(o?.cfop ?? '').startsWith('3'),
      credit: Number(u.pis_credit_unit ?? 0) + Number(u.cofins_credit_unit ?? 0) + Number(u.icms_credit_unit ?? 0),
      qty: Number(u.quantity_in_batch ?? 0),
    })
  }
  for (const list of lotsByProduct.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1))

  function getCreditForDate(productId: string, saleDate: string): number {
    const list = lotsByProduct.get(productId)
    if (!list?.length) return 0
    let vigente: string | null = null
    for (const l of list) {
      if (l.date <= saleDate) vigente = l.date
      else break
    }
    if (!vigente) vigente = list[0].date  // venda anterior ao primeiro lote
    const batch = list.filter(l => l.date === vigente && l.isImport)
    if (!batch.length) return 0
    const q = batch.reduce((s, b) => s + b.qty, 0) || 1
    return batch.reduce((s, b) => s + b.credit * b.qty, 0) / q
  }

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
    margin_value: number | null; margin_pct: number | null
    import_credit: number
  }> = []

  for (const sale of allSales ?? []) {
    const cmp = getCmpForDate(sale.product_id, sale.sale_date)
    if (!cmp) continue
    const qty         = Number(sale.quantity) || 1
    const totalCost   = cmp.value * qty
    const taxes       = taxBySale.get(sale.id)
    const totalTaxes  = taxes
      ? Number(taxes.pis       ?? 0)
      + Number(taxes.cofins    ?? 0)
      + Number(taxes.icms      ?? 0)
      + Number(taxes.icms_difal ?? 0)
      + Number(taxes.ipi       ?? 0)
      : 0
    // shipping_received (frete do COMPRADOR) NÃO é receita: vai para o
    // ML/transportadora no Mercado Envios — nunca chega ao vendedor
    const netRevenue  = Number(sale.gross_price)
                      - Number(sale.marketplace_commission   ?? 0)
                      - Number(sale.marketplace_shipping_fee ?? 0)
                      - Number(sale.marketplace_fixed_fee    ?? 0)
                      - Number(sale.ads_cost                 ?? 0)
                      - Number(sale.cancellation             ?? 0)
                      - Number(sale.discounts                ?? 0)
                      + Number(sale.rebate                   ?? 0)
                      - totalTaxes  // impostos da NF-e saída
    // Sem NF-e de saída ainda (impostos ausentes) = dados incompletos →
    // margem fica NULL ("em cálculo") em vez de um número inflado e falso
    // Crédito de importação das unidades (devolvido à margem — débito da saída entra cheio)
    const importCredit = getCreditForDate(sale.product_id, sale.sale_date) * qty
    const hasTaxes    = !!taxes
    // Venda devolvida fica SEM margem (null): dinheiro estornado ao comprador e
    // mercadoria de volta no estoque — margem calculada aqui seria só prejuízo
    // fantasma. Null já é ignorado por todos os agregadores de margem.
    const contaMargem = hasTaxes && !isReturned(sale)
    const marginValue = contaMargem ? netRevenue - totalCost + importCredit : null
    // Margem % sobre o faturamento bruto (definição do Bruno)
    const gross       = Number(sale.gross_price)
    const marginPct   = contaMargem && gross > 0 ? (netRevenue - totalCost + importCredit) / gross : null
    saleCostRows.push({
      sale_id: sale.id, cmp_cost_id: cmp.id,
      unit_cost_applied: cmp.value, total_cost: totalCost,
      margin_value: marginValue, margin_pct: marginPct,
      import_credit: Math.round(importCredit * 100) / 100,
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
