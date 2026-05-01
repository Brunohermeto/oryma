import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { MARKETPLACE_LABELS } from '@/types'
import { subDays, format, eachDayOfInterval } from 'date-fns'
import { SalesCurveChart } from '@/components/charts/SalesCurveChart'
import { ExternalLink } from 'lucide-react'

export const dynamic = 'force-dynamic'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

// Oryma brand colors for marketplaces
const MP_COLORS: Record<string, string> = {
  mercado_livre: '#125BFF',
  shopee:        '#7B61FF',
  amazon:        '#00D6FF',
}

export default async function VelocidadePage() {
  const db = createSupabaseServiceClient()
  const today = new Date()
  const d30 = format(subDays(today, 30), 'yyyy-MM-dd')
  const d60 = format(subDays(today, 60), 'yyyy-MM-dd')
  const d90 = format(subDays(today, 89), 'yyyy-MM-dd')

  const { data: products } = await db.from('products').select('id, name, sku, stock_quantity')

  const { data: allSales } = await db
    .from('sales')
    .select('product_id, marketplace, quantity, sale_date')
    .gte('sale_date', d90)
    .order('sale_date')

  const days30 = eachDayOfInterval({ start: subDays(today, 29), end: today })

  const productRows = (products ?? []).map(product => {
    const productSales = (allSales ?? []).filter(s => s.product_id === product.id)
    const recentSales  = productSales.filter(s => s.sale_date >= d30)
    const prevSales    = productSales.filter(s => s.sale_date >= d60 && s.sale_date < d30)

    const byMP: Record<string, { recent: number; prev: number }> = {}
    for (const s of recentSales) {
      byMP[s.marketplace] = byMP[s.marketplace] ?? { recent: 0, prev: 0 }
      byMP[s.marketplace].recent += Number(s.quantity)
    }
    for (const s of prevSales) {
      byMP[s.marketplace] = byMP[s.marketplace] ?? { recent: 0, prev: 0 }
      byMP[s.marketplace].prev += Number(s.quantity)
    }

    const totalRecent  = recentSales.reduce((s, r) => s + Number(r.quantity), 0)
    const totalPrev    = prevSales.reduce((s, r) => s + Number(r.quantity), 0)
    const unitsPerDay  = totalRecent / 30
    const daysOfStock  = unitsPerDay > 0 ? Math.floor(Number(product.stock_quantity) / unitsPerDay) : null
    const trend        = totalRecent > totalPrev * 1.1 ? 'up' : totalRecent < totalPrev * 0.9 ? 'down' : 'stable'

    const curveData = days30.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd')
      const units  = productSales.filter(s => s.sale_date === dayStr).reduce((s, r) => s + Number(r.quantity), 0)
      return { date: format(day, 'dd/MM'), units }
    })

    return { product, byMP, totalRecent, unitsPerDay, daysOfStock, trend, curveData }
  }).filter(r => r.totalRecent > 0 || Number(r.product.stock_quantity) > 0)
    .sort((a, b) => b.totalRecent - a.totalRecent)

  function stockColor(days: number | null) {
    if (days === null) return B.muted
    if (days < 30) return '#dc2626'
    if (days < 60) return '#d97706'
    return '#16a34a'
  }

  return (
    <>
      <TopBar title="Velocidade de Venda" subtitle="Curva de vendas e dias de estoque por produto — últimos 30 dias" />
      <div className="px-8 py-6 space-y-4">

        {productRows.length === 0 && (
          <div className="bg-white rounded-xl p-8 text-center text-sm" style={{ border: `1px solid ${B.border}`, color: B.muted }}>
            Sem dados de venda. Sincronize os marketplaces em Configurações.
          </div>
        )}

        {productRows.map(({ product, byMP, totalRecent, unitsPerDay, daysOfStock, trend, curveData }) => (
          <div key={product.id} className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>

            {/* Header */}
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${B.border}` }}>
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{
                  background: trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : B.muted
                }} />
                <div>
                  <div className="font-semibold" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>{product.name}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs" style={{ color: B.muted }}>SKU: {product.sku}</span>
                    <a
                      href={`/dashboard/vendas?product=${product.id}`}
                      className="flex items-center gap-1 text-xs underline"
                      style={{ color: B.brand }}
                    >
                      <ExternalLink size={10} />
                      Ver vendas
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-8 text-right">
                {[
                  { label: 'Vendidos (30d)', value: `${totalRecent.toFixed(0)} un.`, color: B.text },
                  { label: 'Un./dia',        value: unitsPerDay.toFixed(1), color: B.brand },
                  { label: 'Estoque atual',  value: Number(product.stock_quantity).toFixed(0), color: B.text },
                  { label: 'Dias restantes', value: daysOfStock === null ? '∞' : `${daysOfStock}d`, color: stockColor(daysOfStock) },
                ].map(item => (
                  <div key={item.label}>
                    <div className="text-[11px] uppercase tracking-wide" style={{ color: B.muted }}>{item.label}</div>
                    <div className="text-lg font-bold num" style={{ color: item.color, fontFamily: 'var(--font-geist-mono)' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sales curve */}
            <div className="px-6 pt-4 pb-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: B.muted }}>
                Curva de vendas — últimos 30 dias
              </div>
              <SalesCurveChart data={curveData} color={B.brand} label="Unidades vendidas" />
            </div>

            {/* By marketplace */}
            {Object.keys(byMP).length > 0 && (
              <div className="px-6 py-3" style={{ background: B.bgSubtle, borderTop: `1px solid ${B.border}` }}>
                <div className="flex gap-6 flex-wrap">
                  {Object.entries(byMP).map(([mp, data]) => {
                    const mpUPD = data.recent / 30
                    const trendUp   = data.recent > data.prev * 1.1
                    const trendDown = data.recent < data.prev * 0.9
                    return (
                      <div key={mp} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: MP_COLORS[mp] ?? B.brand }} />
                        <span className="text-xs" style={{ color: B.muted }}>{(MARKETPLACE_LABELS as any)[mp] ?? mp}</span>
                        <span className="text-xs font-semibold" style={{ color: B.text }}>{data.recent.toFixed(0)} un.</span>
                        <span className="text-xs" style={{ color: B.muted }}>({mpUPD.toFixed(1)}/dia)</span>
                        <span className="text-xs font-bold" style={{ color: trendUp ? '#16a34a' : trendDown ? '#dc2626' : B.muted }}>
                          {trendUp ? '▲' : trendDown ? '▼' : '→'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
