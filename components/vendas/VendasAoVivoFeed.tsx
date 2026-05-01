'use client'
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

const MP_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}
const MP_COLORS: Record<string, string> = {
  mercado_livre: '#125BFF',
  shopee: '#7B61FF',
  amazon: '#0097b2',
}
const FULFILLMENT: Record<string, string> = {
  galpao: 'Galpão', full_ml: 'Full ML', fba_amazon: 'FBA',
}

interface Sale {
  id: string
  marketplace: string
  fulfillment_type: string
  sku: string | null
  sale_date: string
  quantity: number
  gross_price: number
  shipping_received: number
  marketplace_commission: number
  marketplace_shipping_fee: number
  ads_cost: number
  cancellation: number
  discounts: number
  products: { name: string; sku: string } | null
  sale_costs: { unit_cost_applied: number; total_cost: number; margin_pct: number | null } | null
}

function fmtR(v: number) {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(v: number) { return `${v.toFixed(1)}%` }

function calcSale(sale: Sale) {
  const grossPrice    = Number(sale.gross_price)
  const shippingRec   = Number(sale.shipping_received ?? 0)
  const cancellation  = Number(sale.cancellation)
  const discounts     = Number(sale.discounts ?? 0)
  const commission    = Number(sale.marketplace_commission)
  const shippingFee   = Number(sale.marketplace_shipping_fee)
  const ads           = Number(sale.ads_cost)
  const cmv           = Number(sale.sale_costs?.total_cost ?? 0)
  const faturamento   = grossPrice + shippingRec - cancellation - discounts
  const totalFees     = commission + shippingFee + ads
  const totalCosts    = totalFees + cmv
  const receitaLiq    = faturamento - totalFees
  const lucro         = sale.sale_costs ? receitaLiq - cmv : null
  const margin        = lucro !== null && receitaLiq > 0 ? (lucro / receitaLiq) * 100 : null
  return { grossPrice, shippingRec, cancellation, discounts, commission, shippingFee, ads, cmv, faturamento, totalFees, totalCosts, receitaLiq, lucro, margin }
}

function MarginBadge({ m }: { m: number | null }) {
  if (m === null) return <span className="text-[11px]" style={{ color: B.muted }}>sem CMV</span>
  const color = m >= 35 ? '#16a34a' : m >= 20 ? '#d97706' : '#dc2626'
  const bg    = m >= 35 ? 'oklch(0.94 0.10 145)' : m >= 20 ? 'oklch(0.96 0.08 70)' : 'oklch(0.96 0.06 25)'
  const Icon  = m >= 35 ? TrendingUp : m >= 20 ? Minus : TrendingDown
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: bg, color }}>
      <Icon size={10} />{pct(m)}
    </span>
  )
}

function PLRow({ label, value, color, indent = false, bold = false, sep = false, positive = false }: {
  label: string; value: number | null; color?: string; indent?: boolean; bold?: boolean; sep?: boolean; positive?: boolean
}) {
  const display = value === null || value === 0 ? '—' : `${positive && value > 0 ? '+' : value < 0 ? '' : '(-)'} ${fmtR(value)}`
  const autoColor = value === null || value === 0 ? B.muted
    : positive ? '#16a34a'
    : value < 0 ? '#16a34a'   // lucro positivo
    : '#dc2626'                // custo = vermelho
  return (
    <>
      {sep && <div className="my-1" style={{ height: 1, background: 'oklch(0.90 0.010 258)' }} />}
      <div className="flex justify-between items-center py-0.5" style={{ paddingLeft: indent ? 12 : 0 }}>
        <span style={{ fontSize: 11, color: bold ? B.text : B.muted, fontWeight: bold ? 600 : 400 }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono)', fontWeight: bold ? 700 : 500, color: color ?? autoColor }}>
          {display}
        </span>
      </div>
    </>
  )
}

function SaleRow({ sale }: { sale: Sale }) {
  const [open, setOpen] = useState(false)
  const c = calcSale(sale)
  const mpColor = MP_COLORS[sale.marketplace] ?? B.brand

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}`, background: 'white' }}>

      {/* Summary row — sempre visível */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left"
        style={{ padding: '12px 16px' }}
      >
        <div className="flex items-center gap-3">

          {/* Canal */}
          <div className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: mpColor }} />

          {/* Produto */}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold truncate" style={{ color: B.text }}>
              {sale.products?.name ?? sale.sku ?? '—'}
            </div>
            <div className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: B.muted }}>
              <span style={{ color: mpColor, fontWeight: 600 }}>{MP_LABELS[sale.marketplace]}</span>
              <span>·</span>
              <span>{FULFILLMENT[sale.fulfillment_type]}</span>
              <span>·</span>
              <span>{Number(sale.quantity).toFixed(0)} un.</span>
              <span>·</span>
              <span>{sale.sale_date}</span>
            </div>
          </div>

          {/* KPIs resumo */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="text-right">
              <div className="text-[10px]" style={{ color: B.muted }}>Venda</div>
              <div className="text-[13px] font-bold num" style={{ color: B.brand, fontFamily: 'var(--font-geist-mono)' }}>
                {fmtR(c.faturamento)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px]" style={{ color: B.muted }}>Total custos</div>
              <div className="text-[13px] font-semibold num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                {c.totalCosts > 0 ? fmtR(c.totalCosts) : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px]" style={{ color: B.muted }}>Lucro</div>
              <div className="text-[13px] font-bold num" style={{
                fontFamily: 'var(--font-geist-mono)',
                color: c.lucro === null ? B.muted : c.lucro >= 0 ? '#16a34a' : '#dc2626',
              }}>
                {c.lucro !== null ? fmtR(c.lucro) : '—'}
              </div>
            </div>
            <MarginBadge m={c.margin} />
            {open ? <ChevronUp size={14} style={{ color: B.muted }} /> : <ChevronDown size={14} style={{ color: B.muted }} />}
          </div>

        </div>
      </button>

      {/* P&L detalhado — expande ao clicar */}
      {open && (
        <div style={{ borderTop: `1px solid ${B.border}`, padding: '12px 16px', background: B.bgSubtle }}>
          <div className="grid grid-cols-2 gap-8">

            {/* Coluna esquerda: receita */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: B.muted }}>
                Receita
              </div>
              <PLRow label="Preço de venda"        value={c.grossPrice}     color={B.brand} bold />
              {c.shippingRec > 0  && <PLRow label="(+) Frete cobrado ao cliente" value={c.shippingRec}  color="#16a34a" indent positive />}
              {c.cancellation > 0 && <PLRow label="(-) Cancelamento"            value={c.cancellation} color="#dc2626" indent />}
              {c.discounts > 0    && <PLRow label="(-) Desconto / cupom"         value={c.discounts}    color="#d97706" indent />}
              <PLRow label="= Faturamento líquido" value={c.faturamento} bold sep color={c.faturamento >= 0 ? B.text : '#dc2626'} />
            </div>

            {/* Coluna direita: custos */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: B.muted }}>
                Custos & Resultado
              </div>
              <PLRow label="(-) Comissão ML"        value={c.commission}  color="#dc2626" indent />
              <PLRow label="(-) Frete ao vendedor"  value={c.shippingFee > 0 ? c.shippingFee : null} color="#dc2626" indent />
              {c.ads > 0 && <PLRow label="(-) ADS" value={c.ads}          color="#dc2626" indent />}
              <PLRow label="= Receita líquida"      value={c.receitaLiq}  bold sep color={c.receitaLiq >= 0 ? B.text : '#dc2626'} />
              <PLRow label="(-) CMV"                value={c.cmv > 0 ? c.cmv : null} color="#dc2626" indent />
              <PLRow
                label="= Lucro estimado"
                value={c.lucro}
                bold sep
                color={c.lucro === null ? B.muted : c.lucro >= 0 ? '#16a34a' : '#dc2626'}
              />
              {c.margin !== null && (
                <div className="flex justify-between items-center pt-1">
                  <span style={{ fontSize: 11, color: B.muted }}>Margem sobre receita líquida</span>
                  <MarginBadge m={c.margin} />
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

// ─── Totalizadores ─────────────────────────────────────────────────────────

function Totals({ sales }: { sales: Sale[] }) {
  const totals = sales.reduce((acc, s) => {
    const c = calcSale(s)
    acc.faturamento += c.faturamento
    acc.fees += c.totalFees
    acc.cmv += c.cmv
    if (c.lucro !== null) { acc.lucro += c.lucro; acc.withCMV++ }
    acc.count++
    return acc
  }, { faturamento: 0, fees: 0, cmv: 0, lucro: 0, withCMV: 0, count: 0 })

  const margin = totals.faturamento - totals.fees > 0
    ? (totals.lucro / (totals.faturamento - totals.fees)) * 100 : null

  const cards = [
    { label: 'Vendas',          value: totals.count,          fmt: (v: number) => `${v}`, color: B.brand },
    { label: 'Faturamento',     value: totals.faturamento,    fmt: fmtR, color: B.brand },
    { label: 'Total tarifas',   value: totals.fees,           fmt: fmtR, color: '#dc2626' },
    { label: 'CMV total',       value: totals.cmv,            fmt: (v: number) => v > 0 ? fmtR(v) : '—', color: '#d97706' },
    { label: 'Lucro estimado',  value: totals.lucro,          fmt: (v: number) => totals.withCMV > 0 ? fmtR(v) : '—', color: '#16a34a' },
    { label: 'Margem média',    value: margin,                fmt: (v: number | null) => v !== null ? pct(v) : '—', color: margin !== null && margin >= 20 ? '#16a34a' : '#d97706' },
  ]

  return (
    <div className="grid grid-cols-6 gap-3 mb-4">
      {cards.map(card => (
        <div key={card.label} className="bg-white rounded-xl p-4" style={{ border: `1px solid ${B.border}` }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: B.muted }}>{card.label}</div>
          <div className="text-[16px] font-bold num" style={{ color: card.color, fontFamily: 'var(--font-geist-mono)' }}>
            {(card.fmt as (v: any) => string)(card.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Feed principal ─────────────────────────────────────────────────────────

export function VendasAoVivoFeed() {
  const [sales, setSales]         = useState<Sale[]>([])
  const [loading, setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [days, setDays]           = useState(7)
  const [mpFilter, setMpFilter]   = useState<string>('all')
  const [fulfFilter, setFulfFilter] = useState<string>('all')

  const fetchSales = useCallback(async (d = days) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sales/live?days=${d}`)
      if (!res.ok) return
      const data = await res.json()
      setSales(data.sales ?? [])
      setLastUpdated(new Date())
    } catch {}
    setLoading(false)
  }, [days])

  useEffect(() => {
    fetchSales(days)
    const interval = setInterval(() => fetchSales(days), 60_000)
    return () => clearInterval(interval)
  }, [days, fetchSales])

  const filtered = sales.filter(s =>
    (mpFilter === 'all' || s.marketplace === mpFilter) &&
    (fulfFilter === 'all' || s.fulfillment_type === fulfFilter)
  )

  const PERIOD = [
    { value: 1, label: 'Hoje' },
    { value: 2, label: '2 dias' },
    { value: 7, label: '7 dias' },
  ]
  const MP_OPTS = [
    { value: 'all', label: 'Todos canais' },
    { value: 'mercado_livre', label: 'Mercado Livre' },
    { value: 'shopee', label: 'Shopee' },
    { value: 'amazon', label: 'Amazon' },
  ]
  const FULF_OPTS = [
    { value: 'all', label: 'Todos envios' },
    { value: 'galpao', label: 'Galpão' },
    { value: 'full_ml', label: 'Full ML' },
    { value: 'fba_amazon', label: 'FBA' },
  ]

  return (
    <div>
      {/* Barra de controles */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {PERIOD.map(o => (
            <button
              key={o.value}
              onClick={() => { setDays(o.value); fetchSales(o.value) }}
              className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: days === o.value ? B.brand : 'white',
                color: days === o.value ? 'white' : B.muted,
                border: `1px solid ${days === o.value ? B.brand : B.border}`,
              }}
            >{o.label}</button>
          ))}
          <div style={{ width: 1, background: B.border, margin: '0 4px' }} />
          {MP_OPTS.map(o => (
            <button
              key={o.value}
              onClick={() => setMpFilter(o.value)}
              className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: mpFilter === o.value ? B.brand : 'white',
                color: mpFilter === o.value ? 'white' : B.muted,
                border: `1px solid ${mpFilter === o.value ? B.brand : B.border}`,
              }}
            >{o.label}</button>
          ))}
          <div style={{ width: 1, background: B.border, margin: '0 4px' }} />
          {FULF_OPTS.map(o => (
            <button
              key={o.value}
              onClick={() => setFulfFilter(o.value)}
              className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: fulfFilter === o.value ? B.brand : 'white',
                color: fulfFilter === o.value ? 'white' : B.muted,
                border: `1px solid ${fulfFilter === o.value ? B.brand : B.border}`,
              }}
            >{o.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: B.muted }}>
            {lastUpdated
              ? `Atualizado ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · auto 60s`
              : 'Carregando…'}
          </span>
          <button
            onClick={() => fetchSales(days)}
            className="p-1.5 rounded-lg"
            style={{ border: `1px solid ${B.border}`, color: B.muted }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Totalizadores */}
      {filtered.length > 0 && <Totals sales={filtered} />}

      {/* Lista de vendas */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center text-sm" style={{ border: `1px solid ${B.border}`, color: B.muted }}>
          Nenhuma venda no período selecionado. Sincronize as vendas em Configurações.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(sale => <SaleRow key={sale.id} sale={sale} />)}
        </div>
      )}
    </div>
  )
}
