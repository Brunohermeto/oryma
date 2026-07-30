import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth, subMonths, subDays, eachDayOfInterval } from 'date-fns'
import { RevenueLineChart } from '@/components/charts/RevenueLineChart'
import { MarginDailyChart, type MarginDailyPoint } from '@/components/charts/MarginDailyChart'
import { MarketplaceBarChart } from '@/components/charts/MarketplaceBarChart'
import { TrendingUp, TrendingDown, ShoppingCart, Percent, DollarSign, ExternalLink } from 'lucide-react'
import { InsightsPanel } from '@/components/dashboard/InsightsPanel'
import { AuditAlertsPanel } from '@/components/dashboard/AuditAlertsPanel'
import { FeeAuditPanel } from '@/components/dashboard/FeeAuditPanel'
import { RunAuditButton } from '@/components/dashboard/RunAuditButton'
import { LiveSalesFeed } from '@/components/dashboard/LiveSalesFeed'
import { MarginByProductTable, type ProductMarginRow } from '@/components/dashboard/MarginByProductTable'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }
function fmtPct(v: number) { return `${v.toFixed(1)}%` }

import { MP_INFO, MP_ORDER, mpLabel } from '@/components/marketplaces'

export default async function DashboardPage(
  { searchParams }: { searchParams: Promise<{ days?: string }> }
) {
  const sp = await searchParams
  const marginDays = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30
  const db = createSupabaseServiceClient()
  const now = new Date()
  // Usa últimos 30 dias como período principal (mais relevante que "mês atual")
  const start = format(subDays(now, 29), 'yyyy-MM-dd')
  const end = format(now, 'yyyy-MM-dd')
  const prevStart = format(subDays(now, 59), 'yyyy-MM-dd')
  const prevEnd = format(subDays(now, 30), 'yyyy-MM-dd')
  const last30Start = start

  const { data: sales } = await db
    .from('sales')
    .select('marketplace, gross_price, marketplace_commission, marketplace_shipping_fee, marketplace_fixed_fee, rebate, ads_cost, cancellation, sale_date, sale_costs(total_cost, margin_value)')
    .gte('sale_date', start)
    .lte('sale_date', end)

  const { data: prevSales } = await db
    .from('sales')
    .select('gross_price, cancellation, marketplace_commission, marketplace_shipping_fee, marketplace_fixed_fee, rebate, ads_cost, sale_costs(margin_value)')
    .gte('sale_date', prevStart)
    .lte('sale_date', prevEnd)

  // Alertas abertos (auditoria + vistoria, sem os dispensados) — semáforo de saúde
  const { count: openAlerts } = await db
    .from('audit_findings')
    .select('id', { count: 'exact', head: true })
    .is('dismissed_at', null)

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

  // Supabase retorna relações como objeto único OU array — trata ambos
  const uw = (v: unknown) => !v ? null : Array.isArray(v) ? (v as any[])[0] ?? null : v

  // ── Taxas pagas no período — por marketplace + total ──
  type FeeAgg = { comissao: number; frete: number; fixa: number; ads: number; estorno: number; revenue: number }
  const newFeeAgg = (): FeeAgg => ({ comissao: 0, frete: 0, fixa: 0, ads: 0, estorno: 0, revenue: 0 })
  const feesByMp: Record<string, FeeAgg> = {}
  const fees = newFeeAgg()
  for (const r of sales ?? []) {
    const mp = (r as any).marketplace as string
    if (!feesByMp[mp]) feesByMp[mp] = newFeeAgg()
    for (const agg of [fees, feesByMp[mp]]) {
      agg.comissao += Number(r.marketplace_commission ?? 0)
      agg.frete    += Number(r.marketplace_shipping_fee ?? 0)
      agg.fixa     += Number((r as any).marketplace_fixed_fee ?? 0)
      agg.ads      += Number(r.ads_cost ?? 0)
      agg.estorno  += Number((r as any).rebate ?? 0)
      agg.revenue  += Number(r.gross_price ?? 0) - Number(r.cancellation ?? 0)
    }
  }
  const feeSum = (a: FeeAgg) => a.comissao + a.frete + a.fixa + a.ads - a.estorno
  const feesTotal = feeSum(fees)

  // ── Margem por produto (período próprio via ?days=) ──
  const { data: marginSales } = await db.from('sales')
    .select(`product_id, marketplace, gross_price, cancellation, quantity, uf_destino, ads_cost,
      marketplace_commission, marketplace_shipping_fee, marketplace_fixed_fee, rebate,
      sale_taxes(icms, icms_difal, pis, cofins), sale_costs(total_cost, margin_value),
      products(id, name, sku)`)
    .gte('sale_date', format(subDays(now, marginDays - 1), 'yyyy-MM-dd'))
    .not('product_id', 'is', null)
    .limit(5000)

  const byProduct = new Map<string, any>()
  for (const s of marginSales ?? []) {
    const p = uw(s.products) as any
    if (!p) continue
    const c = uw(s.sale_costs) as any
    const t = uw(s.sale_taxes) as any
    const g = Number(s.gross_price) - Number(s.cancellation ?? 0)
    let row = byProduct.get(p.id)
    if (!row) {
      row = { productId: p.id, name: p.name, sku: p.sku, units: 0, revenue: 0,
              icms: 0, difal: 0, piscofins: 0, taxedRevenue: 0, inCalc: 0,
              freteSum: 0, freteCount: 0, estornoSum: 0, estornoCount: 0,
              commission: 0, ads: 0, cost: 0, marginValue: 0, marginRevenue: 0,
              ufs: new Map<string, { units: number; mv: number; mg: number }>() }
      byProduct.set(p.id, row)
    }
    row.units      += Number(s.quantity)
    row.revenue    += g
    row.cost       += Number(c?.total_cost ?? 0)
    row.commission += Number(s.marketplace_commission ?? 0) + Number((s as any).marketplace_fixed_fee ?? 0)
    row.ads        += Number(s.ads_cost ?? 0)
    const frete   = Number(s.marketplace_shipping_fee ?? 0)
    const estorno = Number((s as any).rebate ?? 0)
    if (frete   > 0) { row.freteSum   += frete;   row.freteCount++ }
    if (estorno > 0) { row.estornoSum += estorno; row.estornoCount++ }
    if (t) {
      row.icms         += Number(t.icms ?? 0)
      row.difal        += Number(t.icms_difal ?? 0)
      row.piscofins    += Number(t.pis ?? 0) + Number(t.cofins ?? 0)
      row.taxedRevenue += g
    } else row.inCalc++
    const uf = s.uf_destino || 'não informado'
    if (!row.ufs.has(uf)) row.ufs.set(uf, { units: 0, mv: 0, mg: 0 })
    const u = row.ufs.get(uf)
    u.units += Number(s.quantity)
    if (t && c?.margin_value !== null && c?.margin_value !== undefined) {
      row.marginValue   += Number(c.margin_value)
      row.marginRevenue += g
      u.mv += Number(c.margin_value); u.mg += g
    }
  }
  // ── Vendas por ESTADO (mesmo período do filtro ?days=) ──
  const ufGlobal = new Map<string, { units: number; revenue: number; mv: number; mg: number; byMp: Record<string, number> }>()
  for (const s of marginSales ?? []) {
    const uf = s.uf_destino || '??'
    if (!ufGlobal.has(uf)) ufGlobal.set(uf, { units: 0, revenue: 0, mv: 0, mg: 0, byMp: {} })
    const u = ufGlobal.get(uf)!
    const g = Number(s.gross_price) - Number(s.cancellation ?? 0)
    u.units   += Number(s.quantity)
    u.revenue += g
    const smp = (s as any).marketplace as string
    u.byMp[smp] = (u.byMp[smp] ?? 0) + g
    const mvv = (uw(s.sale_costs) as any)?.margin_value
    if (mvv !== null && mvv !== undefined) { u.mv += Number(mvv); u.mg += g }
  }
  const ufTotalRevenue = [...ufGlobal.values()].reduce((s, u) => s + u.revenue, 0) || 1
  const ufTotalUnits   = [...ufGlobal.values()].reduce((s, u) => s + u.units, 0) || 1
  const ufRows = [...ufGlobal.entries()]
    .map(([uf, u]) => ({
      uf, units: u.units, revenue: u.revenue,
      pctRevenue: (u.revenue / ufTotalRevenue) * 100,
      pctUnits: (u.units / ufTotalUnits) * 100,
      marginPct: u.mg > 0 ? (u.mv / u.mg) * 100 : null,
      byMp: u.byMp,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const marginRows: ProductMarginRow[] = [...byProduct.values()].map(r => ({
    productId: r.productId, name: r.name, sku: r.sku, units: r.units,
    revenue: r.revenue,
    icms: r.icms, difal: r.difal, piscofins: r.piscofins,
    taxedRevenue: r.taxedRevenue, inCalc: r.inCalc,
    freteMedio:   r.freteCount   > 0 ? r.freteSum   / r.freteCount   : null,
    estornoMedio: r.estornoCount > 0 ? r.estornoSum / r.estornoCount : null,
    commission: r.commission, ads: r.ads,
    cmvMedio: r.cost > 0 && r.units > 0 ? r.cost / r.units : null,
    marginPct: r.marginRevenue > 0 ? (r.marginValue / r.marginRevenue) * 100 : null,
    velocityDay: r.units / marginDays,
    byUf: [...r.ufs.entries()]
      .map(([uf, u]: [string, any]) => ({
        uf, units: u.units, marginPct: u.mg > 0 ? (u.mv / u.mg) * 100 : null }))
      .sort((a: any, b: any) => b.units - a.units),
  })).sort((a, b) => b.revenue - a.revenue)

  // ── KPIs ──
  const totalRevenue = (sales ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation), 0)
  const prevRevenue = (prevSales ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation ?? 0), 0)
  const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0

  // ── Período anterior (comparação em tudo) ──
  let prevProfit = 0, prevMarginBase = 0
  for (const r of prevSales ?? []) {
    const mv = (uw(r.sale_costs) as any)?.margin_value
    if (mv === null || mv === undefined) continue
    prevProfit     += Number(mv)
    prevMarginBase += Number(r.gross_price) - Number(r.cancellation ?? 0)
  }
  const prevMargin = prevMarginBase > 0 ? (prevProfit / prevMarginBase) * 100 : null
  const prevOrders = (prevSales ?? []).length
  const prevFees   = (prevSales ?? []).reduce((s, r) =>
    s + Number(r.marketplace_commission ?? 0) + Number(r.marketplace_shipping_fee ?? 0)
      + Number((r as any).marketplace_fixed_fee ?? 0) + Number(r.ads_cost ?? 0) - Number((r as any).rebate ?? 0), 0)

  // ── Saúde dos dados (semáforo) ──
  const completeSales = (sales ?? []).filter(r => {
    const mv = (uw(r.sale_costs) as any)?.margin_value
    return mv !== null && mv !== undefined
  }).length
  const emCalculo = (sales ?? []).length - completeSales
  const totalFees = (sales ?? []).reduce((s, r) => s + Number(r.marketplace_commission) + Number(r.marketplace_shipping_fee) + Number(r.ads_cost), 0)
  const totalCMV = (sales ?? []).reduce((s, r) => s + Number((uw(r.sale_costs) as any)?.total_cost ?? 0), 0)
  // Margem REAL = mesma conta da margem por venda (todos os custos + impostos,
  // estorno somado, sobre o faturamento BRUTO), só das vendas já completas —
  // NÃO a fórmula antiga receita líquida − CMV, que ignorava impostos/tarifa fixa.
  let grossProfit = 0, marginBase = 0
  for (const r of sales ?? []) {
    const mv = (uw(r.sale_costs) as any)?.margin_value
    if (mv === null || mv === undefined) continue
    grossProfit += Number(mv)
    marginBase  += Number(r.gross_price) - Number(r.cancellation)
  }
  const grossMargin = marginBase > 0 ? (grossProfit / marginBase) * 100 : 0
  const totalOrders = (sales ?? []).length

  // ── Por marketplace (margem real por venda: margin_value / bruto das completas) ──
  const byMP: Record<string, { revenue: number; marginValue: number; marginBase: number; orders: number }> = {}
  for (const s of sales ?? []) {
    const mp = s.marketplace
    if (!byMP[mp]) byMP[mp] = { revenue: 0, marginValue: 0, marginBase: 0, orders: 0 }
    const g = Number(s.gross_price) - Number(s.cancellation)
    byMP[mp].revenue += g
    const mv = (uw(s.sale_costs) as any)?.margin_value
    if (mv !== null && mv !== undefined) {
      byMP[mp].marginValue += Number(mv)
      byMP[mp].marginBase  += g
    }
    byMP[mp].orders++
  }

  // ── Trend (30 dias) — todas as séries + totalizadora ──
  const days = eachDayOfInterval({ start: subDays(now, 29), end: now })
  const trendData = days.map(day => {
    const dateStr = format(day, 'dd/MM')
    const dayStr = format(day, 'yyyy-MM-dd')
    const row: any = { date: dateStr, total: 0 }
    for (const mp of MP_ORDER) {
      row[mp] = (trendSales ?? [])
        .filter(s => s.sale_date === dayStr && s.marketplace === mp)
        .reduce((s, r) => s + Number(r.gross_price), 0)
      row.total += row[mp]
    }
    return row
  })

  // ── Margem/lucro por dia (30d, vendas completas) ──
  const dayAgg = new Map<string, { mv: number; base: number }>()
  for (const s of sales ?? []) {
    const mv = (uw(s.sale_costs) as any)?.margin_value
    if (mv === null || mv === undefined) continue
    const d = s.sale_date as string
    if (!dayAgg.has(d)) dayAgg.set(d, { mv: 0, base: 0 })
    const a = dayAgg.get(d)!
    a.mv   += Number(mv)
    a.base += Number(s.gross_price) - Number(s.cancellation ?? 0)
  }
  const marginTrend: MarginDailyPoint[] = days.map(day => {
    const key = format(day, 'yyyy-MM-dd')
    const a = dayAgg.get(key)
    return {
      date: format(day, 'dd/MM'),
      lucro: a ? Math.round(a.mv * 100) / 100 : null,
      margem: a && a.base > 0 ? Math.round((a.mv / a.base) * 1000) / 10 : null,
    }
  })

  // ── Bar chart — todos os canais presentes nas vendas ──
  const barData = Object.entries(byMP).map(([mp, d]) => {
    const margin = d.marginBase > 0 ? (d.marginValue / d.marginBase) * 100 : 0
    return { marketplace: mpLabel(mp), margem: margin, receita: d.revenue }
  })

  // ── Top produtos ──
  const productMap: Record<string, { id: string; name: string; sku: string; revenue: number; marginPcts: number[] }> = {}
  for (const s of topProductSales ?? []) {
    const p = s.products as any
    if (!p) continue
    const id = s.product_id as string
    if (!productMap[id]) productMap[id] = { id, name: p.name, sku: p.sku, revenue: 0, marginPcts: [] }
    productMap[id].revenue += Number(s.gross_price)
    const mp = (uw(s.sale_costs) as any)?.margin_pct
    if (mp !== null && mp !== undefined) productMap[id].marginPcts.push(Number(mp))
  }
  const topProducts = Object.values(productMap)
    .map(p => ({ ...p, avgMargin: p.marginPcts.length ? p.marginPcts.reduce((a, b) => a + b, 0) / p.marginPcts.length * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const currentMonth = 'Últimos 30 dias'

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
      <TopBar title="Visão Geral" subtitle="Inteligência financeira consolidada · Ragaluma" />
      <div className="px-4 md:px-8 py-6 space-y-5">

        {/* ── Semáforo de saúde dos dados ── */}
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <span className="font-semibold px-2.5 py-1 rounded-full" style={{
            background: emCalculo === 0 ? 'oklch(0.94 0.10 145)' : 'oklch(0.96 0.08 70)',
            color: emCalculo === 0 ? '#15803d' : '#92400e',
          }}>
            {completeSales} vendas completas{emCalculo > 0 ? ` · ${emCalculo} em cálculo` : ' · tudo calculado ✓'}
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

        {/* ── KPIs gigantes com comparação vs período anterior ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: 'Faturamento (30d)', href: `/dashboard/vendas?from=${start}&to=${end}`,
              value: fmtR(totalRevenue), color: '#125BFF',
              delta: prevRevenue > 0 ? revenueChange : null, deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}%`,
            },
            {
              label: 'Lucro Real (30d)', href: '/dashboard/dre',
              value: fmtR(grossProfit), color: grossProfit >= 0 ? '#16a34a' : '#dc2626',
              delta: prevProfit !== 0 ? ((grossProfit - prevProfit) / Math.abs(prevProfit)) * 100 : null,
              deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(0)}%`,
            },
            {
              label: 'Margem Real', href: '/dashboard/dre',
              value: fmtPct(grossMargin), color: marginColor(grossMargin),
              delta: prevMargin !== null ? grossMargin - prevMargin : null,
              deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}pp`,
            },
            {
              label: 'Pedidos', href: `/dashboard/vendas?from=${start}&to=${end}`,
              value: String(totalOrders), color: '#0B1023',
              delta: prevOrders > 0 ? ((totalOrders - prevOrders) / prevOrders) * 100 : null,
              deltaFmt: (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(0)}%`,
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
                  <span className="text-[11px]" style={{ color: '#94a3b8' }}>vs 30d anteriores</span>
                </div>
              )}
            </a>
          ))}
        </div>

        {/* ── Gráficos — recolhível ── */}
        <details open>
        <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'oklch(0.55 0.03 258)' }}>
          Gráficos — receita, margem e canais
        </summary>
        <div className="space-y-4">
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <div className="mb-4">
            <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
              Margem e Lucro por Dia — Últimos 30 dias
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'oklch(0.50 0.025 258)' }}>
              Totalizado (todos os canais) · barras = lucro do dia (R$) · linha roxa = margem % · só vendas com cálculo completo ·{' '}
              <b style={{ color: '#16a34a' }}>lucro total do período: {fmtR(grossProfit)}</b>
            </div>
          </div>
          <MarginDailyChart data={marginTrend} avgMargin={grossMargin} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className="col-span-2 bg-white rounded-2xl p-5"
            style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}
          >
            <div className="mb-4">
              <div className="text-sm font-semibold" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
                Receita por Dia — Últimos 30 dias
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
            <div className="text-[12px] mb-4" style={{ color: 'oklch(0.50 0.025 258)' }}>Últimos 30 dias · todos os canais</div>
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
              Taxas pagas ao marketplace — últimos 30 dias
            </span>
            {prevFees > 0 && Math.abs(feesTotal - prevFees) / prevFees >= 0.005 && (
              <span className="text-[12px] font-semibold" style={{ color: feesTotal > prevFees ? '#dc2626' : '#16a34a' }}>
                {feesTotal > prevFees ? '▲' : '▼'} {(Math.abs(feesTotal - prevFees) / prevFees * 100).toFixed(1)}% vs 30d anteriores
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
        <MarginByProductTable rows={marginRows} days={marginDays} />

        {/* ── Vendas por estado (mesmo período do filtro) ── */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <div className="text-sm font-semibold mb-1" style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}>
            Vendas por Estado — últimos {marginDays} dias
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
        <InsightsPanel />

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
                const margin = d.marginBase > 0 ? (d.marginValue / d.marginBase) * 100 : 0
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
