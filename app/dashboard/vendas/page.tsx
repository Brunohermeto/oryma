import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { SalesFilters } from '@/components/vendas/SalesFilters'

export const dynamic = 'force-dynamic'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  subtle:   'oklch(0.40 0.020 258)',
  brand:    '#125BFF',
}

const MP_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}
// Oryma brand palette for marketplace badges
const MP_BADGE: Record<string, { bg: string; color: string }> = {
  mercado_livre: { bg: 'oklch(0.94 0.06 258)', color: '#125BFF' },
  shopee:        { bg: 'oklch(0.94 0.08 280)', color: '#7B61FF' },
  amazon:        { bg: 'oklch(0.94 0.08 204)', color: '#0097b2' },
}

const FULFILLMENT_LABELS: Record<string, string> = {
  galpao: 'Galpão', full_ml: 'Full ML', fba_amazon: 'FBA',
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

  function marginColor(m: number | null) {
    if (m === null) return B.muted
    if (m >= 0.35) return '#16a34a'
    if (m >= 0.20) return '#d97706'
    return '#dc2626'
  }

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

        {/* Summary cards */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Faturamento Bruto',      value: fmtR(summary.revenue),  color: B.text },
            { label: 'Impostos + Tarifas + ADS', value: fmtR(summary.taxes + summary.fees), color: '#dc2626' },
            { label: 'CMV (Custo Landed)',      value: fmtR(summary.cmv),       color: '#dc2626' },
            { label: 'Lucro Bruto',             value: fmtR(grossProfit),        color: grossProfit >= 0 ? '#16a34a' : '#dc2626' },
            { label: 'Margem Média',            value: summary.marginCount > 0 ? fmtPct(avgMargin) : '—', color: marginColor(avgMargin) },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-xl px-4 py-3" style={{ border: `1px solid ${B.border}` }}>
              <div className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: B.muted }}>
                {card.label}
              </div>
              <div className="text-base font-bold num" style={{ color: card.color, fontFamily: 'var(--font-geist-mono)' }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        {/* Sales table */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}>
                  {['Data','Produto','Canal','Qtd.','Preço unit.','Faturamento','Impostos','Tarifa MP','ADS','Custo (CMV)','Lucro','Margem'].map((h, i) => (
                    <th
                      key={h}
                      className={`py-3 text-[11px] font-semibold uppercase tracking-wide ${i < 3 ? 'text-left px-4' : 'text-right px-4'} ${i === 11 ? 'px-5' : ''}`}
                      style={{ color: B.muted }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(sales ?? []).length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-5 py-10 text-center text-sm" style={{ color: B.muted }}>
                      Nenhuma venda encontrada para os filtros selecionados.
                    </td>
                  </tr>
                )}
                {(sales ?? []).map(sale => {
                  const taxes   = (sale.sale_taxes as any)?.[0]
                  const cost    = (sale.sale_costs as any)?.[0]
                  const product = sale.products as any
                  const totalTaxes = Number(taxes?.total_taxes ?? 0)
                  const totalFees  = Number(sale.marketplace_commission) + Number(sale.marketplace_shipping_fee)
                  const adsC       = Number(sale.ads_cost)
                  const faturamento = Number(sale.gross_price) - Number(sale.cancellation)
                  const cmv        = Number(cost?.total_cost ?? 0)
                  const lucro      = cost ? faturamento - totalTaxes - totalFees - adsC - cmv : null
                  const marginPct  = cost?.margin_pct !== null && cost?.margin_pct !== undefined ? Number(cost.margin_pct) : null
                  const badge      = MP_BADGE[sale.marketplace] ?? { bg: B.bgSubtle, color: B.brand }

                  return (
                    <tr
                      key={sale.id}
                      className="transition-colors"
                      style={{ borderBottom: `1px solid ${B.bgSubtle}` }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = B.bgSubtle }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                    >
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: B.muted }}>{sale.sale_date}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-xs leading-tight" style={{ color: B.text }}>{product?.name ?? '—'}</div>
                        <div className="text-xs" style={{ color: B.muted }}>{sale.sku} · {FULFILLMENT_LABELS[sale.fulfillment_type] ?? sale.fulfillment_type}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>
                          {MP_LABELS[sale.marketplace] ?? sale.marketplace}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs" style={{ color: B.subtle }}>{Number(sale.quantity).toFixed(0)}</td>
                      <td className="px-4 py-2.5 text-right text-xs" style={{ color: B.subtle }}>
                        {Number(sale.quantity) > 0 ? fmtR(faturamento / Number(sale.quantity)) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium num" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                        {fmtR(faturamento)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                        {totalTaxes > 0 ? `(${fmtR(totalTaxes)})` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                        {totalFees > 0 ? `(${fmtR(totalFees)})` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                        {adsC > 0 ? `(${fmtR(adsC)})` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                        {cmv > 0 ? `(${fmtR(cmv)})` : <span style={{ color: B.muted }}>sem custo</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-semibold num" style={{ color: lucro === null ? B.muted : lucro >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                        {lucro !== null ? fmtR(lucro) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right font-bold text-sm num" style={{ color: marginColor(marginPct), fontFamily: 'var(--font-geist-mono)' }}>
                        {marginPct !== null ? fmtPct(marginPct) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {(sales ?? []).length > 0 && (
                <tfoot style={{ borderTop: `2px solid ${B.border}`, background: B.bgSubtle }}>
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold" style={{ color: B.subtle }}>
                      TOTAL — {summary.orders} vendas
                    </td>
                    <td className="px-4 py-3 text-right font-bold num" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{fmtR(summary.revenue)}</td>
                    <td className="px-4 py-3 text-right font-bold text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>{summary.taxes > 0 ? `(${fmtR(summary.taxes)})` : '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>{summary.fees > 0 ? `(${fmtR(summary.fees)})` : '—'}</td>
                    <td className="px-4 py-3 text-right" style={{ color: B.muted }}>—</td>
                    <td className="px-4 py-3 text-right font-bold text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>{summary.cmv > 0 ? `(${fmtR(summary.cmv)})` : '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-lg num" style={{ color: grossProfit >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>{fmtR(grossProfit)}</td>
                    <td className="px-5 py-3 text-right font-bold text-base num" style={{ color: marginColor(avgMargin), fontFamily: 'var(--font-geist-mono)' }}>
                      {summary.marginCount > 0 ? fmtPct(avgMargin) : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
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
