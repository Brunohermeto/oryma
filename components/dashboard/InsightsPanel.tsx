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


type Num = number | string | null

/**
 * Dados vêm da Visão Geral (mesma carga, mesmas fórmulas de lib/sales/metrics,
 * mês exibido vs mês anterior com o MESMO nº de dias, fuso do Brasil). Antes o
 * painel fazia 9 consultas próprias, sem paginar, com outra fórmula de
 * faturamento e comparando mês parcial com mês anterior inteiro.
 */
export interface InsightsData {
  products: Array<{ id: string; name: string; stock_quantity: Num; stock_full: Num; stock_fba: Num; stock_shopee: Num; archived: boolean | null }>
  qty30: Record<string, number>           // unidades vendidas nos últimos 30 dias (até hoje)
  noCostProductName: string | null        // 1ª venda do mês sem custo landed
  pendingNFe: number
  margin: { cur: number | null; prev: number | null }   // %
  revenue: { cur: number; prev: number }                // faturamento líquido
  channels: Array<{ mp: string; pct: number | null }>
  start: string
  end: string
}

export function InsightsPanel({ data }: { data: InsightsData }) {
  const { start, end } = data
  const insights: Insight[] = []

  // 1. Estoque crítico
  for (const p of data.products) {
    if (p.archived) continue
    const upd = (data.qty30[p.id] ?? 0) / 30
    if (upd <= 0) continue
    // Estoque CONCILIADO: galpão (Bling) + Full (marketplaces) — nunca só o galpão
    const totalStock = Number(p.stock_quantity ?? 0) + Number(p.stock_full ?? 0) + Number(p.stock_fba ?? 0) + Number(p.stock_shopee ?? 0)
    const daysLeft = Math.floor(totalStock / upd)
    if (daysLeft < 15) insights.push({ id: `stock-critical-${p.id}`, severity: 'critical', title: `Estoque crítico — ${p.name}`, detail: `Ao ritmo atual (${upd.toFixed(1)} un./dia), o estoque total (galpão + Full) acaba em ${daysLeft} dias.`, href: '/dashboard/produtos', metric: `${daysLeft}d` })
    else if (daysLeft < 30) insights.push({ id: `stock-warning-${p.id}`, severity: 'warning', title: `Repor em breve — ${p.name}`, detail: `${daysLeft} dias de estoque total restantes (${upd.toFixed(1)} un./dia).`, href: '/dashboard/produtos', metric: `${daysLeft}d` })
  }

  // 2. Sem custo landed
  if (data.noCostProductName !== null) {
    insights.push({ id: 'no-cost', severity: 'warning', title: 'Margem incalculável — custo landed ausente', detail: `${data.noCostProductName} tem vendas sem CMP. Importe a NF-e de importação.`, href: '/dashboard/importacoes' })
  }

  // 3. NF-e pendentes
  const n = data.pendingNFe
  if (n > 0) insights.push({ id: 'pending-nfe', severity: 'warning', title: `${n} NF-e com despesas pendentes`, detail: 'Adicione frete, seguro, despachante para completar o landed cost.', href: '/dashboard/importacoes', metric: `${n}` })

  // 4. Margem vs mês anterior (mesmo nº de dias)
  const { cur: mCur, prev: mPrev } = data.margin
  if (mCur !== null && mPrev !== null) {
    const delta = mCur - mPrev
    if (delta <= -5) insights.push({ id: 'margin-drop', severity: delta <= -10 ? 'critical' : 'warning', title: `Margem caiu ${Math.abs(delta).toFixed(1)}pp vs. mês anterior`, detail: `Era ${fmtPct(mPrev)} e agora está em ${fmtPct(mCur)}.`, href: `/dashboard/dre?month=${start.slice(0, 7)}`, metric: fmtPct(mCur) })
    else if (delta >= 5) insights.push({ id: 'margin-up', severity: 'positive', title: `Margem subiu ${delta.toFixed(1)}pp vs. mês anterior`, detail: `De ${fmtPct(mPrev)} para ${fmtPct(mCur)}. Bom trabalho!`, href: `/dashboard/dre?month=${start.slice(0, 7)}`, metric: `+${delta.toFixed(1)}pp` })
  }

  // 5. Melhor/pior marketplace
  const LABELS: Record<string, string> = { mercado_livre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', magalu: 'Magalu' }
  const margins = data.channels
    .filter((c): c is { mp: string; pct: number } => c.pct !== null)
    .sort((a, b) => b.pct - a.pct)
  if (margins.length >= 2) {
    const best = margins[0], worst = margins[margins.length - 1]
    insights.push({ id: 'best-channel', severity: 'positive', title: `${LABELS[best.mp] ?? best.mp} é o canal mais rentável`, detail: `Margem de ${fmtPct(best.pct)} vs. ${fmtPct(worst.pct)} do ${LABELS[worst.mp] ?? worst.mp}.`, href: `/dashboard/vendas?mp=${best.mp}&from=${start}&to=${end}`, metric: fmtPct(best.pct) })
  }

  // 6. Receita crescendo/caindo (mesmo nº de dias)
  const { cur, prev } = data.revenue
  if (prev > 0 && cur > 0) {
    const pct = ((cur - prev) / prev) * 100
    if (pct >= 20) insights.push({ id: 'revenue-up', severity: 'positive', title: `Receita cresceu ${pct.toFixed(0)}% vs. mês anterior`, detail: `De ${fmtR(prev)} para ${fmtR(cur)} no mesmo período.`, href: `/dashboard/vendas?from=${start}&to=${end}`, metric: `+${pct.toFixed(0)}%` })
    else if (pct <= -15) insights.push({ id: 'revenue-down', severity: 'warning', title: `Receita caiu ${Math.abs(pct).toFixed(0)}% vs. mês anterior`, detail: `De ${fmtR(prev)} para ${fmtR(cur)} no mesmo período.`, href: `/dashboard/vendas?from=${start}&to=${end}`, metric: `${pct.toFixed(0)}%` })
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
