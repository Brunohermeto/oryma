'use client'
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

const CHANNELS: Record<string, { label: string; color: string; bg: string }> = {
  mercado_livre: { label: 'Mercado Livre', color: '#125BFF', bg: 'oklch(0.94 0.06 258)' },
  shopee:        { label: 'Shopee',         color: '#7B61FF', bg: 'oklch(0.94 0.08 280)' },
  amazon:        { label: 'Amazon',          color: '#0097b2', bg: 'oklch(0.94 0.06 204)' },
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
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: B.muted, fontSize: 11 }}>sem custo</span>
  const m = pct * 100
  const color = m >= 35 ? '#16a34a' : m >= 20 ? '#d97706' : '#dc2626'
  const bg = m >= 35 ? 'oklch(0.94 0.10 145)' : m >= 20 ? 'oklch(0.96 0.08 70)' : 'oklch(0.96 0.06 25)'
  const Icon = m >= 35 ? TrendingUp : m >= 20 ? Minus : TrendingDown
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
      style={{ background: bg, color }}
    >
      <Icon size={10} />
      {m.toFixed(1)}%
    </span>
  )
}

function Row({ label, value, color, indent = false, bold = false, separator = false }: {
  label: string; value: number | null; color?: string; indent?: boolean; bold?: boolean; separator?: boolean
}) {
  return (
    <>
      {separator && <div style={{ height: 1, background: 'oklch(0.92 0.010 258)', margin: '3px 0' }} />}
      <div className="flex items-center justify-between" style={{ paddingLeft: indent ? 8 : 0 }}>
        <span style={{
          fontSize: 10,
          color: bold ? B.text : B.muted,
          fontWeight: bold ? 600 : 400,
        }}>{label}</span>
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--font-geist-mono)',
          fontWeight: bold ? 700 : 500,
          color: color ?? (value === null ? B.muted : B.text),
        }}>
          {value === null ? '—' : value === 0 ? '—' : fmtR(Math.abs(value))}
        </span>
      </div>
    </>
  )
}

// Card simplificado para o dashboard
function SaleCard({ sale }: { sale: Sale }) {
  const grossPrice      = Number(sale.gross_price)
  const shippingRec     = Number(sale.shipping_received ?? 0)
  const cancellation    = Number(sale.cancellation)
  const discounts       = Number(sale.discounts ?? 0)
  const commission      = Number(sale.marketplace_commission)
  const shippingFee     = Number(sale.marketplace_shipping_fee)  // custo frete ao vendedor
  const ads             = Number(sale.ads_cost)
  const cmv             = Number(sale.sale_costs?.total_cost ?? 0)

  const faturamento     = grossPrice + shippingRec - cancellation - discounts
  const totalFees       = commission + shippingFee + ads
  const receitaLiquida  = faturamento - totalFees
  const lucro           = sale.sale_costs ? receitaLiquida - cmv : null
  const marginPct       = lucro !== null && receitaLiquida > 0 ? (lucro / receitaLiquida) * 100 : null

  const totalCosts = totalFees + cmv

  return (
    <a
      href="/dashboard/vendas-ao-vivo"
      className="block rounded-xl p-3 transition-all hover-card"
      style={{ background: 'white', border: `1px solid ${B.border}`, textDecoration: 'none' }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-tight truncate" style={{ color: B.text }}>
            {sale.products?.name ?? sale.sku ?? '—'}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: B.muted }}>
            {FULFILLMENT[sale.fulfillment_type]} · {Number(sale.quantity).toFixed(0)} un.
          </div>
        </div>
        <MarginBadge pct={marginPct !== null ? marginPct / 100 : null} />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg py-1.5 px-2" style={{ background: B.bgSubtle }}>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: B.muted }}>Preço venda</div>
          <div className="text-[12px] font-bold num" style={{ color: B.brand, fontFamily: 'var(--font-geist-mono)' }}>{fmtR(faturamento)}</div>
        </div>
        <div className="rounded-lg py-1.5 px-2" style={{ background: B.bgSubtle }}>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: B.muted }}>Total custos</div>
          <div className="text-[12px] font-bold num" style={{ color: totalCosts > 0 ? '#dc2626' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
            {totalCosts > 0 ? fmtR(totalCosts) : '—'}
          </div>
        </div>
        <div className="rounded-lg py-1.5 px-2" style={{ background: B.bgSubtle }}>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: B.muted }}>Lucro</div>
          <div className="text-[12px] font-bold num" style={{ color: lucro === null ? B.muted : lucro >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
            {lucro !== null ? fmtR(lucro) : '—'}
          </div>
        </div>
        <div className="rounded-lg py-1.5 px-2 flex items-center justify-between" style={{ background: B.bgSubtle }}>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: B.muted }}>Margem</div>
          <MarginBadge pct={marginPct !== null ? marginPct / 100 : null} />
        </div>
      </div>
      <div className="text-[9px] mt-1.5 text-right" style={{ color: B.muted }}>{sale.sale_date} · ver detalhes →</div>
    </a>
  )
}

function ChannelColumn({ channel, sales, total }: {
  channel: string
  sales: Sale[]
  total: { faturamento: number; lucro: number; count: number }
}) {
  const ch = CHANNELS[channel]
  return (
    <div className="flex flex-col gap-2">
      {/* Header do canal */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-xl"
        style={{ background: ch.bg, border: `1px solid ${B.border}` }}
      >
        <div>
          <div className="text-[12px] font-bold" style={{ color: ch.color }}>{ch.label}</div>
          <div className="text-[10px]" style={{ color: B.muted }}>{total.count} vendas</div>
        </div>
        <div className="text-right">
          <div className="text-[12px] font-bold num" style={{ color: ch.color, fontFamily: 'var(--font-geist-mono)' }}>
            {total.faturamento > 0 ? `R$ ${Math.round(total.faturamento).toLocaleString('pt-BR')}` : '—'}
          </div>
          {total.lucro !== 0 && (
            <div className="text-[10px] font-medium num" style={{
              color: total.lucro >= 0 ? '#16a34a' : '#dc2626',
              fontFamily: 'var(--font-geist-mono)',
            }}>
              {total.lucro >= 0 ? '+' : ''}{`R$ ${Math.round(total.lucro).toLocaleString('pt-BR')}`}
            </div>
          )}
        </div>
      </div>

      {/* Cards de vendas */}
      {sales.length === 0 ? (
        <div
          className="rounded-xl px-4 py-6 text-center text-[12px]"
          style={{ border: `1px dashed ${B.border}`, color: B.muted }}
        >
          Sem vendas neste período
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[400px] md:max-h-[500px] overflow-y-auto pr-0.5">
          {sales.map(sale => <SaleCard key={sale.id} sale={sale} />)}
        </div>
      )}
    </div>
  )
}

export function LiveSalesFeed() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [days, setDays] = useState(1)

  const fetchSales = useCallback(async (d = days) => {
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
    const interval = setInterval(() => fetchSales(days), 60_000) // refresh a cada 60s
    return () => clearInterval(interval)
  }, [days, fetchSales])

  // Agrupa por canal
  const byChannel: Record<string, Sale[]> = { mercado_livre: [], shopee: [], amazon: [] }
  for (const s of sales) {
    if (byChannel[s.marketplace]) byChannel[s.marketplace].push(s)
  }

  // Totais por canal
  function channelTotals(channelSales: Sale[]) {
    return channelSales.reduce((acc, s) => {
      const fat = Number(s.gross_price) - Number(s.cancellation)
      const fees = Number(s.marketplace_commission) + Number(s.marketplace_shipping_fee) + Number(s.ads_cost)
      const cmv = Number(s.sale_costs?.total_cost ?? 0)
      acc.faturamento += fat
      acc.lucro += s.sale_costs ? fat - fees - cmv : 0
      acc.count++
      return acc
    }, { faturamento: 0, lucro: 0, count: 0 })
  }

  const PERIOD_OPTIONS = [
    { value: 1, label: 'Hoje' },
    { value: 2, label: 'Ontem + Hoje' },
    { value: 7, label: 'Últimos 7 dias' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Vendas por Canal
          </div>
          <div className="text-[11px]" style={{ color: B.muted }}>
            {lastUpdated
              ? `Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh 60s`
              : 'Carregando…'
            }
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Período */}
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setDays(opt.value); fetchSales(opt.value) }}
                className="text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all"
                style={{
                  background: days === opt.value ? B.brand : B.bgSubtle,
                  color: days === opt.value ? 'white' : B.muted,
                  border: `1px solid ${days === opt.value ? B.brand : B.border}`,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Refresh manual */}
          <button
            onClick={() => fetchSales(days)}
            className="p-1.5 rounded-lg transition-all"
            style={{ border: `1px solid ${B.border}`, color: B.muted }}
            title="Atualizar agora"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Colunas por canal */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(byChannel).map(([channel, channelSales]) => (
          <ChannelColumn
            key={channel}
            channel={channel}
            sales={channelSales}
            total={channelTotals(channelSales)}
          />
        ))}
      </div>
    </div>
  )
}
