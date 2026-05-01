import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth, subMonths, subDays, eachDayOfInterval } from 'date-fns'
import { RevenueLineChart } from '@/components/charts/RevenueLineChart'
import { MarketplaceBarChart } from '@/components/charts/MarketplaceBarChart'
import { TrendingUp, TrendingDown, ShoppingCart, Percent, DollarSign, ExternalLink } from 'lucide-react'
import { InsightsPanel } from '@/components/dashboard/InsightsPanel'

export const dynamic = 'force-dynamic'

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }
function fmtPct(v: number) { return `${v.toFixed(1)}%` }

const MP_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}
const MP_COLORS: Record<string, string> = {
  mercado_livre: '#125BFF',
  shopee:        '#7B61FF',
  amazon:        '#00D6FF',
}

export default async function DashboardPage() {
  const db = createSupabaseServiceClient()
  const now = new Date()
  const start = format(startOfMonth(now), 'yyyy-MM-dd')
  const end = format(endOfMonth(now), 'yyyy-MM-dd')
  const prevStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const prevEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const last30Start = format(subDays(now, 29), 'yyyy-MM-dd')

  const { data: sales } = await db
    .from('sales')
    .select('marketplace, gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, sale_date, sale_costs(total_cost, margin_value)')
    .gte('sale_date', start)
    .lte('sale_date', end)

  const { data: prevSales } = await db
    .from('sales')
    .select('gross_price')
    .gte('sale_date', prevStart)
    .lte('sale_date', prevEnd)

  const { data: trendSales } = await db
    .from('sales')
    .select('marketplace, gross_price, sale_date')
    .gte('sale_date', last30Start)
    .lte('sale_date', format(now, 'yyyy-MM-dd'))

  const { count: pendingNFe } = await db
    .from('import_orders')
    .select('id', { count: 'exact', head: true })
    .eq('costs_complete', false)

  const { data: lastSync } = await db
    .from('sync_logs')
    .select('started_at, source')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  const { data: topProductSales } = await db
    .from('sales')
    .select('product_id, gross_price, marketplace_commission, sale_costs(total_cost, margin_pct), products(name, sku)')
    .gte('sale_date', start)
    .lte('sale_date', end)
    .not('sale_costs', 'is', null)

  // ── KPIs ──
  const totalRevenue = (sales ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation), 0)
  const prevRevenue = (prevSales ?? []).reduce((s, r) => s + Number(r.gross_price), 0)
  const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0
  const totalFees = (sales ?? []).reduce((s, r) => s + Number(r.marketplace_commission) + Number(r.marketplace_shipping_fee) + Number(r.ads_cost), 0)
  const totalCMV = (sales ?? []).reduce((s, r) => s + Number((r.sale_costs as any)?.[0]?.total_cost ?? 0), 0)
  const netRevenue = totalRevenue - totalFees
  const grossProfit = netRevenue - totalCMV
  const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0
  const totalOrders = (sales ?? []).length

  // ── Por marketplace ──
  const byMP: Record<string, { revenue: number; fees: number; cmv: number; orders: number }> = {}
  for (const s of sales ?? []) {
    const mp = s.marketplace
    if (!byMP[mp]) byMP[mp] = { revenue: 0, fees: 0, cmv: 0, orders: 0 }
    byMP[mp].revenue += Number(s.gross_price) - Number(s.cancellation)
    byMP[mp].fees += Number(s.marketplace_commission) + Number(s.marketplace_shipping_fee) + Number(s.ads_cost)
    byMP[mp].cmv += Number((s.sale_costs as any)?.[0]?.total_cost ?? 0)
    byMP[mp].orders++
  }

  // ── Trend (30 dias) ──
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

  // ── Bar chart ──
  const barData = Object.entries(byMP).map(([mp, d]) => {
    const net = d.revenue - d.fees
    const margin = net > 0 ? ((net - d.cmv) / net) * 100 : 0
    return { marketplace: MP_LABELS[mp] ?? mp, margem: margin, receita: d.revenue }
  })

  // ── Top produtos ──
  const productMap: Record<string, { id: string; name: string; sku: string; revenue: number; marginPcts: number[] }> = {}
  for (const s of topProductSales ?? []) {
    const p = s.products as any
    if (!p) continue
    const id = s.product_id as string
    if (!productMap[id]) productMap[id] = { id, name: p.name, sku: p.sku, revenue: 0, marginPcts: [] }
    productMap[id].revenue += Number(s.gross_price)
    const mp = (s.sale_costs as any)?.[0]?.margin_pct
    if (mp !== null && mp !== undefined) productMap[id].marginPcts.push(Number(mp))
  }
  const topProducts = Object.values(productMap)
    .map(p => ({ ...p, avgMargin: p.marginPcts.length ? p.marginPcts.reduce((a, b) => a + b, 0) / p.marginPcts.length * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const currentMonth = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  // Margin color helper
  function marginColor(m: number) {
    if (m >= 35) return 'oklch(0.50 0.19 145)'   // emerald
    if (m >= 20) return 'oklch(0.62 0.16 70)'    // amber
    return 'oklch(0.52 0.20 25)'                  // red
  }
  function marginBg(m: number) {
    if (m >= 35) return 'oklch(0.94 0.06 145)'
    if (m >= 20) return 'oklch(0.96 0.06 70)'
    return 'oklch(0.96 0.04 25)'
  }

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Visão consolidada — ${currentMonth}`} />
      <div className="px-8 py-6 space-y-5">

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-4 gap-4">

          {/* Receita Bruta */}
          <a
            href={`/dashboard/vendas?from=${start}&to=${end}`}
            className="block bg-white rounded-xl p-5 transition-all"
            style={{ border: '1px solid oklch(0.88 0.016 258)', textDecoration: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.94 0.010 258)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'oklch(0.50 0.025 258)' }}>
                Receita Bruta
              </span>
              <DollarSign size={14} style={{ color: '#125BFF' }} />
            </div>
            <div className="num text-2xl font-bold" style={{ color: '#125BFF', fontFamily: 'var(--font-geist-mono)' }}>
              {fmtR(totalRevenue)}
            </div>
            {revenueChange !== 0 && (
              <div className="flex items-center gap-1 mt-2">
                {revenueChange > 0
                  ? <TrendingUp size={12} style={{ color: 'oklch(0.50 0.19 145)' }} />
                  : <TrendingDown size={12} style={{ color: 'oklch(0.52 0.20 25)' }} />
                }
                <span className="text-[12px]" style={{ color: revenueChange > 0 ? 'oklch(0.50 0.19 145)' : 'oklch(0.52 0.20 25)' }}>
                  {Math.abs(revenueChange).toFixed(1)}% vs. mês anterior
                </span>
              </div>
            )}
          </a>

          {/* Pedidos */}
          <a
            href={`/dashboard/vendas?from=${start}&to=${end}`}
            className="block bg-white rounded-xl p-5 transition-all"
            style={{ border: '1px solid oklch(0.88 0.016 258)', textDecoration: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.94 0.010 258)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'oklch(0.50 0.025 258)' }}>
                Pedidos
              </span>
              <ShoppingCart size={14} style={{ color: 'oklch(0.50 0.25 258)' }} />
            </div>
            <div className="num text-2xl font-bold" style={{ color: 'oklch(0.50 0.25 258)', fontFamily: 'var(--font-geist-mono)' }}>
              {totalOrders}
            </div>
            <div className="text-[12px] mt-2" style={{ color: 'oklch(0.50 0.025 258)' }}>
              Ticket médio: {totalOrders > 0 ? fmtR(totalRevenue / totalOrders) : '—'}
            </div>
          </a>

          {/* Tarifas + ADS */}
          <a
            href="/dashboard/dre"
            className="block bg-white rounded-xl p-5 transition-all"
            style={{ border: '1px solid oklch(0.88 0.016 258)', textDecoration: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.94 0.010 258)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'oklch(0.50 0.025 258)' }}>
                Tarifas + ADS
              </span>
              <Percent size={14} style={{ color: 'oklch(0.62 0.16 70)' }} />
            </div>
            <div className="num text-2xl font-bold" style={{ color: 'oklch(0.62 0.16 70)', fontFamily: 'var(--font-geist-mono)' }}>
              {fmtR(totalFees)}
            </div>
            <div className="text-[12px] mt-2" style={{ color: 'oklch(0.50 0.025 258)' }}>
              {totalRevenue > 0 ? `${fmtPct((totalFees / totalRevenue) * 100)} da receita` : '—'}
            </div>
          </a>

          {/* Margem Bruta */}
          <a
            href="/dashboard/dre"
            className="block bg-white rounded-xl p-5 transition-all"
            style={{ border: '1px solid oklch(0.88 0.016 258)', textDecoration: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.94 0.010 258)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'oklch(0.50 0.025 258)' }}>
                Margem Bruta
              </span>
              <div
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: marginBg(grossMargin), color: marginColor(grossMargin) }}
              >
                {grossMargin >= 35 ? 'Boa' : grossMargin >= 20 ? 'Ok' : 'Baixa'}
              </div>
            </div>
            <div className="num text-2xl font-bold" style={{ color: marginColor(grossMargin), fontFamily: 'var(--font-geist-mono)' }}>
              {fmtPct(grossMargin)}
            </div>
            <div className="text-[12px] mt-2" style={{ color: 'oklch(0.50 0.025 258)' }}>
              Lucro: {fmtR(grossProfit)}
            </div>
          </a>

        </div>

        {/* ── Oryma Insights ── */}
        <InsightsPanel />

        {/* ── Gráficos ── */}
        <div className="grid grid-cols-3 gap-4">
          <div
            className="col-span-2 bg-white rounded-xl p-5"
            style={{ border: '1px solid oklch(0.88 0.016 258)' }}
          >
            <div className="mb-4">
              <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
                Receita por Dia — Últimos 30 dias
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'oklch(0.50 0.025 258)' }}>Por marketplace</div>
            </div>
            <RevenueLineChart data={trendData} />
          </div>

          <div
            className="bg-white rounded-xl p-5"
            style={{ border: '1px solid oklch(0.88 0.016 258)' }}
          >
            <div className="text-sm font-semibold mb-1" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Margem por Canal
            </div>
            <div className="text-[12px] mb-4" style={{ color: 'oklch(0.50 0.025 258)' }}>Mês atual</div>
            <MarketplaceBarChart data={barData} />
          </div>
        </div>

        {/* ── Resultado por marketplace + Top produtos ── */}
        <div className="grid grid-cols-2 gap-4">

          {/* Por marketplace */}
          <div
            className="bg-white rounded-xl p-5"
            style={{ border: '1px solid oklch(0.88 0.016 258)' }}
          >
            <div className="text-sm font-semibold mb-4" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Resultado por Marketplace
            </div>
            <div className="space-y-4">
              {Object.entries(byMP).length === 0 && (
                <p className="text-sm" style={{ color: 'oklch(0.70 0.012 258)' }}>Sem vendas sincronizadas ainda.</p>
              )}
              {Object.entries(byMP).sort((a, b) => b[1].revenue - a[1].revenue).map(([mp, d]) => {
                const net = d.revenue - d.fees
                const margin = net > 0 ? ((net - d.cmv) / net) * 100 : 0
                const pct = totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                return (
                  <a
                    key={mp}
                    href={`/dashboard/vendas?mp=${mp}&from=${start}&to=${end}`}
                    className="block transition-all rounded-lg px-2 py-1.5 -mx-2"
                    style={{ textDecoration: 'none' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.94 0.010 258)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: MP_COLORS[mp] ?? 'oklch(0.50 0.025 258)' }} />
                        <span className="text-[13px] font-medium" style={{ color: 'oklch(0.20 0.05 258)' }}>
                          {MP_LABELS[mp] ?? mp}
                        </span>
                        <span className="text-[11px]" style={{ color: 'oklch(0.50 0.025 258)' }}>
                          {d.orders} pedidos
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold num" style={{ color: 'oklch(0.12 0.04 258)' }}>
                          {fmtR(d.revenue)}
                        </span>
                        <span
                          className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
                          style={{ background: marginBg(margin), color: marginColor(margin) }}
                        >
                          {fmtPct(margin)}
                        </span>
                        <span className="text-[11px]" style={{ color: 'oklch(0.50 0.025 258)' }}>→</span>
                      </div>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'oklch(0.93 0.014 258)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: MP_COLORS[mp] ?? '#125BFF' }}
                      />
                    </div>
                  </a>
                )
              })}
            </div>
          </div>

          {/* Top produtos */}
          <div
            className="bg-white rounded-xl p-5"
            style={{ border: '1px solid oklch(0.88 0.016 258)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
                Top Produtos por Receita
              </div>
              <a
                href="/dashboard/produtos"
                className="text-[12px] font-medium underline flex items-center gap-1"
                style={{ color: '#125BFF' }}
              >
                Ver todos →
                <ExternalLink size={11} />
              </a>
            </div>
            <div className="space-y-3">
              {topProducts.length === 0 && (
                <p className="text-[13px]" style={{ color: 'oklch(0.70 0.012 258)' }}>Sem dados suficientes.</p>
              )}
              {topProducts.map((p, i) => (
                <a
                  key={i}
                  href={`/dashboard/vendas?product=${p.id}&from=${start}&to=${end}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-all"
                  style={{ textDecoration: 'none' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.94 0.010 258)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                    style={{
                      background: i === 0 ? 'oklch(0.94 0.08 70)' : 'oklch(0.93 0.014 258)',
                      color: i === 0 ? 'oklch(0.52 0.14 70)' : '#125BFF',
                      fontFamily: 'var(--font-geist-mono)',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'oklch(0.12 0.04 258)' }}>
                      {p.name}
                    </div>
                    <div className="text-[11px]" style={{ color: 'oklch(0.50 0.025 258)' }}>{p.sku}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[13px] font-semibold num" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-geist-mono)' }}>
                      {fmtR(p.revenue)}
                    </div>
                    {p.avgMargin > 0 && (
                      <div className="text-[11px] font-medium" style={{ color: marginColor(p.avgMargin) }}>
                        {fmtPct(p.avgMargin)} mg.
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>

        </div>

        {/* Última sync */}
        {lastSync && (
          <div className="text-[12px] text-center" style={{ color: 'oklch(0.50 0.025 258)' }}>
            Última sincronização: {new Date(lastSync.started_at).toLocaleString('pt-BR')} ({lastSync.source})
            {' · '}
            <a href="/dashboard/configuracoes" className="underline" style={{ color: '#125BFF' }}>
              Sincronizar agora
            </a>
          </div>
        )}

      </div>
    </>
  )
}
