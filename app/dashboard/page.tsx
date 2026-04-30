import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth, subMonths, subDays, eachDayOfInterval } from 'date-fns'
import { RevenueLineChart } from '@/components/charts/RevenueLineChart'
import { MarketplaceBarChart } from '@/components/charts/MarketplaceBarChart'

export const dynamic = 'force-dynamic'

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }
function fmtPct(v: number) { return `${v.toFixed(1)}%` }

const MP_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}
const MP_COLORS: Record<string, string> = {
  mercado_livre: '#f97316',
  shopee: '#ef4444',
  amazon: '#f59e0b',
}

export default async function DashboardPage() {
  const db = createSupabaseServiceClient()
  const now = new Date()
  const start = format(startOfMonth(now), 'yyyy-MM-dd')
  const end = format(endOfMonth(now), 'yyyy-MM-dd')
  const prevStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const prevEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const last30Start = format(subDays(now, 29), 'yyyy-MM-dd')

  // Current month
  const { data: sales } = await db
    .from('sales')
    .select('marketplace, gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, sale_date, sale_costs(total_cost, margin_value)')
    .gte('sale_date', start)
    .lte('sale_date', end)

  // Previous month
  const { data: prevSales } = await db
    .from('sales')
    .select('gross_price')
    .gte('sale_date', prevStart)
    .lte('sale_date', prevEnd)

  // Last 30 days for trend chart
  const { data: trendSales } = await db
    .from('sales')
    .select('marketplace, gross_price, sale_date')
    .gte('sale_date', last30Start)
    .lte('sale_date', format(now, 'yyyy-MM-dd'))

  // Pending NF-e
  const { count: pendingNFe } = await db
    .from('import_orders')
    .select('id', { count: 'exact', head: true })
    .eq('costs_complete', false)

  // Last sync
  const { data: lastSync } = await db
    .from('sync_logs')
    .select('started_at, source')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  // Top products by margin
  const { data: topProductSales } = await db
    .from('sales')
    .select('product_id, gross_price, marketplace_commission, sale_costs(total_cost, margin_pct), products(name, sku)')
    .gte('sale_date', start)
    .lte('sale_date', end)
    .not('sale_costs', 'is', null)

  // ── Compute KPIs ──
  const totalRevenue = (sales ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation), 0)
  const prevRevenue = (prevSales ?? []).reduce((s, r) => s + Number(r.gross_price), 0)
  const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0
  const totalFees = (sales ?? []).reduce((s, r) => s + Number(r.marketplace_commission) + Number(r.marketplace_shipping_fee) + Number(r.ads_cost), 0)
  const totalCMV = (sales ?? []).reduce((s, r) => s + Number((r.sale_costs as any)?.[0]?.total_cost ?? 0), 0)
  const netRevenue = totalRevenue - totalFees
  const grossProfit = netRevenue - totalCMV
  const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0
  const totalOrders = (sales ?? []).length

  // ── Revenue by marketplace ──
  const byMP: Record<string, { revenue: number; fees: number; cmv: number; orders: number }> = {}
  for (const s of sales ?? []) {
    const mp = s.marketplace
    if (!byMP[mp]) byMP[mp] = { revenue: 0, fees: 0, cmv: 0, orders: 0 }
    byMP[mp].revenue += Number(s.gross_price) - Number(s.cancellation)
    byMP[mp].fees += Number(s.marketplace_commission) + Number(s.marketplace_shipping_fee) + Number(s.ads_cost)
    byMP[mp].cmv += Number((s.sale_costs as any)?.[0]?.total_cost ?? 0)
    byMP[mp].orders++
  }

  // ── Trend chart data (daily revenue by marketplace, last 30 days) ──
  const days = eachDayOfInterval({ start: subDays(now, 29), end: now })
  const trendData = days.map(day => {
    const dateStr = format(day, 'dd/MM')
    const dayStr = format(day, 'yyyy-MM-dd')
    const row: any = { date: dateStr }
    for (const mp of ['mercado_livre', 'shopee', 'amazon']) {
      row[mp] = (trendSales ?? [])
        .filter(s => s.sale_date === dayStr && s.marketplace === mp)
        .reduce((s, r) => s + Number(r.gross_price), 0)
    }
    return row
  })

  // ── Marketplace bar chart data ──
  const barData = Object.entries(byMP).map(([mp, d]) => {
    const net = d.revenue - d.fees
    const margin = net > 0 ? ((net - d.cmv) / net) * 100 : 0
    return { marketplace: MP_LABELS[mp] ?? mp, margem: margin, receita: d.revenue }
  })

  // ── Top products ──
  const productMap: Record<string, { name: string; sku: string; revenue: number; marginPcts: number[] }> = {}
  for (const s of topProductSales ?? []) {
    const p = s.products as any
    if (!p) continue
    const id = s.product_id as string
    if (!productMap[id]) productMap[id] = { name: p.name, sku: p.sku, revenue: 0, marginPcts: [] }
    productMap[id].revenue += Number(s.gross_price)
    const mp = (s.sale_costs as any)?.[0]?.margin_pct
    if (mp !== null && mp !== undefined) productMap[id].marginPcts.push(Number(mp))
  }
  const topProducts = Object.values(productMap)
    .map(p => ({ ...p, avgMargin: p.marginPcts.length ? p.marginPcts.reduce((a, b) => a + b, 0) / p.marginPcts.length * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const currentMonth = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Visão consolidada — ${currentMonth}`} />
      <div className="px-8 py-6 space-y-5">

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              label: 'Receita Bruta',
              value: fmtR(totalRevenue),
              sub: revenueChange !== 0 ? `${revenueChange > 0 ? '▲' : '▼'} ${Math.abs(revenueChange).toFixed(1)}% vs. mês anterior` : 'Primeiro mês',
              color: 'text-blue-600',
              bgAccent: revenueChange > 0 ? 'border-l-4 border-l-green-400' : revenueChange < 0 ? 'border-l-4 border-l-red-400' : '',
              icon: '💰',
            },
            {
              label: 'Pedidos',
              value: totalOrders.toString(),
              sub: `Média ${totalRevenue > 0 && totalOrders > 0 ? fmtR(totalRevenue / totalOrders) : '—'} por pedido`,
              color: 'text-indigo-600',
              icon: '🛒',
            },
            {
              label: 'Tarifas + ADS',
              value: fmtR(totalFees),
              sub: totalRevenue > 0 ? `${fmtPct((totalFees / totalRevenue) * 100)} da receita` : '—',
              color: 'text-orange-600',
              icon: '📊',
            },
            {
              label: 'Margem Bruta',
              value: fmtPct(grossMargin),
              sub: `Lucro: ${fmtR(grossProfit)}`,
              color: grossMargin >= 35 ? 'text-green-600' : grossMargin >= 20 ? 'text-amber-500' : 'text-red-500',
              bgAccent: grossMargin >= 35 ? 'border-l-4 border-l-green-400' : grossMargin >= 20 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-red-400',
              icon: '📈',
            },
          ].map((kpi, i) => (
            <div key={i} className={`bg-white rounded-xl border border-gray-100 p-5 shadow-sm ${kpi.bgAccent ?? ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</span>
                <span className="text-lg">{kpi.icon}</span>
              </div>
              <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
              {kpi.sub && <div className="text-xs text-gray-400 mt-1">{kpi.sub}</div>}
            </div>
          ))}
        </div>

        {/* Alerts */}
        {((pendingNFe ?? 0) > 0 || !lastSync) && (
          <div className="space-y-2">
            {(pendingNFe ?? 0) > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-3 text-sm text-yellow-800 flex items-center gap-2">
                ⚠ <strong>{pendingNFe} NF-e</strong> com despesas de importação pendentes — custo landed incompleto.
                <a href="/dashboard/importacoes" className="underline font-semibold ml-auto">Completar →</a>
              </div>
            )}
            {!lastSync && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 text-sm text-slate-600 flex items-center gap-2">
                ○ Nenhuma sincronização realizada.
                <a href="/dashboard/configuracoes" className="underline font-semibold ml-auto">Configurar integrações →</a>
              </div>
            )}
          </div>
        )}

        {/* Charts row */}
        <div className="grid grid-cols-3 gap-4">
          {/* Revenue trend - takes 2 cols */}
          <div className="col-span-2 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-gray-800">Receita por Dia — Últimos 30 dias</div>
                <div className="text-xs text-gray-400 mt-0.5">Por marketplace</div>
              </div>
            </div>
            <RevenueLineChart data={trendData} />
          </div>

          {/* Margin by marketplace */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="font-semibold text-gray-800 mb-1">Margem por Canal</div>
            <div className="text-xs text-gray-400 mb-4">Mês atual</div>
            <MarketplaceBarChart data={barData} />
          </div>
        </div>

        {/* Marketplace breakdown + Top products */}
        <div className="grid grid-cols-2 gap-4">
          {/* Marketplace cards */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="font-semibold text-gray-800 mb-4">Resultado por Marketplace</div>
            <div className="space-y-3">
              {Object.entries(byMP).length === 0 && (
                <p className="text-sm text-gray-300">Sem vendas sincronizadas ainda.</p>
              )}
              {Object.entries(byMP).sort((a, b) => b[1].revenue - a[1].revenue).map(([mp, d]) => {
                const net = d.revenue - d.fees
                const margin = net > 0 ? ((net - d.cmv) / net) * 100 : 0
                const pct = totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                return (
                  <div key={mp}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: MP_COLORS[mp] ?? '#6366f1' }} />
                        <span className="text-sm font-medium text-gray-700">{MP_LABELS[mp] ?? mp}</span>
                        <span className="text-xs text-gray-400">{d.orders} pedidos</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">{fmtR(d.revenue)}</span>
                        <span className={`text-xs ml-2 font-medium ${margin >= 35 ? 'text-green-600' : margin >= 20 ? 'text-amber-500' : 'text-red-500'}`}>
                          {fmtPct(margin)} mg.
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: MP_COLORS[mp] ?? '#6366f1' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top products */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-gray-800">Top Produtos por Receita</div>
              <a href="/dashboard/produtos" className="text-xs text-blue-500 hover:underline">Ver todos →</a>
            </div>
            <div className="space-y-3">
              {topProducts.length === 0 && (
                <p className="text-sm text-gray-300">Sem dados suficientes.</p>
              )}
              {topProducts.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-xs font-bold text-blue-600">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{p.name}</div>
                    <div className="text-xs text-gray-400">{p.sku}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-900">{fmtR(p.revenue)}</div>
                    <div className={`text-xs font-medium ${p.avgMargin >= 35 ? 'text-green-600' : p.avgMargin >= 20 ? 'text-amber-500' : 'text-gray-400'}`}>
                      {p.avgMargin > 0 ? `${fmtPct(p.avgMargin)} mg.` : 'Sem custo'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Last sync info */}
        {lastSync && (
          <div className="text-xs text-gray-400 text-center">
            Última sincronização: {new Date(lastSync.started_at).toLocaleString('pt-BR')} ({lastSync.source})
            · <a href="/dashboard/configuracoes" className="underline hover:text-gray-600">Sincronizar agora</a>
          </div>
        )}

      </div>
    </>
  )
}
