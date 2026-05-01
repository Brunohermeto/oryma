import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { SalesFilters } from '@/components/vendas/SalesFilters'
import { SalesTable } from '@/components/vendas/SalesTable'

export const dynamic = 'force-dynamic'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  subtle:   'oklch(0.40 0.020 258)',
  brand:    '#125BFF',
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

  const dateFrom   = params.from ?? format(startOfMonth(now), 'yyyy-MM-dd')
  const dateTo     = params.to ?? format(endOfMonth(now), 'yyyy-MM-dd')
  const marketplace = params.mp ?? ''
  const productId  = params.product ?? ''
  const fulfillment = params.fulfillment ?? ''

  const { data: products } = await db.from('products').select('id, name, sku').order('name')

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
  if (productId)   query = query.eq('product_id', productId)
  if (fulfillment) query = query.eq('fulfillment_type', fulfillment)

  const { data: sales } = await query

  const summary = (sales ?? []).reduce((acc, s) => {
    const taxes = (s.sale_taxes as any)?.[0]
    const cost  = (s.sale_costs as any)?.[0]
    acc.revenue += Number(s.gross_price) - Number(s.cancellation)
    acc.fees    += Number(s.marketplace_commission) + Number(s.marketplace_shipping_fee) + Number(s.ads_cost)
    acc.taxes   += Number(taxes?.total_taxes ?? 0)
    acc.cmv     += Number(cost?.total_cost ?? 0)
    acc.orders++
    if (cost?.margin_pct !== null && cost?.margin_pct !== undefined) {
      acc.marginSum += Number(cost.margin_pct)
      acc.marginCount++
    }
    return acc
  }, { revenue: 0, fees: 0, taxes: 0, cmv: 0, orders: 0, marginSum: 0, marginCount: 0 })

  const netRevenue  = summary.revenue - summary.taxes - summary.fees
  const grossProfit = netRevenue - summary.cmv
  const avgMargin   = summary.marginCount > 0 ? summary.marginSum / summary.marginCount : 0

  return (
    <>
      <TopBar
        title="Feed de Vendas"
        subtitle={`${summary.orders} vendas — ${dateFrom} a ${dateTo}`}
      />
      <div className="px-8 py-6 space-y-4">

        {/* Filters */}
        <SalesFilters
          products={products ?? []}
          currentFilters={{ dateFrom, dateTo, marketplace, productId, fulfillment }}
        />

        {/* Summary bar */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Faturamento Bruto', value: fmtR(summary.revenue), color: B.text, href: undefined },
            { label: 'Impostos + Tarifas + ADS', value: fmtR(summary.taxes + summary.fees), color: '#dc2626', href: undefined },
            { label: 'CMV (Custo Landed)', value: fmtR(summary.cmv), color: '#dc2626', href: undefined },
            { label: 'Lucro Bruto', value: fmtR(grossProfit), color: grossProfit >= 0 ? '#16a34a' : '#dc2626', href: undefined },
            { label: 'Margem Média', value: summary.marginCount > 0 ? fmtPct(avgMargin) : '—', color: avgMargin >= 0.35 ? '#16a34a' : avgMargin >= 0.20 ? '#d97706' : '#dc2626', href: undefined },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-xl px-4 py-3" style={{ border: `1px solid ${B.border}` }}>
              <div className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: B.muted }}>{card.label}</div>
              <div className="text-base font-bold num" style={{ color: card.color, fontFamily: 'var(--font-geist-mono)' }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Sales table */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid oklch(0.88 0.016 258)' }}>
          <div className="overflow-x-auto">
            <SalesTable sales={(sales ?? []).map(s => ({
              ...s,
              products: s.products as any,
              sale_taxes: (s.sale_taxes as any)?.[0] ?? null,
              sale_costs: (s.sale_costs as any)?.[0] ?? null,
            }))} />
          </div>
        </div>

        {(sales ?? []).length === 500 && (
          <p className="text-xs text-center" style={{ color: B.muted }}>
            Mostrando as 500 vendas mais recentes. Refine os filtros para ver menos resultados.
          </p>
        )}
      </div>
    </>
  )
}
