import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { MARKETPLACE_LABELS } from '@/types'
import { subDays, format, eachDayOfInterval } from 'date-fns'
import { SalesCurveChart } from '@/components/charts/SalesCurveChart'

export const dynamic = 'force-dynamic'

const MP_COLORS: Record<string, string> = {
  mercado_livre: '#f97316',
  shopee: '#ef4444',
  amazon: '#f59e0b',
}

export default async function VelocidadePage() {
  const db = createSupabaseServiceClient()
  const today = new Date()
  const d30 = format(subDays(today, 30), 'yyyy-MM-dd')
  const d60 = format(subDays(today, 60), 'yyyy-MM-dd')
  const d90 = format(subDays(today, 89), 'yyyy-MM-dd')

  const { data: products } = await db.from('products').select('id, name, sku, stock_quantity')

  // Load all sales last 90 days
  const { data: allSales } = await db
    .from('sales')
    .select('product_id, marketplace, quantity, sale_date')
    .gte('sale_date', d90)
    .order('sale_date')

  const days30 = eachDayOfInterval({ start: subDays(today, 29), end: today })

  const productRows = (products ?? []).map(product => {
    const productSales = (allSales ?? []).filter(s => s.product_id === product.id)
    const recentSales = productSales.filter(s => s.sale_date >= d30)
    const prevSales = productSales.filter(s => s.sale_date >= d60 && s.sale_date < d30)

    const byMP: Record<string, { recent: number; prev: number }> = {}
    for (const s of recentSales) {
      byMP[s.marketplace] = byMP[s.marketplace] ?? { recent: 0, prev: 0 }
      byMP[s.marketplace].recent += Number(s.quantity)
    }
    for (const s of prevSales) {
      byMP[s.marketplace] = byMP[s.marketplace] ?? { recent: 0, prev: 0 }
      byMP[s.marketplace].prev += Number(s.quantity)
    }

    const totalRecent = recentSales.reduce((s, r) => s + Number(r.quantity), 0)
    const totalPrev = prevSales.reduce((s, r) => s + Number(r.quantity), 0)
    const unitsPerDay = totalRecent / 30
    const daysOfStock = unitsPerDay > 0 ? Math.floor(Number(product.stock_quantity) / unitsPerDay) : null
    const trend = totalRecent > totalPrev * 1.1 ? 'up' : totalRecent < totalPrev * 0.9 ? 'down' : 'stable'

    // Build curve data (daily units, last 30 days, all marketplaces combined)
    const curveData = days30.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd')
      const units = productSales
        .filter(s => s.sale_date === dayStr)
        .reduce((s, r) => s + Number(r.quantity), 0)
      return { date: format(day, 'dd/MM'), units }
    })

    return { product, byMP, totalRecent, unitsPerDay, daysOfStock, trend, curveData }
  }).filter(r => r.totalRecent > 0 || Number(r.product.stock_quantity) > 0)
    .sort((a, b) => b.totalRecent - a.totalRecent)

  return (
    <>
      <TopBar title="Velocidade de Venda" subtitle="Curva de vendas e dias de estoque por produto — últimos 30 dias" />
      <div className="px-8 py-6 space-y-4">
        {productRows.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            Sem dados de venda. Sincronize os marketplaces em Configurações.
          </div>
        )}
        {productRows.map(({ product, byMP, totalRecent, unitsPerDay, daysOfStock, trend, curveData }) => (
          <div key={product.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
            {/* Product header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full mt-0.5 ${
                  trend === 'up' ? 'bg-green-400' : trend === 'down' ? 'bg-red-400' : 'bg-gray-300'
                }`} />
                <div>
                  <div className="font-semibold text-gray-900">{product.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">SKU: {product.sku}</div>
                </div>
              </div>
              <div className="flex items-center gap-6 text-right">
                <div>
                  <div className="text-xs text-gray-400">Vendidos (30d)</div>
                  <div className="text-lg font-bold text-gray-900">{totalRecent.toFixed(0)} un.</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Un./dia</div>
                  <div className="text-lg font-bold text-gray-900">{unitsPerDay.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Estoque atual</div>
                  <div className="text-lg font-bold text-gray-900">{Number(product.stock_quantity).toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Dias restantes</div>
                  <div className={`text-lg font-bold ${
                    daysOfStock === null ? 'text-gray-300' :
                    daysOfStock < 30 ? 'text-red-600' :
                    daysOfStock < 60 ? 'text-amber-500' : 'text-green-600'
                  }`}>
                    {daysOfStock === null ? '∞' : `${daysOfStock}d`}
                  </div>
                </div>
              </div>
            </div>

            {/* Sales curve */}
            <div className="px-6 pt-4 pb-2">
              <div className="text-xs text-gray-400 font-medium mb-2">Curva de vendas — últimos 30 dias (todas as plataformas)</div>
              <SalesCurveChart data={curveData} color="#6366f1" label="Unidades vendidas" />
            </div>

            {/* By marketplace */}
            {Object.keys(byMP).length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                <div className="flex gap-6">
                  {Object.entries(byMP).map(([mp, data]) => {
                    const mpUPD = data.recent / 30
                    const mpTrend = data.recent > data.prev * 1.1 ? '▲' : data.recent < data.prev * 0.9 ? '▼' : '→'
                    const mpTrendColor = data.recent > data.prev * 1.1 ? 'text-green-500' : data.recent < data.prev * 0.9 ? 'text-red-500' : 'text-gray-400'
                    return (
                      <div key={mp} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: MP_COLORS[mp] ?? '#6366f1' }} />
                        <span className="text-xs text-gray-600">{(MARKETPLACE_LABELS as any)[mp] ?? mp}</span>
<span className="text-xs font-semibold text-gray-800">{data.recent.toFixed(0)} un.</span>
                        <span className="text-xs font-medium text-gray-400">({mpUPD.toFixed(1)}/dia)</span>
                        <span className={`text-xs font-bold ${mpTrendColor}`}>{mpTrend}</span>
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
