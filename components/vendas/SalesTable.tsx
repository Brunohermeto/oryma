'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Receipt, Package } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  subtle:   'oklch(0.40 0.020 258)',
  brand:    '#125BFF',
  violeta:  '#7B61FF',
}

const MP_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}
const MP_BADGE: Record<string, { bg: string; color: string }> = {
  mercado_livre: { bg: 'oklch(0.94 0.06 258)', color: '#125BFF' },
  shopee:        { bg: 'oklch(0.94 0.08 280)', color: '#7B61FF' },
  amazon:        { bg: 'oklch(0.94 0.08 204)', color: '#0097b2' },
}
const FULFILLMENT_LABELS: Record<string, string> = {
  galpao: 'Galpão', full_ml: 'Full ML', fba_amazon: 'FBA',
}

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}
function fmtPct(v: number) {
  return `${(Number(v) * 100).toFixed(1)}%`
}
function marginColor(m: number | null) {
  if (m === null) return B.muted
  if (m >= 0.35) return '#16a34a'
  if (m >= 0.20) return '#d97706'
  return '#dc2626'
}

export interface SaleRow {
  id: string
  external_order_id: string
  marketplace: string
  fulfillment_type: string
  sku: string | null
  sale_date: string
  quantity: number
  gross_price: number
  marketplace_commission: number
  marketplace_shipping_fee: number
  ads_cost: number
  cancellation: number
  products: { name: string; sku: string; id?: string } | null
  sale_taxes: { pis: number; cofins: number; icms: number; icms_difal: number; ipi: number; total_taxes: number; nfe_key?: string } | null
  sale_costs: { unit_cost_applied: number; total_cost: number; margin_value: number | null; margin_pct: number | null } | null
}

function SaleDetailPanel({ sale }: { sale: SaleRow }) {
  const taxes    = sale.sale_taxes
  const cost     = sale.sale_costs
  const product  = sale.products
  const faturamento = Number(sale.gross_price) - Number(sale.cancellation)
  const totalTaxes  = Number(taxes?.total_taxes ?? 0)
  const totalFees   = Number(sale.marketplace_commission) + Number(sale.marketplace_shipping_fee)
  const adsC        = Number(sale.ads_cost)
  const cmv         = Number(cost?.total_cost ?? 0)
  const lucro       = cost ? faturamento - totalTaxes - totalFees - adsC - cmv : null

  const productId = (product as any)?.id ?? null
  const vendasUrl = productId ? `/dashboard/vendas?product=${productId}` : null

  return (
    <tr>
      <td colSpan={12} style={{ padding: 0, background: 'oklch(0.97 0.007 258)' }}>
        <div className="px-8 py-5" style={{ borderBottom: `1px solid ${B.border}` }}>
          <div className="grid grid-cols-3 gap-6">

            {/* NF-e Saída / Impostos */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Receipt size={13} style={{ color: B.brand }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: B.brand }}>
                  NF-e de Saída — Impostos
                </span>
              </div>
              {taxes ? (
                <div className="space-y-1.5">
                  {[
                    { label: 'PIS (1,65%)',       value: taxes.pis },
                    { label: 'COFINS (7,60%)',     value: taxes.cofins },
                    { label: 'ICMS',               value: taxes.icms },
                    { label: 'DIFAL',              value: taxes.icms_difal },
                    { label: 'IPI',                value: taxes.ipi },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span style={{ color: B.muted }}>{label}</span>
                      <span className="num font-medium" style={{ color: Number(value) > 0 ? '#dc2626' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                        {Number(value) > 0 ? `(${fmtR(Number(value))})` : '—'}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs pt-1.5" style={{ borderTop: `1px solid ${B.border}` }}>
                    <span className="font-semibold" style={{ color: B.subtle }}>Total impostos</span>
                    <span className="num font-bold" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                      ({fmtR(totalTaxes)})
                    </span>
                  </div>
                  {taxes.nfe_key && (
                    <div className="text-[10px] mt-1 truncate" style={{ color: B.muted }}>
                      NF-e: {taxes.nfe_key.slice(0, 22)}…
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs" style={{ color: B.muted }}>
                  {sale.fulfillment_type === 'galpao'
                    ? 'NF-e não sincronizada ainda'
                    : 'Full ML / FBA — sem NF-e de consumidor'}
                </div>
              )}
            </div>

            {/* Custo (CMV) */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Package size={13} style={{ color: B.violeta }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: B.violeta }}>
                  Custo do Produto (CMV)
                </span>
              </div>
              {cost ? (
                <div className="space-y-1.5">
                  {[
                    { label: 'Custo unit. (CMP)',  value: cost.unit_cost_applied },
                    { label: 'Custo total',         value: cost.total_cost },
                    { label: 'Tarifa marketplace',  value: totalFees },
                    { label: 'ADS',                 value: adsC },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span style={{ color: B.muted }}>{label}</span>
                      <span className="num font-medium" style={{ color: Number(value) > 0 ? '#dc2626' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                        {Number(value) > 0 ? `(${fmtR(Number(value))})` : '—'}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between mt-2">
                    <a
                      href="/dashboard/importacoes"
                      className="text-[11px] flex items-center gap-1 underline"
                      style={{ color: B.violeta }}
                    >
                      <ExternalLink size={10} />
                      Ver lotes de importação
                    </a>
                    {vendasUrl && (
                      <a
                        href={vendasUrl}
                        className="text-[11px] flex items-center gap-1 underline"
                        style={{ color: B.brand }}
                      >
                        <ExternalLink size={10} />
                        Vendas deste produto
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs" style={{ color: B.muted }}>
                  CMV não calculado — importe a NF-e de importação deste produto.
                  <br />
                  <a href="/dashboard/importacoes" className="underline mt-1 inline-block" style={{ color: B.brand }}>
                    → Ir para Importações
                  </a>
                </div>
              )}
            </div>

            {/* Resultado P&L */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'oklch(0.50 0.025 258)' }}>
                Resultado da Venda
              </div>
              <div className="space-y-1.5">
                {[
                  { label: 'Faturamento bruto',   value: faturamento,              sign: 1 },
                  { label: '(-) Impostos',         value: -totalTaxes,              sign: -1 },
                  { label: '(-) Tarifa + frete',   value: -(totalFees),             sign: -1 },
                  { label: '(-) ADS',              value: -adsC,                    sign: -1 },
                  { label: '(-) CMV (landed)',      value: -cmv,                     sign: -1 },
                ].map(({ label, value, sign }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span style={{ color: B.muted }}>{label}</span>
                    <span className="num" style={{
                      color: sign < 0 && Math.abs(value) > 0 ? '#dc2626' : B.subtle,
                      fontFamily: 'var(--font-geist-mono)',
                    }}>
                      {value === 0 ? '—' : sign < 0 ? `(${fmtR(Math.abs(value))})` : fmtR(value)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2" style={{ borderTop: `2px solid ${B.border}` }}>
                  <span className="text-xs font-bold" style={{ color: B.text }}>Lucro bruto</span>
                  <span className="num text-base font-bold" style={{
                    color: lucro === null ? B.muted : lucro >= 0 ? '#16a34a' : '#dc2626',
                    fontFamily: 'var(--font-geist-mono)',
                  }}>
                    {lucro !== null ? fmtR(lucro) : 'Sem custo'}
                  </span>
                </div>
                {cost?.margin_pct !== null && cost?.margin_pct !== undefined && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: B.muted }}>Margem</span>
                    <span className="num text-sm font-bold" style={{
                      color: marginColor(Number(cost.margin_pct)),
                      fontFamily: 'var(--font-geist-mono)',
                    }}>
                      {fmtPct(Number(cost.margin_pct))}
                    </span>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </td>
    </tr>
  )
}

export function SalesTable({ sales }: { sales: SaleRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function toggleRow(id: string) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr style={{ background: 'oklch(0.96 0.010 258)', borderBottom: `1px solid ${B.border}` }}>
          <th className="w-6 px-2 py-3" />
          {['Data','Produto','Canal','Qtd.','Preço unit.','Faturamento','Impostos','Tarifa MP','ADS','Custo (CMV)','Lucro','Margem'].map((h, i) => (
            <th
              key={h}
              className={`py-3 text-[11px] font-semibold uppercase tracking-wide ${i < 3 ? 'text-left px-4' : 'text-right px-4'} ${i === 11 ? 'px-5' : ''}`}
              style={{ color: B.muted }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sales.length === 0 && (
          <tr>
            <td colSpan={13} className="px-5 py-10 text-center text-sm" style={{ color: B.muted }}>
              Nenhuma venda encontrada para os filtros selecionados.
            </td>
          </tr>
        )}
        {sales.map(sale => {
          const taxes      = sale.sale_taxes
          const cost       = sale.sale_costs
          const product    = sale.products
          const expanded   = expandedId === sale.id
          const totalTaxes = Number(taxes?.total_taxes ?? 0)
          const totalFees  = Number(sale.marketplace_commission) + Number(sale.marketplace_shipping_fee)
          const adsC       = Number(sale.ads_cost)
          const faturamento = Number(sale.gross_price) - Number(sale.cancellation)
          const cmv        = Number(cost?.total_cost ?? 0)
          const lucro      = cost ? faturamento - totalTaxes - totalFees - adsC - cmv : null
          const marginPct  = cost?.margin_pct !== null && cost?.margin_pct !== undefined ? Number(cost.margin_pct) : null
          const badge      = MP_BADGE[sale.marketplace] ?? { bg: B.bgSubtle, color: B.brand }

          return (
            <>
              <tr
                key={sale.id}
                className="transition-colors cursor-pointer"
                style={{
                  borderBottom: expanded ? 'none' : `1px solid ${B.bgSubtle}`,
                  background: expanded ? 'oklch(0.97 0.007 258)' : '',
                }}
                onClick={() => toggleRow(sale.id)}
                onMouseEnter={e => {
                  if (!expanded) (e.currentTarget as HTMLElement).style.background = B.bgSubtle
                }}
                onMouseLeave={e => {
                  if (!expanded) (e.currentTarget as HTMLElement).style.background = ''
                }}
              >
                {/* Expand toggle */}
                <td className="px-2 py-2.5">
                  {expanded
                    ? <ChevronDown size={13} style={{ color: B.brand }} />
                    : <ChevronRight size={13} style={{ color: B.muted }} />
                  }
                </td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: B.muted }}>{sale.sale_date}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-xs leading-tight" style={{ color: B.text }}>{product?.name ?? '—'}</div>
                  <div className="text-xs" style={{ color: B.muted }}>{sale.sku} · {FULFILLMENT_LABELS[sale.fulfillment_type] ?? sale.fulfillment_type}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>
                    {MP_LABELS[sale.marketplace] ?? sale.marketplace}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs" style={{ color: B.subtle }}>{Number(sale.quantity).toFixed(0)}</td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                  {Number(sale.quantity) > 0 ? fmtR(faturamento / Number(sale.quantity)) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right font-medium num" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                  {fmtR(faturamento)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {totalTaxes > 0 ? `(${fmtR(totalTaxes)})` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {totalFees > 0 ? `(${fmtR(totalFees)})` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {adsC > 0 ? `(${fmtR(adsC)})` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {cmv > 0 ? `(${fmtR(cmv)})` : <span style={{ color: B.muted }}>sem custo</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold num" style={{ color: lucro === null ? B.muted : lucro >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {lucro !== null ? fmtR(lucro) : '—'}
                </td>
                <td className="px-5 py-2.5 text-right font-bold text-sm num" style={{ color: marginColor(marginPct), fontFamily: 'var(--font-geist-mono)' }}>
                  {marginPct !== null ? fmtPct(marginPct) : '—'}
                </td>
              </tr>
              {expanded && <SaleDetailPanel sale={sale} />}
            </>
          )
        })}
      </tbody>
    </table>
  )
}
