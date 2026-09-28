import { TopBar } from '@/components/layout/TopBar'
import { fetchAllParallel } from '@/lib/supabase/fetch-all'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { isReturned } from '@/lib/sales/returned'
import { liq, newAgg, addSale, aggBy, pctOf, type Agg } from '@/lib/sales/metrics'
import { format, endOfMonth, subMonths, eachDayOfInterval } from 'date-fns'
import { brazilToday, brazilDaysAgo } from '@/lib/utils/brazil-time'
import { RevenueLineChart, type RevenuePoint } from '@/components/charts/RevenueLineChart'
import { MarginDailyChart, type MarginDailyPoint } from '@/components/charts/MarginDailyChart'
import { MarketplaceBarChart } from '@/components/charts/MarketplaceBarChart'
import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react'
import { InsightsPanel } from '@/components/dashboard/InsightsPanel'
import { AuditAlertsPanel } from '@/components/dashboard/AuditAlertsPanel'
import { FeeAuditPanel } from '@/components/dashboard/FeeAuditPanel'
import { RunAuditButton } from '@/components/dashboard/RunAuditButton'
import { LiveSalesFeed } from '@/components/dashboard/LiveSalesFeed'
import { MarginByProductTable, type ProductMarginRow } from '@/components/dashboard/MarginByProductTable'
import { YearlyChart, type YearMonthPoint } from '@/components/charts/YearlyChart'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }
function fmtPct(v: number | null) { return v === null ? '—' : `${v.toFixed(1)}%` }

import { MP_INFO, MP_ORDER, mpLabel } from '@/components/marketplaces'

type Num = number | string | null
interface SaleFlat {
  id: string; product_id: string | null; marketplace: string; sale_date: string
  quantity: Num; uf_destino: string | null
  gross_price: Num; cancellation: Num; discounts: Num
  marketplace_commission: Num; marketplace_shipping_fee: Num; marketplace_fixed_fee: Num
  rebate: Num; ads_cost: Num
}
interface CostFlat { sale_id: string; total_cost: Num; margin_value: Num; margin_pct: Num }
interface TaxFlat { sale_id: string; icms: Num; icms_difal: Num; pis: Num; cofins: Num }
interface ProductFlat {
  id: string; name: string; sku: string
  stock_quantity: Num; stock_full: Num; stock_fba: Num; stock_shopee: Num; archived: boolean | null
}

const SALE_COLS = 'id, product_id, marketplace, sale_date, quantity, uf_destino, gross_price, cancellation, discounts, marketplace_commission, marketplace_shipping_fee, marketplace_fixed_fee, rebate, ads_cost'

export default async function DashboardPage(
  { searchParams }: { searchParams: Promise<{ days?: string; mes?: string }> }
) {
  const sp = await searchParams
  const db = createSupabaseServiceClient()
  // "hoje" ancorado no fuso do Brasil (a Vercel roda em UTC; às 21h+ BRT o
  // new Date() puro já virou o dia/mês seguinte e o dashboard pulava de mês cedo).
  const today = brazilToday()
  const now = new Date(`${today}T12:00:00`)

  // ── Período = MÊS (vigente por padrão, ou ?mes=YYYY-MM) ──
  const mesAtual = format(now, 'yyyy-MM')
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? '') ? sp.mes! : mesAtual
  const monthDate = new Date(`${mes}-01T12:00:00`)
  const isCurrentMonth = mes === mesAtual
  const monthEndDate = isCurrentMonth ? now : endOfMonth(monthDate)
  const start = `${mes}-01`
  const end = format(monthEndDate, 'yyyy-MM-dd')
  const daysElapsed = Number(end.slice(8, 10))  // dias corridos do mês exibido
  const marginDays = daysElapsed
  // comparação: mês anterior, MESMO número de dias corridos
  const prevMonthDate = subMonths(monthDate, 1)
  const prevStart = format(prevMonthDate, 'yyyy-MM-01')
  const prevEndCap = endOfMonth(prevMonthDate)
  const prevEndTarget = new Date(prevMonthDate.getTime() + (daysElapsed - 1) * 864e5)
  const prevEnd = format(prevEndTarget < prevEndCap ? prevEndTarget : prevEndCap, 'yyyy-MM-dd')
  const mesLabel = monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', '/')
  const mesCurto = monthDate.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  const ano = mes.slice(0, 4)  // comparativo do ano = ano do mês EXIBIDO
  // seletor: últimos 6 meses
  const mesesOpcoes = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(now, i)
    return { key: format(d, 'yyyy-MM'), label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace('.', '') }
  })

  // ── UMA carga de dados, tudo em paralelo ──
  // Antes: ~8 consultas grandes paginadas EM SÉRIE, várias com joins aninhados
  // (inclusive o ano inteiro) → ~62s, acima do limite de 60s da Vercel. Agora:
  // vendas FLAT do intervalo que cobre ano do mês exibido + mês anterior + 30
  // dias do estoque, até hoje; custos/impostos/produtos flat; junção em memória.
  const d30 = brazilDaysAgo(29)
  const rangeStart = [`${ano}-01-01`, prevStart, d30].sort()[0]
  const rangeEnd = today
  const [salesRaw, costsRaw, taxesRaw, productsRaw, alertsRes, pendingRes, lastSyncRes] = await Promise.all([
    fetchAllParallel<SaleFlat>(() => db.from('sales')
      .select(SALE_COLS, { count: 'exact' })
      .gte('sale_date', rangeStart).lte('sale_date', rangeEnd)
      .order('id', { ascending: true })),
    // !inner só para FILTRAR pelo intervalo (sem ele viriam os custos de toda a história)
    fetchAllParallel<CostFlat>(() => db.from('sale_costs')
      .select('sale_id, total_cost, margin_value, margin_pct, sales!inner(sale_date)', { count: 'exact' })
      .gte('sales.sale_date', rangeStart).lte('sales.sale_date', rangeEnd)
      .order('id', { ascending: true })),
    fetchAllParallel<TaxFlat>(() => db.from('sale_taxes')
      .select('sale_id, icms, icms_difal, pis, cofins, sales!inner(sale_date)', { count: 'exact' })
      .gte('sales.sale_date', rangeStart).lte('sales.sale_date', rangeEnd)
      .order('id', { ascending: true })),
    fetchAllParallel<ProductFlat>(() => db.from('products')
      .select('id, name, sku, stock_quantity, stock_full, stock_fba, stock_shopee, archived', { count: 'exact' })
      .order('id', { ascending: true })),
    // Alertas abertos (auditoria + vistoria, sem os dispensados) — semáforo de saúde
    db.from('audit_findings').select('id', { count: 'exact', head: true }).is('dismissed_at', null),
    db.from('import_orders').select('id', { count: 'exact', head: true }).eq('costs_complete', false),
    db.from('sync_logs').select('started_at, source').eq('status', 'success')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  // Banco fora do ar NÃO pode virar zero na tela (incidente 22/09/2026)
  for (const r of [alertsRes, pendingRes, lastSyncRes]) {
    if (r.error) throw new Error(`Falha ao consultar o banco: ${r.error.message}`)
  }
  const openAlerts = alertsRes.count ?? 0
  const pendingNFe = pendingRes.count ?? 0
  const lastSync = lastSyncRes.data as { started_at: string; source: string } | null

  // ── Junção em memória ──
  const costBySale = new Map<string, CostFlat>()
  for (const c of costsRaw) if (!costBySale.has(c.sale_id)) costBySale.set(c.sale_id, c)
  const taxBySale = new Map<string, TaxFlat>()
  for (const t of taxesRaw) if (!taxBySale.has(t.sale_id)) taxBySale.set(t.sale_id, t)
  const productById = new Map(productsRaw.map(p => [p.id, p]))
  const all = salesRaw.map(s => {
    const cost = costBySale.get(s.id) ?? null
    return {
      ...s,
      cost,
      margin_value: cost?.margin_value ?? null,
      tax: taxBySale.get(s.id) ?? null,
      product: s.product_id ? productById.get(s.product_id) ?? null : null,
    }
  })
  type Sale = typeof all[number]
  const between = (a: string, b: string) => all.filter(s => s.sale_date >= a && s.sale_date <= b)

  // Devolvidas ficam FORA de todo indicador (faturamento, margem, pedidos,
  // tarifas): o valor foi estornado ao comprador e a mercadoria voltou ao estoque.
  const monthAll   = between(start, end)
  const devolvidas = monthAll.filter(isReturned)
  const sales      = monthAll.filter(s => !isReturned(s))
  const prevSales  = between(prevStart, prevEnd).filter(s => !isReturned(s))

  // ── Comparativo do ANO do mês exibido ──
  const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const yearSales = all.filter(s => s.sale_date.startsWith(ano) && !isReturned(s))
  const yearAgg = aggBy(yearSales, s => s.sale_date.slice(5, 7))
  const yearByMp = aggBy(yearSales, s => `${s.sale_date.slice(5, 7)}|${s.marketplace}`)
  const yearData: YearMonthPoint[] = [...yearAgg.keys()].sort().map(mm => {
    const a = yearAgg.get(mm)!
    const mpRev = (mp: string) => yearByMp.get(`${mm}|${mp}`)?.revenue ?? 0
    const pct = pctOf(a)
    return {
      mes: MESES_PT[Number(mm) - 1], total: a.revenue, pedidos: a.orders,
      margem: pct === null ? null : Math.round(pct * 10) / 10,
      mercado_livre: mpRev('mercado_livre'), magalu: mpRev('magalu'),
      amazon: mpRev('amazon'), shopee: mpRev('shopee'),
    }
  })
  // acumulado do ano por canal (até o momento)
  const yearTotalByMp: Record<string, number> = {}
  for (const [mp, a] of aggBy(yearSales, s => s.marketplace)) yearTotalByMp[mp] = a.revenue
  const yearTotal = Object.values(yearTotalByMp).reduce((x, y) => x + y, 0)

  // ── Taxas pagas no período — por marketplace + total ──
  type FeeAgg = { comissao: number; frete: number; fixa: number; ads: number; estorno: number; revenue: number }
  const newFeeAgg = (): FeeAgg => ({ comissao: 0, frete: 0, fixa: 0, ads: 0, estorno: 0, revenue: 0 })
  const feesByMp: Record<string, FeeAgg> = {}
  const fees = newFeeAgg()
  const prevFeesAgg = newFeeAgg()
  const addFees = (agg: FeeAgg, r: Sale) => {
    agg.comissao += Number(r.marketplace_commission ?? 0)
    agg.frete    += Number(r.marketplace_shipping_fee ?? 0)
    agg.fixa     += Number(r.marketplace_fixed_fee ?? 0)
    agg.ads      += Number(r.ads_cost ?? 0)
    agg.estorno  += Number(r.rebate ?? 0)
    agg.revenue  += liq(r)
  }
  for (const r of sales) {
    feesByMp[r.marketplace] ??= newFeeAgg()
    addFees(fees, r)
    addFees(feesByMp[r.marketplace], r)
  }
  for (const r of prevSales) addFees(prevFeesAgg, r)
  const feeSum = (a: FeeAgg) => a.comissao + a.frete + a.fixa + a.ads - a.estorno
  const feesTotal = feeSum(fees)
  const prevFees = feeSum(prevFeesAgg)

  // ── Margem por produto (+ linha "Sem produto vinculado") ──
  // margem = só margin_value gravado (não exige sale_taxes); impostos em R$/% só
  // das vendas com NF lançada (taxedRevenue).
  const NO_PRODUCT = '__sem_produto__'
  type ProdAcc = {
    productId: string; name: string; sku: string; units: number; revenue: number
    icms: number; difal: number; piscofins: number; taxedRevenue: number; inCalc: number
    freteSum: number; freteCount: number; estornoSum: number; estornoCount: number
    commission: number; ads: number; cost: number; m: Agg
    ufs: Map<string, { units: number; m: Agg }>
  }
  const byProduct = new Map<string, ProdAcc>()
  for (const s of sales) {
    const p = s.product
    const pid = p?.id ?? NO_PRODUCT
    let row = byProduct.get(pid)
    if (!row) {
      row = { productId: pid, name: p?.name ?? 'Sem produto vinculado', sku: p?.sku ?? '—', units: 0, revenue: 0,
              icms: 0, difal: 0, piscofins: 0, taxedRevenue: 0, inCalc: 0,
              freteSum: 0, freteCount: 0, estornoSum: 0, estornoCount: 0,
              commission: 0, ads: 0, cost: 0, m: newAgg(), ufs: new Map() }
      byProduct.set(pid, row)
    }
    const g = liq(s)
    const t = s.tax
    row.units      += Number(s.quantity)
    row.revenue    += g
    row.cost       += Number(s.cost?.total_cost ?? 0)
    row.commission += Number(s.marketplace_commission ?? 0) + Number(s.marketplace_fixed_fee ?? 0)
    row.ads        += Number(s.ads_cost ?? 0)
    const frete   = Number(s.marketplace_shipping_fee ?? 0)
    const estorno = Number(s.rebate ?? 0)
    if (frete   > 0) { row.freteSum   += frete;   row.freteCount++ }
    if (estorno > 0) { row.estornoSum += estorno; row.estornoCount++ }
    if (t) {
      row.icms         += Number(t.icms ?? 0)
      row.difal        += Number(t.icms_difal ?? 0)
      row.piscofins    += Number(t.pis ?? 0) + Number(t.cofins ?? 0)
      row.taxedRevenue += g
    } else row.inCalc++
    addSale(row.m, s)
    const uf = s.uf_destino || 'não informado'
    let u = row.ufs.get(uf)
    if (!u) row.ufs.set(uf, (u = { units: 0, m: newAgg() }))
    u.units += Number(s.quantity)
    addSale(u.m, s)
  }
  const marginRows: ProductMarginRow[] = [...byProduct.values()].map(r => ({
    productId: r.productId, name: r.name, sku: r.sku, units: r.units,
    revenue: r.revenue,
    icms: r.icms, difal: r.difal, piscofins: r.piscofins,
    taxedRevenue: r.taxedRevenue, inCalc: r.inCalc,
    freteMedio:   r.freteCount   > 0 ? r.freteSum   / r.freteCount   : null,
    estornoMedio: r.estornoCount > 0 ? r.estornoSum / r.estornoCount : null,
    commission: r.commission, ads: r.ads,
    cmvMedio: r.cost > 0 && r.units > 0 ? r.cost / r.units : null,
    marginPct: pctOf(r.m),
    marginValue: r.m.mv, marginRevenue: r.m.base,
    velocityDay: r.units / marginDays,
    byUf: [...r.ufs.entries()]
      .map(([uf, u]) => ({ uf, units: u.units, marginPct: pctOf(u.m) }))
      .sort((a, b) => b.units - a.units),
  })).sort((a, b) => b.revenue - a.revenue)

  // ── Vendas por ESTADO — TODAS as vendas do mês (inclusive sem produto) ──
  const ufGlobal = new Map<string, { units: number; m: Agg; byMp: Record<string, number> }>()
  for (const s of sales) {
    const uf = s.uf_destino || '??'
    let u = ufGlobal.get(uf)
    if (!u) ufGlobal.set(uf, (u = { units: 0, m: newAgg(), byMp: {} }))
    u.units += Number(s.quantity)
    addSale(u.m, s)
    u.byMp[s.marketplace] = (u.byMp[s.marketplace] ?? 0) + liq(s)
  }
  const ufTotalRevenue = [...ufGlobal.values()].reduce((s, u) => s + u.m.revenue, 0) || 1
  const ufTotalUnits   = [...ufGlobal.values()].reduce((s, u) => s + u.units, 0) || 1
  const ufRows = [...ufGlobal.entries()]
    .map(([uf, u]) => ({
      uf, units: u.units, revenue: u.m.revenue,
      pctRevenue: (u.m.revenue / ufTotalRevenue) * 100,
      pctUnits: (u.units / ufTotalUnits) * 100,
      marginPct: pctOf(u.m),
      byMp: u.byMp,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // ── KPIs (mês e mês anterior com o mesmo nº de dias) ──
  const tot = aggBy(sales, () => 'all').get('all') ?? newAgg()
  const prevTot = aggBy(prevSales, () => 'all').get('all') ?? newAgg()
  const totalRevenue = tot.revenue
  const prevRevenue = prevTot.revenue
  const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0
  const grossProfit = tot.mv
  const marginBase = tot.base
  const grossMargin = pctOf(tot)
  const prevProfit = prevTot.mv
  const prevMargin = pctOf(prevTot)
  const totalOrders = tot.orders
  const prevOrders = prevTot.orders

  // ── Saúde dos dados (semáforo) ──
  const completeSales = sales.filter(r => r.margin_value !== null).length
  const emCalculo = sales.length - completeSales

  // ── Por marketplace (margem = Σ margin_value / Σ liq das apuradas) ──
  const byMP: Record<string, Agg> = Object.fromEntries(aggBy(sales, s => s.marketplace))

  // ── Receita por dia (liq, todos os canais + total) ──
  const days = eachDayOfInterval({ start: monthDate, end: monthEndDate })
  const dayMp = aggBy(sales, s => `${s.sale_date}|${s.marketplace}`)
  const trendData = days.map(day => {
    const dayStr = format(day, 'yyyy-MM-dd')
    const row: RevenuePoint = { date: format(day, 'dd/MM'), total: 0 }
    for (const mp of MP_ORDER) {
      const v = dayMp.get(`${dayStr}|${mp}`)?.revenue ?? 0
      row[mp] = v
      row.total += v
    }
    return row
  })

  // ── Margem/lucro por dia (vendas apuradas) ──
  const dayAgg = aggBy(sales, s => s.sale_date)
  const marginTrend: MarginDailyPoint[] = days.map(day => {
    const a = dayAgg.get(format(day, 'yyyy-MM-dd'))
    const pct = a ? pctOf(a) : null
    return {
      date: format(day, 'dd/MM'),
      lucro: a && a.base > 0 ? Math.round(a.mv * 100) / 100 : null,
      margem: pct === null ? null : Math.round(pct * 10) / 10,
    }
  })

  // ── Bar chart — todos os canais presentes nas vendas ──
  const barData = Object.entries(byMP).map(([mp, d]) => ({ marketplace: mpLabel(mp), margem: pctOf(d), receita: d.revenue }))

  // ── Top produtos (liq, margem ponderada, sem exigir custo) ──
  const topProducts = marginRows
    .filter(r => r.productId !== NO_PRODUCT)
    .slice(0, 5)
    .map(r => ({ id: r.productId, name: r.name, sku: r.sku, revenue: r.revenue, margin: r.marginPct }))

  // ── Insights: estoque (30 dias até hoje), venda sem custo, margem/receita/canal ──
  const qty30: Record<string, number> = {}
  for (const s of between(d30, today)) {
    if (s.product_id) qty30[s.product_id] = (qty30[s.product_id] ?? 0) + Number(s.quantity)
  }
  const noCost = sales.find(s => !s.cost)
  const insightsData = {
    products: productsRaw, qty30,
    noCostProductName: noCost ? (noCost.product?.name ?? 'Produto') : null,
    pendingNFe,
    margin: { cur: grossMargin, prev: prevMargin },
    revenue: { cur: totalRevenue, prev: prevRevenue },
    channels: Object.entries(byMP).map(([mp, d]) => ({ mp, pct: pctOf(d) })),
    start, end,
  }

  // Margin color helper
  function marginColor(m: number | null) {
    if (m === null) return 'oklch(0.60 0.02 258)'
    if (m >= 35) return 'oklch(0.50 0.19 145)'   // emerald
    if (m >= 20) return 'oklch(0.62 0.16 70)'    // amber
    return 'oklch(0.52 0.20 25)'                  // red
  }
  function marginBg(m: number | null) {
    if (m === null) return 'oklch(0.96 0.010 258)'
    if (m >= 35) return 'oklch(0.94 0.06 145)'
    if (m >= 20) return 'oklch(0.96 0.06 70)'
    return 'oklch(0.96 0.04 25)'
  }

  return (
    <>
      <TopBar title="Visão Geral" subtitle="Inteligência financeira consolidada · Ragaluma" />
      <div className="px-4 md:px-8 py-6 space-y-5">

        {/* ── Semáforo de saúde dos dados ── */}
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <span className="font-semibold px-2.5 py-1 rounded-full" style={{
            background: emCalculo === 0 ? 'oklch(0.94 0.10 145)' : 'oklch(0.96 0.08 70)',
            color: emCalculo === 0 ? '#15803d' : '#92400e',
          }}>
            {completeSales} vendas completas{emCalculo > 0 ? ` · ${emCalculo} em cálculo` : ' · tudo calculado ✓'}
            {devolvidas.length > 0 && ` · ${devolvidas.length} devolvida${devolvidas.length > 1 ? 's' : ''} (fora das contas)`}
          </span>
          <a href="#alertas" className="font-semibold px-2.5 py-1 rounded-full" style={{
            background: (openAlerts ?? 0) > 0 ? 'oklch(0.96 0.04 25)' : 'oklch(0.94 0.10 145)',
            color: (openAlerts ?? 0) > 0 ? '#dc2626' : '#15803d',
            textDecoration: 'none',
          }}>
            {(openAlerts ?? 0) > 0 ? `${openAlerts} alertas abertos` : 'sem alertas ✓'}
          </a>
          {lastSync && (
            <span className="px-2.5 py-1 rounded-full" style={{ background: 'oklch(0.96 0.010 258)', color: 'oklch(0.50 0.025 258)' }}>
              sync: {new Date(lastSync.started_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* ── Seletor de mês ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-widest mr-1" style={{ color: 'oklch(0.55 0.03 258)' }}>Mês:</span>
          {mesesOpcoes.map(m => (
            <a key={m.key} href={`/dashboard?mes=${m.key}`}
               className="text-[12px] font-semibold px-3 py-1 rounded-full"
               style={mes === m.key
                 ? { background: '#125BFF', color: 'white', textDecoration: 'none' }
                 : { background: 'oklch(0.96 0.010 258)', color: 'oklch(0.50 0.025 258)', textDecoration: 'none' }}>
              {m.label}
            </a>
          ))}
          {!isCurrentMonth && (
            <span className="text-[11px]" style={{ color: 'oklch(0.50 0.025 258)' }}>· mês completo (1 a {end.slice(8, 10)})</span>
          )}
        </div>

        {/* ── KPIs gigantes com comparação vs período anterior ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: `Faturamento (${mesCurto})`, href: `/dashboard/vendas?from=${start}&to=${end}`,
              value: fmtR(totalRevenue), color: '#125BFF',
              delta: prevRevenue > 0 ? revenueChange : null, deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}%`,
              perMp: (mp: string) => fmtR(byMP[mp].revenue),
              note: undefined as string | undefined,
            },
            {
              label: `Lucro Real (${mesCurto})`, href: `/dashboard/dre?month=${mes}`,
              value: fmtR(grossProfit), color: grossProfit >= 0 ? '#16a34a' : '#dc2626',
              delta: prevProfit !== 0 ? ((grossProfit - prevProfit) / Math.abs(prevProfit)) * 100 : null,
              deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(0)}%`,
              perMp: (mp: string) => fmtR(byMP[mp].mv),
              // por que lucro ≠ faturamento×margem: só conta as vendas já apuradas
              note: emCalculo > 0 ? `apurado sobre ${fmtR(marginBase)} (${marginBase > 0 ? Math.round(marginBase / totalRevenue * 100) : 0}% do faturamento) · ${emCalculo} vendas em cálculo` : undefined,
            },
            {
              label: 'Margem Real', href: `/dashboard/dre?month=${mes}`,
              value: fmtPct(grossMargin), color: marginColor(grossMargin),
              delta: grossMargin !== null && prevMargin !== null ? grossMargin - prevMargin : null,
              deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}pp`,
              perMp: (mp: string) => fmtPct(pctOf(byMP[mp])),
              note: emCalculo > 0 ? 'calculada só sobre as vendas já apuradas' : undefined,
            },
            {
              label: 'Pedidos', href: `/dashboard/vendas?from=${start}&to=${end}`,
              value: String(totalOrders), color: '#0B1023',
              delta: prevOrders > 0 ? ((totalOrders - prevOrders) / prevOrders) * 100 : null,
              deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(0)}%`,
              perMp: (mp: string) => String(byMP[mp].orders),
              note: undefined as string | undefined,
            },
          ].map(k => (
            <a key={k.label} href={k.href} className="block rounded-2xl px-5 py-4 bg-white" style={{
              border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)', textDecoration: 'none',
            }}>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#64748B' }}>{k.label}</div>
              <div className="font-bold leading-none" style={{ color: k.color, fontFamily: 'var(--font-sora)', fontSize: 34, letterSpacing: '-0.03em' }}>
                {k.value}
              </div>
              {k.delta !== null && Math.abs(k.delta) >= 0.05 && (
                <div className="flex items-center gap-1 mt-2">
                  {k.delta > 0
                    ? <TrendingUp size={12} style={{ color: '#16a34a' }} />
                    : <TrendingDown size={12} style={{ color: '#dc2626' }} />}
                  <span className="text-[12px] font-semibold" style={{ color: k.delta > 0 ? '#16a34a' : '#dc2626' }}>
                    {k.deltaFmt(k.delta)}
                  </span>
                  <span className="text-[11px]" style={{ color: '#94a3b8' }}>vs mês anterior</span>
                </div>
              )}
              {k.note && (
                <div className="text-[10px] mt-1.5 leading-tight" style={{ color: '#94a3b8' }}>{k.note}</div>
              )}
              {/* Totalizador aberto por marketplace */}
              <div className="mt-3 pt-2 space-y-1" style={{ borderTop: '1px solid oklch(0.94 0.01 258)' }}>
                {MP_ORDER.filter(mp => byMP[mp]?.revenue > 0).map(mp => (
                  <div key={mp} className="flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1.5" style={{ color: '#64748B' }}>
                      <span className="w-2 h-2 rounded-sm inline-block" style={{ background: MP_INFO[mp]?.color }} />
                      {mpLabel(mp)}
                    </span>
                    <span className="font-semibold" style={{ color: '#0B1023', fontFamily: 'var(--font-geist-mono)' }}>
                      {k.perMp(mp)}
                    </span>
                  </div>
                ))}
              </div>
            </a>
          ))}
        </div>

        {/* ── Gráficos — recolhível ── */}
        <details open>
        <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'oklch(0.55 0.03 258)' }}>
          Gráficos — receita, margem e canais
        </summary>
        <div className="space-y-4">
        {/* ── Comparativo do ano ── */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <div className="mb-2">
            <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Comparativo do Ano — {ano}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'oklch(0.50 0.025 258)' }}>
              Faturamento mensal empilhado por marketplace · linha roxa = margem real % · nº de pedidos sob cada mês
            </div>
          </div>
          {/* Acumulado do ano até o momento, por canal */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ background: '#0B1023', color: 'white', fontFamily: 'var(--font-geist-mono)' }}>
              Ano: {fmtR(yearTotal)}
            </span>
            {MP_ORDER.filter(mp => (yearTotalByMp[mp] ?? 0) > 0).map(mp => (
              <span key={mp} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: 'oklch(0.97 0.008 258)', color: '#0B1023' }}>
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: MP_INFO[mp]?.color }} />
                {mpLabel(mp)}: <span style={{ fontFamily: 'var(--font-geist-mono)' }}>{fmtR(yearTotalByMp[mp])}</span>
                <span style={{ color: 'oklch(0.50 0.025 258)' }}>({yearTotal > 0 ? (100 * yearTotalByMp[mp] / yearTotal).toFixed(0) : 0}%)</span>
              </span>
            ))}
          </div>
          <YearlyChart data={yearData} />
        </div>
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <div className="mb-4">
            <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Margem e Lucro por Dia — {mesLabel}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'oklch(0.50 0.025 258)' }}>
              Totalizado (todos os canais) · barras = lucro do dia (R$) · linha roxa = margem % · só vendas com cálculo completo ·{' '}
              <b style={{ color: '#16a34a' }}>lucro total do período: {fmtR(grossProfit)}</b>
            </div>
          </div>
          {/* Margem média do mês por canal */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {MP_ORDER.filter(mp => (byMP[mp]?.base ?? 0) > 0).map(mp => {
              const a = byMP[mp]
              const pct = pctOf(a)!
              return (
                <span key={mp} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
                      style={{ background: 'oklch(0.97 0.008 258)', color: '#0B1023' }}>
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: MP_INFO[mp]?.color }} />
                  {mpLabel(mp)}: <span style={{ fontFamily: 'var(--font-geist-mono)', color: pct >= 15 ? '#16a34a' : pct >= 8 ? '#d97706' : '#dc2626' }}>{pct.toFixed(1)}%</span>
                  <span style={{ color: 'oklch(0.50 0.025 258)' }}>({fmtR(a.mv)})</span>
                </span>
              )
            })}
          </div>
          <MarginDailyChart data={marginTrend} avgMargin={grossMargin ?? undefined} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className="col-span-2 bg-white rounded-2xl p-5"
            style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}
          >
            <div className="mb-4">
              <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
                Receita por Dia — {mesLabel}
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'oklch(0.50 0.025 258)' }}>Todos os canais separados + linha totalizadora tracejada</div>
            </div>
            <RevenueLineChart data={trendData} />
          </div>

          <div
            className="bg-white rounded-2xl p-5"
            style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}
          >
            <div className="text-sm font-semibold mb-1" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Margem por Canal
            </div>
            <div className="text-[12px] mb-4" style={{ color: 'oklch(0.50 0.025 258)' }}>{mesLabel} · todos os canais</div>
            <MarketplaceBarChart data={barData} />
          </div>
        </div>
        </div>
        </details>

        {/* Auditoria sob demanda + relatório para conferência/contestação */}
        <RunAuditButton />

        {/* Ritmo normal de chegada dos dados — evita alarme falso com venda recente */}
        <details className="rounded-xl px-4 py-2.5" style={{ background: 'oklch(0.97 0.008 258)', border: '1px solid oklch(0.92 0.012 258)' }}>
          <summary className="cursor-pointer text-[12px] font-medium" style={{ color: 'oklch(0.45 0.03 258)' }}>
            Vendas recentes com dados faltando? Veja o prazo normal de cada informação
          </summary>
          <div className="mt-2 space-y-1 text-[12px]" style={{ color: 'oklch(0.50 0.025 258)' }}>
            <div>• <b>Venda</b> — entra assim que o pagamento é aprovado no marketplace (pedido aguardando pagamento ainda não aparece).</div>
            <div>• <b>NF-e e impostos (Full)</b> — o ML emite a nota na <b>expedição</b> do pedido, não na venda; costuma chegar em horas, mas pode levar 1 dia.</div>
            <div>• <b>NF-e e impostos (galpão)</b> — chegam quando a nota é emitida no Bling.</div>
            <div>• <b>Comissão, tarifa fixa e estorno</b> — vêm do extrato de faturamento do ML, que fecha com <b>1 a 2 dias</b> de atraso; estorno promocional pode levar até 10 dias (o sistema re-verifica sozinho).</div>
            <div>• <b>Publicidade (Ads)</b> — o ML cobra <b>por dia de campanha</b>, não por venda, e lança no extrato 1-2 dias depois; o valor do dia só é rateado entre as vendas quando o dia fecha.</div>
            <div>• Enquanto algo falta, a margem fica <b>"em cálculo"</b> — o ciclo diário das 9h completa tudo automaticamente.</div>
          </div>
        </details>

        {/* Auditoria automática — apontamentos por venda */}
        <div id="alertas" className="space-y-5">
          <AuditAlertsPanel />
          <FeeAuditPanel />
        </div>

        {/* ── Taxas pagas ao marketplace ── */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Taxas pagas ao marketplace — {mesLabel}
            </span>
            {prevFees > 0 && Math.abs(feesTotal - prevFees) / prevFees >= 0.005 && (
              <span className="text-[12px] font-semibold" style={{ color: feesTotal > prevFees ? '#dc2626' : '#16a34a' }}>
                {feesTotal > prevFees ? '▲' : '▼'} {(Math.abs(feesTotal - prevFees) / prevFees * 100).toFixed(1)}% vs mês anterior
              </span>
            )}
          </div>
          {/* Tabela: uma linha por marketplace + total */}
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#64748B' }}>
                  {['Canal', 'Comissão', 'Frete', 'Tarifa fixa', 'Publicidade', 'Estorno', 'Total', '% do fat.'].map((h, i) => (
                    <th key={h} className={`py-2 px-2 text-[10px] font-bold uppercase tracking-widest ${i === 0 ? 'text-left' : 'text-right'}`}
                        style={{ borderBottom: '1px solid oklch(0.92 0.012 258)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ fontFamily: 'var(--font-geist-mono)' }}>
                {MP_ORDER.filter(mp => feesByMp[mp]).map(mp => {
                  const f = feesByMp[mp]
                  return (
                    <tr key={mp} style={{ borderBottom: '1px solid oklch(0.96 0.008 258)' }}>
                      <td className="py-2 px-2 font-sans font-semibold" style={{ color: '#0B1023' }}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: MP_INFO[mp]?.color }} />
                          {mpLabel(mp)}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right" style={{ color: '#d97706' }}>{fmtR(f.comissao)}</td>
                      <td className="py-2 px-2 text-right" style={{ color: '#d97706' }}>{fmtR(f.frete)}</td>
                      <td className="py-2 px-2 text-right" style={{ color: '#d97706' }}>{fmtR(f.fixa)}</td>
                      <td className="py-2 px-2 text-right" style={{ color: '#d97706' }}>{fmtR(f.ads)}</td>
                      <td className="py-2 px-2 text-right" style={{ color: '#16a34a' }}>{f.estorno > 0 ? `− ${fmtR(f.estorno)}` : '—'}</td>
                      <td className="py-2 px-2 text-right font-bold" style={{ color: '#0B1023' }}>{fmtR(feeSum(f))}</td>
                      <td className="py-2 px-2 text-right" style={{ color: '#64748B' }}>
                        {f.revenue > 0 ? `${(feeSum(f) / f.revenue * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
                <tr style={{ background: 'oklch(0.97 0.008 258)' }}>
                  <td className="py-2 px-2 font-sans font-bold" style={{ color: '#0B1023' }}>TOTAL</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: '#d97706' }}>{fmtR(fees.comissao)}</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: '#d97706' }}>{fmtR(fees.frete)}</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: '#d97706' }}>{fmtR(fees.fixa)}</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: '#d97706' }}>{fmtR(fees.ads)}</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: '#16a34a' }}>{fees.estorno > 0 ? `− ${fmtR(fees.estorno)}` : '—'}</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: '#0B1023' }}>{fmtR(feesTotal)}</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: '#64748B' }}>
                    {totalRevenue > 0 ? `${(feesTotal / totalRevenue * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Margem por produto ── */}
        <MarginByProductTable rows={marginRows} days={marginDays} periodLabel={mesLabel} />

        {/* ── Vendas por estado (mesmo período do filtro) ── */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <div className="text-sm font-semibold mb-1" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
            Vendas por Estado — {mesLabel}
          </div>
          <div className="text-[12px] mb-2" style={{ color: 'oklch(0.50 0.025 258)' }}>
            Participação no faturamento, % das unidades e margem média em cada UF de destino — barras separadas por marketplace
          </div>
          <div className="flex items-center gap-3 mb-4 flex-wrap text-[11px]" style={{ color: 'oklch(0.45 0.03 258)' }}>
            {MP_ORDER.map(mp => (
              <span key={mp} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: MP_INFO[mp]?.color }} />
                {mpLabel(mp)}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {ufRows.map(u => (
              <div key={u.uf} className="flex items-center gap-3">
                <span className="w-8 text-[13px] font-bold" style={{ color: u.uf === '??' ? 'oklch(0.60 0.02 258)' : '#125BFF' }}>
                  {u.uf === '??' ? '—' : u.uf}
                </span>
                {/* barra empilhada: um segmento por marketplace, na cor da marca */}
                <div className="flex-1 h-4 rounded-full overflow-hidden flex" style={{ background: 'oklch(0.96 0.010 258)' }}>
                  {MP_ORDER.filter(mp => (u.byMp[mp] ?? 0) > 0).map(mp => (
                    <div key={mp} title={`${mpLabel(mp)}: ${fmtR(u.byMp[mp])}`} className="h-full" style={{
                      width: `${Math.max((u.byMp[mp] / ufTotalRevenue) * 100, 0.6)}%`,
                      background: MP_INFO[mp]?.color,
                    }} />
                  ))}
                </div>
                <span className="w-24 text-right text-[12px] font-semibold num" style={{ color: '#0B1023', fontFamily: 'var(--font-geist-mono)' }}>
                  {fmtR(u.revenue)}
                </span>
                <span className="w-14 text-right text-[12px]" style={{ color: 'oklch(0.50 0.025 258)', fontFamily: 'var(--font-geist-mono)' }}>
                  {u.pctUnits.toFixed(0)}% vd
                </span>
                <span className="w-20 text-right text-[12px] font-semibold" style={{
                  color: u.marginPct === null ? 'oklch(0.60 0.02 258)' : marginColor(u.marginPct),
                  fontFamily: 'var(--font-geist-mono)',
                }}>
                  {u.marginPct !== null ? `${u.marginPct.toFixed(1)}% mg` : 'em cálculo'}
                </span>
              </div>
            ))}
            {ufRows.length === 0 && (
              <div className="text-[13px]" style={{ color: 'oklch(0.50 0.025 258)' }}>Sem vendas no período.</div>
            )}
          </div>
        </div>

        {/* ── Oryma Insights ── */}
        <InsightsPanel data={insightsData} />

        {/* ── Resultado por marketplace + Top produtos — recolhível ── */}
        <details open>
        <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'oklch(0.55 0.03 258)' }}>
          Resultado por canal e top produtos
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Por marketplace */}
          <div
            className="bg-white rounded-2xl p-5"
            style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}
          >
            <div className="text-sm font-semibold mb-4" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Resultado Real por Canal
            </div>
            <div className="space-y-4">
              {Object.entries(byMP).length === 0 && (
                <p className="text-sm" style={{ color: 'oklch(0.70 0.012 258)' }}>Conecte seus marketplaces para ver o resultado real por canal.</p>
              )}
              {Object.entries(byMP).sort((a, b) => b[1].revenue - a[1].revenue).map(([mp, d]) => {
                const margin = pctOf(d)
                const pct = totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                return (
                  <a
                    key={mp}
                    href={`/dashboard/vendas?mp=${mp}&from=${start}&to=${end}`}
                    className="block transition-all rounded-lg px-2 py-1.5 -mx-2 hover-card"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: MP_INFO[mp]?.color ?? 'oklch(0.50 0.025 258)' }} />
                        <span className="text-[13px] font-medium" style={{ color: 'oklch(0.20 0.05 258)' }}>
                          {mpLabel(mp)}
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
                        style={{ width: `${pct}%`, background: MP_INFO[mp]?.color ?? '#125BFF' }}
                      />
                    </div>
                  </a>
                )
              })}
            </div>
          </div>

          {/* Top produtos */}
          <div
            className="bg-white rounded-2xl p-5"
            style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
                Produtos com Maior Resultado
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
                <p className="text-[13px]" style={{ color: 'oklch(0.70 0.012 258)' }}>Assim que houver vendas sincronizadas, os produtos com maior resultado aparecerão aqui.</p>
              )}
              {topProducts.map((p, i) => (
                <a
                  key={i}
                  href={`/dashboard/vendas?product=${p.id}&from=${start}&to=${end}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-all hover-card"
                  style={{ textDecoration: 'none' }}
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
                    {p.margin !== null && (
                      <div className="text-[11px] font-medium" style={{ color: marginColor(p.margin) }}>
                        {fmtPct(p.margin)} mg.
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>

        </div>
        </details>

        {/* ── Vendas por Canal em Tempo Real — recolhível (fechada por padrão) ── */}
        <details>
        <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'oklch(0.55 0.03 258)' }}>
          Vendas por canal em tempo real
        </summary>
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <LiveSalesFeed />
        </div>
        </details>

        {/* Última sync */}
        {lastSync && (
          <div className="text-[12px] text-center" style={{ color: 'oklch(0.50 0.025 258)' }}>
            Última sincronização: {new Date(lastSync.started_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ({lastSync.source})
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
