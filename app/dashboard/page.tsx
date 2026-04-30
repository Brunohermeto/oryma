import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'

export const dynamic = 'force-dynamic'

function fmtR(v: number) {
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}
function fmtPct(v: number) {
  return `${v.toFixed(1)}%`
}

interface KPICardProps {
  title: string
  value: string
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  alert?: boolean
}

function KPICard({ title, value, sub, trend, alert }: KPICardProps) {
  const trendColor = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-400'
  return (
    <div className={`bg-white rounded-xl border p-5 ${alert ? 'border-yellow-200 bg-yellow-50/30' : 'border-gray-100'}`}>
      <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{title}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className={`text-xs mt-1 ${trendColor}`}>{sub}</div>}
    </div>
  )
}

export default async function DashboardPage() {
  const db = createSupabaseServiceClient()
  const now = new Date()
  const start = format(startOfMonth(now), 'yyyy-MM-dd')
  const end = format(endOfMonth(now), 'yyyy-MM-dd')
  const prevStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const prevEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')

  // Current month sales
  const { data: sales } = await db
    .from('sales')
    .select('marketplace, gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, sale_costs(total_cost, margin_value)')
    .gte('sale_date', start)
    .lte('sale_date', end)

  // Previous month for comparison
  const { data: prevSales } = await db
    .from('sales')
    .select('gross_price')
    .gte('sale_date', prevStart)
    .lte('sale_date', prevEnd)

  const totalRevenue = (sales ?? []).reduce((s, r) => s + Number(r.gross_price), 0)
  const prevRevenue = (prevSales ?? []).reduce((s, r) => s + Number(r.gross_price), 0)
  const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0

  const totalFees = (sales ?? []).reduce((s, r) => s + Number(r.marketplace_commission) + Number(r.marketplace_shipping_fee) + Number(r.ads_cost), 0)
  const totalCMV = (sales ?? []).reduce((s, r) => {
    const cost = (r.sale_costs as any)?.[0]?.total_cost ?? 0
    return s + Number(cost)
  }, 0)
  const totalCancellations = (sales ?? []).reduce((s, r) => s + Number(r.cancellation), 0)

  const netRevenue = totalRevenue - totalCancellations - totalFees
  const grossProfit = netRevenue - totalCMV
  const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0

  // Pending NF-e (costs incomplete)
  const { count: pendingNFe } = await db
    .from('import_orders')
    .select('id', { count: 'exact', head: true })
    .eq('costs_complete', false)

  // Products with low stock (< 30 days)
  const { data: products } = await db.from('products').select('name, sku, stock_quantity')

  // Sync log - last sync time
  const { data: lastSync } = await db
    .from('sync_logs')
    .select('started_at, source, status')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  // Revenue by marketplace
  const byMP: Record<string, number> = {}
  for (const s of sales ?? []) {
    byMP[s.marketplace] = (byMP[s.marketplace] ?? 0) + Number(s.gross_price)
  }

  const mpLabels: Record<string, string> = {
    mercado_livre: 'Mercado Livre',
    shopee: 'Shopee',
    amazon: 'Amazon',
  }

  const currentMonth = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <>
      <TopBar
        title="Dashboard"
        subtitle={`Visão consolidada — ${currentMonth}`}
      />
      <div className="px-8 py-6 space-y-6">

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          <KPICard
            title="Receita Bruta"
            value={fmtR(totalRevenue)}
            sub={revenueChange !== 0 ? `${revenueChange > 0 ? '▲' : '▼'} ${Math.abs(revenueChange).toFixed(1)}% vs. mês anterior` : 'Sem histórico'}
            trend={revenueChange > 0 ? 'up' : revenueChange < 0 ? 'down' : 'neutral'}
          />
          <KPICard
            title="Tarifas + ADS"
            value={fmtR(totalFees)}
            sub={totalRevenue > 0 ? `${fmtPct((totalFees / totalRevenue) * 100)} da receita` : ''}
          />
          <KPICard
            title="CMV (Landed Cost)"
            value={fmtR(totalCMV)}
            sub={totalRevenue > 0 ? `${fmtPct((totalCMV / totalRevenue) * 100)} da receita` : ''}
          />
          <KPICard
            title="Margem Bruta"
            value={fmtPct(grossMargin)}
            sub={`Lucro bruto: ${fmtR(grossProfit)}`}
            trend={grossMargin >= 35 ? 'up' : grossMargin >= 20 ? 'neutral' : 'down'}
          />
        </div>

        {/* Alerts */}
        <div className="space-y-2">
          {(pendingNFe ?? 0) > 0 && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-4 py-3 text-sm text-yellow-800 flex items-center gap-2">
              ⚠ <strong>{pendingNFe} NF-e de importação</strong> com custos pendentes — landed cost incompleto.
              <a href="/dashboard/importacoes" className="underline ml-1 font-medium">Completar →</a>
            </div>
          )}
          {lastSync && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-700">
              ✓ Última sincronização ({lastSync.source}): {new Date(lastSync.started_at).toLocaleString('pt-BR')}
            </div>
          )}
          {!lastSync && (
            <div className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3 text-sm text-gray-500">
              Nenhuma sincronização realizada ainda. Conecte os marketplaces em <a href="/dashboard/configuracoes" className="underline">Configurações</a>.
            </div>
          )}
        </div>

        {/* Revenue by marketplace */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="font-semibold text-gray-800 text-sm mb-4">Receita por Marketplace</div>
            {Object.keys(byMP).length === 0 ? (
              <p className="text-sm text-gray-400">Sem dados de venda ainda.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(byMP).sort((a, b) => b[1] - a[1]).map(([mp, rev]) => (
                  <div key={mp} className="flex items-center gap-3">
                    <div className="w-28 text-xs font-medium text-gray-600">{mpLabels[mp] ?? mp}</div>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="text-xs font-semibold text-gray-700 w-24 text-right">{fmtR(rev)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="font-semibold text-gray-800 text-sm mb-4">Navegação Rápida</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: '/dashboard/dre', label: '📊 DRE Gerencial' },
                { href: '/dashboard/produtos', label: '📦 Custo por Produto' },
                { href: '/dashboard/vendas', label: '💰 Feed de Vendas' },
                { href: '/dashboard/velocidade', label: '⚡ Velocidade' },
                { href: '/dashboard/importacoes', label: '🗂️ NF-e / Importações' },
                { href: '/dashboard/despesas', label: '📋 Despesas' },
              ].map(item => (
                <a key={item.href} href={item.href} className="text-xs text-blue-600 hover:text-blue-800 hover:underline py-1">
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
