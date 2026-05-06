import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { AlertTriangle, Zap, CheckCircle, Sparkles } from 'lucide-react'

type Severity = 'critical' | 'warning' | 'info' | 'positive'

interface Insight {
  id: string
  severity: Severity
  title: string
  detail: string
  href?: string
  metric?: string
}

const SEVERITY_STYLES: Record<Severity, { bg: string; border: string; icon: string; text: string }> = {
  critical: { bg: 'oklch(0.97 0.04 25)',  border: 'oklch(0.88 0.08 25)',  icon: '#dc2626', text: 'oklch(0.35 0.12 25)' },
  warning:  { bg: 'oklch(0.97 0.06 70)',  border: 'oklch(0.90 0.10 70)',  icon: '#d97706', text: 'oklch(0.38 0.12 70)' },
  info:     { bg: 'oklch(0.96 0.010 258)', border: 'oklch(0.88 0.016 258)', icon: '#125BFF', text: 'oklch(0.30 0.10 258)' },
  positive: { bg: 'oklch(0.96 0.06 145)', border: 'oklch(0.88 0.10 145)', icon: '#16a34a', text: 'oklch(0.32 0.12 145)' },
}

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }
function fmtPct(v: number) { return `${v.toFixed(1)}%` }

function InsightCard({ insight }: { insight: Insight }) {
  const s = SEVERITY_STYLES[insight.severity]
  const Icon = insight.severity === 'positive' ? CheckCircle : insight.severity === 'info' ? Zap : AlertTriangle
  const content = (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl transition-all" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
      <Icon size={15} className="flex-shrink-0 mt-0.5" style={{ color: s.icon }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold leading-tight" style={{ color: s.text }}>{insight.title}</div>
          {insight.metric && (
            <div className="text-[13px] font-bold num flex-shrink-0" style={{ color: s.icon, fontFamily: 'var(--font-geist-mono)' }}>{insight.metric}</div>
          )}
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: s.text, opacity: 0.75 }}>{insight.detail}</div>
      </div>
      {insight.href && <span className="text-[12px] flex-shrink-0 font-medium" style={{ color: s.icon }}>→</span>}
    </div>
  )
  return insight.href ? <a href={insight.href} className="block">{content}</a> : content
}

const uwc = (v: unknown) => !v ? null : Array.isArray(v) ? (v as any[])[0] ?? null : v as any

export async function InsightsPanel() {
  const db = createSupabaseServiceClient()
  const now = new Date()
  const start     = format(startOfMonth(now), 'yyyy-MM-dd')
  const end       = format(endOfMonth(now), 'yyyy-MM-dd')
  const prevStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const prevEnd   = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const d30       = format(subDays(now, 29), 'yyyy-MM-dd')
  const today     = format(now, 'yyyy-MM-dd')

  // Todas as queries em paralelo — era o maior gargalo de latência
  const [
    productsRes, recentSalesRes, salesNoCostRes, pendingNFeRes,
    curSalesRes, prevSalesRes, mpSalesRes, curRevRes, prevRevRes,
  ] = await Promise.allSettled([
    db.from('products').select('id, name, sku, stock_quantity'),
    db.from('sales').select('product_id, quantity').gte('sale_date', d30).lte('sale_date', today),
    db.from('sales').select('product_id, products(name, sku)').gte('sale_date', start).lte('sale_date', end).is('sale_costs', null).limit(1),
    db.from('import_orders').select('id', { count: 'exact', head: true }).eq('costs_complete', false),
    db.from('sales').select('gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, sale_costs(total_cost)').gte('sale_date', start).lte('sale_date', end),
    db.from('sales').select('gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, sale_costs(total_cost)').gte('sale_date', prevStart).lte('sale_date', prevEnd),
    db.from('sales').select('marketplace, gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, sale_costs(total_cost)').gte('sale_date', start).lte('sale_date', end),
    db.from('sales').select('gross_price, cancellation').gte('sale_date', start).lte('sale_date', end),
    db.from('sales').select('gross_price, cancellation').gte('sale_date', prevStart).lte('sale_date', prevEnd),
  ])

  const insights: Insight[] = []

  // 1. Estoque crítico
  if (productsRes.status === 'fulfilled' && recentSalesRes.status === 'fulfilled') {
    const products    = productsRes.value.data ?? []
    const recentSales = recentSalesRes.value.data ?? []
    const byProd: Record<string, number> = {}
    for (const s of recentSales) byProd[s.product_id] = (byProd[s.product_id] ?? 0) + Number(s.quantity)
    for (const p of products) {
      const upd = (byProd[p.id] ?? 0) / 30
      if (upd <= 0) continue
      const daysLeft = Math.floor(Number(p.stock_quantity) / upd)
      if (daysLeft < 15) insights.push({ id: `stock-critical-${p.id}`, severity: 'critical', title: `Estoque crítico — ${p.name}`, detail: `Ao ritmo atual (${upd.toFixed(1)} un./dia), acaba em ${daysLeft} dias.`, href: '/dashboard/velocidade', metric: `${daysLeft}d` })
      else if (daysLeft < 30) insights.push({ id: `stock-warning-${p.id}`, severity: 'warning', title: `Repor em breve — ${p.name}`, detail: `${daysLeft} dias de estoque restantes (${upd.toFixed(1)} un./dia).`, href: '/dashboard/velocidade', metric: `${daysLeft}d` })
    }
  }

  // 2. Sem custo landed
  if (salesNoCostRes.status === 'fulfilled' && (salesNoCostRes.value.data ?? []).length > 0) {
    const p = (salesNoCostRes.value.data![0].products as any)
    insights.push({ id: 'no-cost', severity: 'warning', title: 'Margem incalculável — custo landed ausente', detail: `${p?.name ?? 'Produto'} tem vendas sem CMP. Importe a NF-e de importação.`, href: '/dashboard/importacoes' })
  }

  // 3. NF-e pendentes
  if (pendingNFeRes.status === 'fulfilled') {
    const n = pendingNFeRes.value.count ?? 0
    if (n > 0) insights.push({ id: 'pending-nfe', severity: 'warning', title: `${n} NF-e com despesas pendentes`, detail: 'Adicione frete, seguro, despachante para completar o landed cost.', href: '/dashboard/importacoes', metric: `${n}` })
  }

  // 4. Margem vs mês anterior
  if (curSalesRes.status === 'fulfilled' && prevSalesRes.status === 'fulfilled') {
    function calcMargin(rows: any[] | null | undefined) {
      if (!rows?.length) return null
      const rev  = rows.reduce((s: number, r: any) => s + Number(r.gross_price) - Number(r.cancellation), 0)
      const fees = rows.reduce((s: number, r: any) => s + Number(r.marketplace_commission) + Number(r.marketplace_shipping_fee) + Number(r.ads_cost), 0)
      const cmv  = rows.reduce((s: number, r: any) => s + Number(uwc(r.sale_costs)?.total_cost ?? 0), 0)
      const net  = rev - fees
      return net <= 0 ? null : ((net - cmv) / net) * 100
    }
    const cur  = calcMargin(curSalesRes.value.data)
    const prev = calcMargin(prevSalesRes.value.data)
    if (cur !== null && prev !== null) {
      const delta = cur - prev
      if (delta <= -5) insights.push({ id: 'margin-drop', severity: delta <= -10 ? 'critical' : 'warning', title: `Margem caiu ${Math.abs(delta).toFixed(1)}pp vs. mês anterior`, detail: `Era ${fmtPct(prev)} e agora está em ${fmtPct(cur)}.`, href: '/dashboard/dre', metric: fmtPct(cur) })
      else if (delta >= 5) insights.push({ id: 'margin-up', severity: 'positive', title: `Margem subiu ${delta.toFixed(1)}pp vs. mês anterior`, detail: `De ${fmtPct(prev)} para ${fmtPct(cur)}. Bom trabalho!`, href: '/dashboard/dre', metric: `+${delta.toFixed(1)}pp` })
    }
  }

  // 5. Melhor/pior marketplace
  if (mpSalesRes.status === 'fulfilled') {
    const mpMap: Record<string, { net: number; cmv: number }> = {}
    const LABELS: Record<string, string> = { mercado_livre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' }
    for (const s of (mpSalesRes.value.data ?? [])) {
      const mp = s.marketplace
      if (!mpMap[mp]) mpMap[mp] = { net: 0, cmv: 0 }
      const rev  = Number(s.gross_price) - Number(s.cancellation)
      const fees = Number(s.marketplace_commission) + Number(s.marketplace_shipping_fee) + Number(s.ads_cost)
      mpMap[mp].net  += rev - fees
      mpMap[mp].cmv  += Number(uwc(s.sale_costs)?.total_cost ?? 0)
    }
    const margins = Object.entries(mpMap).map(([mp, d]) => ({ mp, margin: d.net > 0 ? ((d.net - d.cmv) / d.net) * 100 : 0 })).filter(m => m.margin > 0).sort((a, b) => b.margin - a.margin)
    if (margins.length >= 2) {
      const best = margins[0], worst = margins[margins.length - 1]
      insights.push({ id: 'best-channel', severity: 'positive', title: `${LABELS[best.mp] ?? best.mp} é o canal mais rentável`, detail: `Margem de ${fmtPct(best.margin)} vs. ${fmtPct(worst.margin)} do ${LABELS[worst.mp] ?? worst.mp}.`, href: `/dashboard/vendas?mp=${best.mp}&from=${start}&to=${end}`, metric: fmtPct(best.margin) })
    }
  }

  // 6. Receita crescendo/caindo
  if (curRevRes.status === 'fulfilled' && prevRevRes.status === 'fulfilled') {
    const cur  = (curRevRes.value.data  ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation), 0)
    const prev = (prevRevRes.value.data ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation), 0)
    if (prev > 0 && cur > 0) {
      const pct = ((cur - prev) / prev) * 100
      if (pct >= 20) insights.push({ id: 'revenue-up', severity: 'positive', title: `Receita cresceu ${pct.toFixed(0)}% vs. mês anterior`, detail: `De ${fmtR(prev)} para ${fmtR(cur)} este mês.`, href: `/dashboard/vendas?from=${start}&to=${end}`, metric: `+${pct.toFixed(0)}%` })
      else if (pct <= -15) insights.push({ id: 'revenue-down', severity: 'warning', title: `Receita caiu ${Math.abs(pct).toFixed(0)}% vs. mês anterior`, detail: `De ${fmtR(prev)} para ${fmtR(cur)} este mês.`, href: `/dashboard/vendas?from=${start}&to=${end}`, metric: `${pct.toFixed(0)}%` })
    }
  }

  if (insights.length === 0) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm" style={{ background: 'oklch(0.96 0.06 145)', border: '1px solid oklch(0.88 0.10 145)', color: 'oklch(0.32 0.12 145)' }}>
        <CheckCircle size={15} />
        <span className="font-medium">Tudo em ordem</span>
        <span style={{ opacity: 0.7 }}>— Nenhum alerta para este período.</span>
      </div>
    )
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, positive: 3 }
  const visible = insights.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 4)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={13} style={{ color: '#7B61FF' }} />
          <div className="text-[13px] font-semibold" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>Insights Oryma</div>
          <span className="text-[11px]" style={{ color: 'oklch(0.50 0.025 258)' }}>— Análise automática da sua operação</span>
        </div>
        {insights.length > 4 && <div className="text-[11px]" style={{ color: 'oklch(0.50 0.025 258)' }}>+{insights.length - 4} alertas adicionais</div>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {visible.map(insight => <InsightCard key={insight.id} insight={insight} />)}
      </div>
    </div>
  )
}
