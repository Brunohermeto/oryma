import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { SalesFilters } from '@/components/vendas/SalesFilters'

export const dynamic = 'force-dynamic'

const MP_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}
const MP_COLORS: Record<string, string> = {
  mercado_livre: 'bg-orange-100 text-orange-700',
  shopee: 'bg-red-100 text-red-700',
  amazon: 'bg-yellow-100 text-yellow-700',
}
const FULFILLMENT_LABELS: Record<string, string> = {
  galpao: 'Galpão',
  full_ml: 'Full ML',
  fba_amazon: 'FBA',
}

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}
function fmtPct(v: number) {
  return `${(Number(v) * 100).toFixed(1)}%`
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; mp?: string; product?: string; fulfillment?: string }>
}) {
  const db = createSupabaseServiceClient()
  const params = await searchParams
  const now = new Date()

  // Default: current month
  const dateFrom = params.from ?? format(startOfMonth(now), 'yyyy-MM-dd')
  const dateTo = params.to ?? format(endOfMonth(now), 'yyyy-MM-dd')
  const marketplace = params.mp ?? ''
  const productId = params.product ?? ''
  const fulfillment = params.fulfillment ?? ''

  // Load products for filter dropdown
  const { data: products } = await db.from('products').select('id, name, sku').order('name')

  // Build sales query with filters
  let query = db
    .from('sales')
    .select(`
      id, external_order_id, marketplace, fulfillment_type, sku, sale_date,
      quantity, gross_price, shipping_received, marketplace_commission,
      marketplace_shipping_fee, ads_cost, cancellation, discounts,
      products(name, sku),
      sale_taxes(pis, cofins, icms, icms_difal, ipi, total_taxes),
      sale_costs(unit_cost_applied, total_cost, margin_value, margin_pct)
    `)
    .gte('sale_date', dateFrom)
    .lte('sale_date', dateTo)
    .order('sale_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(500)

  if (marketplace) query = query.eq('marketplace', marketplace)
  if (productId) query = query.eq('product_id', productId)
  if (fulfillment) query = query.eq('fulfillment_type', fulfillment)

  const { data: sales } = await query

  // Compute summary
  const summary = (sales ?? []).reduce((acc, s) => {
    const taxes = (s.sale_taxes as any)?.[0]
    const cost = (s.sale_costs as any)?.[0]
    acc.revenue += Number(s.gross_price) - Number(s.cancellation)
    acc.fees += Number(s.marketplace_commission) + Number(s.marketplace_shipping_fee) + Number(s.ads_cost)
    acc.taxes += Number(taxes?.total_taxes ?? 0)
    acc.cmv += Number(cost?.total_cost ?? 0)
    acc.orders++
    if (cost?.margin_pct !== null && cost?.margin_pct !== undefined) {
      acc.marginSum += Number(cost.margin_pct)
      acc.marginCount++
    }
    return acc
  }, { revenue: 0, fees: 0, taxes: 0, cmv: 0, orders: 0, marginSum: 0, marginCount: 0 })

  const netRevenue = summary.revenue - summary.taxes - summary.fees
  const grossProfit = netRevenue - summary.cmv
  const avgMargin = summary.marginCount > 0 ? summary.marginSum / summary.marginCount : 0

  return (
    <>
      <TopBar
        title="Vendas"
        subtitle={`${summary.orders} vendas encontradas — ${dateFrom} a ${dateTo}`}
      />
      <div className="px-8 py-6 space-y-4">

        {/* Filters */}
        <SalesFilters
          products={products ?? []}
          currentFilters={{ dateFrom, dateTo, marketplace, productId, fulfillment }}
        />

        {/* Summary cards */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Faturamento Bruto', value: fmtR(summary.revenue), color: 'text-gray-900' },
            { label: 'Impostos + Tarifas + ADS', value: fmtR(summary.taxes + summary.fees), color: 'text-red-500' },
            { label: 'CMV (Custo Landed)', value: fmtR(summary.cmv), color: 'text-red-500' },
            { label: 'Lucro Bruto', value: fmtR(grossProfit), color: grossProfit >= 0 ? 'text-green-600' : 'text-red-600' },
            { label: 'Margem Média', value: summary.marginCount > 0 ? fmtPct(avgMargin) : '—', color: avgMargin >= 0.35 ? 'text-green-600' : avgMargin >= 0.20 ? 'text-amber-500' : 'text-red-500' },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
              <div className="text-xs text-gray-400 mb-1">{card.label}</div>
              <div className={`text-base font-bold ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Sales table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3">Data</th>
                  <th className="text-left px-4 py-3">Produto</th>
                  <th className="text-left px-4 py-3">Canal</th>
                  <th className="text-right px-4 py-3">Qtd.</th>
                  <th className="text-right px-4 py-3">Preço unit.</th>
                  <th className="text-right px-4 py-3">Faturamento</th>
                  <th className="text-right px-4 py-3">Impostos</th>
                  <th className="text-right px-4 py-3">Tarifa MP</th>
                  <th className="text-right px-4 py-3">ADS</th>
                  <th className="text-right px-4 py-3">Custo (CMV)</th>
                  <th className="text-right px-4 py-3">Lucro</th>
                  <th className="text-right px-5 py-3">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(sales ?? []).length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-5 py-10 text-center text-gray-400 text-sm">
                      Nenhuma venda encontrada para os filtros selecionados.
                    </td>
                  </tr>
                )}
                {(sales ?? []).map(sale => {
                  const taxes = (sale.sale_taxes as any)?.[0]
                  const cost = (sale.sale_costs as any)?.[0]
                  const product = sale.products as any
                  const totalTaxes = Number(taxes?.total_taxes ?? 0)
                  const totalFees = Number(sale.marketplace_commission) + Number(sale.marketplace_shipping_fee)
                  const adsC = Number(sale.ads_cost)
                  const faturamento = Number(sale.gross_price) - Number(sale.cancellation)
                  const cmv = Number(cost?.total_cost ?? 0)
                  const lucro = cost ? faturamento - totalTaxes - totalFees - adsC - cmv : null
                  const marginPct = cost?.margin_pct !== null && cost?.margin_pct !== undefined ? Number(cost.margin_pct) : null

                  return (
                    <tr key={sale.id} className="hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{sale.sale_date}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-800 text-xs leading-tight">{product?.name ?? '—'}</div>
                        <div className="text-gray-400 text-xs">{sale.sku} · {FULFILLMENT_LABELS[sale.fulfillment_type] ?? sale.fulfillment_type}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${MP_COLORS[sale.marketplace] ?? 'bg-gray-100 text-gray-600'}`}>
                          {MP_LABELS[sale.marketplace] ?? sale.marketplace}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 text-xs">{Number(sale.quantity).toFixed(0)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 text-xs">
                        {Number(sale.quantity) > 0 ? fmtR(faturamento / Number(sale.quantity)) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-gray-800">{fmtR(faturamento)}</td>
                      <td className="px-4 py-2.5 text-right text-red-400 text-xs">
                        {totalTaxes > 0 ? `(${fmtR(totalTaxes)})` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-red-400 text-xs">
                        {totalFees > 0 ? `(${fmtR(totalFees)})` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-red-400 text-xs">
                        {adsC > 0 ? `(${fmtR(adsC)})` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-red-400 text-xs">
                        {cmv > 0 ? `(${fmtR(cmv)})` : <span className="text-gray-300">sem custo</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs font-semibold ${
                        lucro === null ? 'text-gray-300' : lucro >= 0 ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {lucro !== null ? fmtR(lucro) : '—'}
                      </td>
                      <td className={`px-5 py-2.5 text-right font-bold text-sm ${
                        marginPct === null ? 'text-gray-300' :
                        marginPct >= 0.35 ? 'text-green-600' :
                        marginPct >= 0.20 ? 'text-amber-500' : 'text-red-500'
                      }`}>
                        {marginPct !== null ? fmtPct(marginPct) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Footer totals */}
              {(sales ?? []).length > 0 && (
                <tfoot className="border-t-2 border-gray-200 bg-slate-50">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-600">
                      TOTAL — {summary.orders} vendas
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmtR(summary.revenue)}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-500 text-xs">{summary.taxes > 0 ? `(${fmtR(summary.taxes)})` : '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-500 text-xs">{summary.fees > 0 ? `(${fmtR(summary.fees)})` : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">—</td>
                    <td className="px-4 py-3 text-right font-bold text-red-500 text-xs">{summary.cmv > 0 ? `(${fmtR(summary.cmv)})` : '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-lg" style={{ color: grossProfit >= 0 ? '#16a34a' : '#dc2626' }}>{fmtR(grossProfit)}</td>
                    <td className="px-5 py-3 text-right font-bold text-base" style={{ color: avgMargin >= 0.35 ? '#16a34a' : avgMargin >= 0.20 ? '#d97706' : '#dc2626' }}>
                      {summary.marginCount > 0 ? fmtPct(avgMargin) : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {(sales ?? []).length === 500 && (
          <p className="text-xs text-center text-gray-400">Mostrando as 500 vendas mais recentes. Refine os filtros para ver menos resultados.</p>
        )}
      </div>
    </>
  )
}
