/**
 * GET /api/debug/sales-status
 * Diagnóstico completo: mostra estado real dos dados de vendas, custos e SKUs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  const [
    salesRes,
    saleCostsRes,
    saleTaxesRes,
    productsRes,
    cmpRes,
  ] = await Promise.all([
    db.from('sales')
      .select('id, external_order_id, sku, product_id, marketplace_commission, marketplace_shipping_fee, gross_price, sale_date, rebate')
      .order('sale_date', { ascending: false })
      .limit(20),
    db.from('sale_costs').select('sale_id, unit_cost_applied, total_cost, margin_pct').limit(20),
    db.from('sale_taxes').select('sale_id, pis, cofins, total_taxes').limit(20),
    db.from('products').select('id, sku, name'),
    db.from('cmp_costs').select('product_id, cmp_value, effective_date').order('effective_date', { ascending: false }).limit(10),
  ])

  const sales = salesRes.data ?? []
  const saleCosts = new Set((saleCostsRes.data ?? []).map(s => s.sale_id))
  const saleTaxes = new Set((saleTaxesRes.data ?? []).map(s => s.sale_id))
  const products  = productsRes.data ?? []
  const productMap = Object.fromEntries(products.map(p => [p.id, p.sku]))

  // Diagnóstico por venda
  const salesDiag = sales.map(s => ({
    id:           s.id.slice(-8),
    date:         s.sale_date,
    sku_stored:   s.sku,
    product_id:   s.product_id ? productMap[s.product_id] ?? s.product_id.slice(-8) : 'NULL ⚠️',
    commission:   Number(s.marketplace_commission ?? 0),
    shipping_fee: Number(s.marketplace_shipping_fee ?? 0),
    gross_price:  Number(s.gross_price),
    rebate_col:   s.rebate !== undefined ? '✓ existe' : '❌ sem coluna',
    has_costs:    saleCosts.has(s.id) ? '✓' : '❌',
    has_taxes:    saleTaxes.has(s.id) ? '✓' : '❌',
  }))

  // Resumo
  const totalSales         = sales.length
  const withProductId      = sales.filter(s => s.product_id !== null).length
  const withCommission     = sales.filter(s => Number(s.marketplace_commission ?? 0) > 0).length
  const withCosts          = sales.filter(s => saleCosts.has(s.id)).length
  const withTaxes          = sales.filter(s => saleTaxes.has(s.id)).length
  const rebateColExists    = sales.length > 0 && sales[0].rebate !== undefined

  // SKUs únicos nas vendas vs produtos
  const skusInSales    = [...new Set(sales.map(s => s.sku).filter(Boolean))]
  const skusInProducts = products.map(p => p.sku)
  const skuMatches     = skusInSales.filter(sku => skusInProducts.includes(sku ?? ''))
  const skuMismatches  = skusInSales.filter(sku => !skusInProducts.includes(sku ?? ''))

  return NextResponse.json({
    summary: {
      total_sales_shown:     totalSales,
      with_product_id:       `${withProductId}/${totalSales}`,
      with_commission_gt0:   `${withCommission}/${totalSales}`,
      with_sale_costs:       `${withCosts}/${totalSales}`,
      with_sale_taxes:       `${withTaxes}/${totalSales}`,
      rebate_column_exists:  rebateColExists,
    },
    sku_analysis: {
      skus_in_sales:     skusInSales,
      skus_in_products:  skusInProducts,
      matches:           skuMatches,
      mismatches_warn:   skuMismatches,
    },
    cmp_costs: (cmpRes.data ?? []).map(c => ({
      product: productMap[c.product_id] ?? c.product_id?.slice(-8),
      cmp:     Number(c.cmp_value).toFixed(2),
      date:    c.effective_date,
    })),
    last_20_sales: salesDiag,
    errors: {
      salesRes:    salesRes.error?.message,
      saleCostsRes: saleCostsRes.error?.message,
      productsRes: productsRes.error?.message,
    },
  })
}
