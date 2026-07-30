'use client'

/**
 * Margem por Produto — raio-X fiscal e de taxas por produto (colunas do Bruno):
 * Un, Faturamento, ICMS R$/%, DIFAL R$/%, PIS+COFINS, Frete médio, Estorno
 * médio, Comissão %, Ads %/R$, CMV médio.
 * Filtro de período via links (?days=), busca e ordenação client-side.
 * Linha expandida: % de vendas e margem média por estado (UF de destino).
 */
import { useState } from 'react'
import Link from 'next/link'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'

export interface ProductMarginRow {
  productId: string
  name: string
  sku: string
  units: number
  revenue: number
  icms: number
  difal: number
  piscofins: number
  taxedRevenue: number     // faturamento das vendas COM impostos (denominador dos %)
  inCalc: number           // vendas ainda sem impostos ("em cálculo")
  freteMedio: number | null    // média entre vendas com frete registrado
  estornoMedio: number | null  // média entre vendas com estorno
  commission: number       // comissão + tarifa fixa (bruta)
  ads: number
  cmvMedio: number | null  // custo total / unidades
  marginPct: number | null // margem média % (vendas com impostos calculados)
  velocityDay: number      // unidades / dias do período filtrado
  byUf: Array<{ uf: string; units: number; marginPct: number | null }>
}

const B = {
  border: 'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.97 0.008 258)',
  text: '#0B1023',
  muted: 'oklch(0.50 0.025 258)',
  brand: '#125BFF',
}

function fmtR(v: number) {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtR0(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }

function marginColor(m: number) {
  if (m >= 25) return 'oklch(0.50 0.19 145)'
  if (m >= 10) return 'oklch(0.62 0.16 70)'
  return 'oklch(0.52 0.20 25)'
}

type SortKey = 'name' | 'units' | 'revenue' | 'icms' | 'icmsPct' | 'difal' | 'difalPct'
  | 'piscofins' | 'freteMedio' | 'estornoMedio' | 'commissionPct' | 'adsPct' | 'ads' | 'cmvMedio' | 'marginPct' | 'velocityDay'

export function MarginByProductTable({ rows, days }: { rows: ProductMarginRow[]; days: number }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => !q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))

  const val = (r: ProductMarginRow): number | string => {
    switch (sortKey) {
      case 'name':          return r.name.toLowerCase()
      case 'icmsPct':       return r.taxedRevenue > 0 ? r.icms  / r.taxedRevenue : -1
      case 'difalPct':      return r.taxedRevenue > 0 ? r.difal / r.taxedRevenue : -1
      case 'commissionPct': return r.revenue > 0 ? r.commission / r.revenue : -1
      case 'adsPct':        return r.revenue > 0 ? r.ads / r.revenue : -1
      case 'freteMedio':    return r.freteMedio ?? -1
      case 'estornoMedio':  return r.estornoMedio ?? -1
      case 'cmvMedio':      return r.cmvMedio ?? -1
      case 'marginPct':     return r.marginPct ?? -999
      default:              return r[sortKey]
    }
  }
  const sorted = [...filtered].sort((a, b) => {
    const va = val(a), vb = val(b)
    return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir
  })

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(-1) }
  }
  const toggleRow = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const HTH = ({ k, label, right = true }: { k: SortKey; label: string; right?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={{ color: sortKey === k ? B.brand : B.muted }}
    >
      {label}{sortKey === k ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const pctOf = (v: number, base: number) => base > 0 ? `${(v / base * 100).toFixed(1)}%` : '—'

  const Num = ({ v, bold = false, money = true }: { v: number | null; bold?: boolean; money?: boolean }) => (
    <td className={`px-2 py-2.5 text-right text-[13px] ${bold ? 'font-semibold' : ''}`}
        style={{ color: v !== null ? B.text : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
      {v === null ? '—' : money ? fmtR(v) : String(v)}
    </td>
  )

  return (
    <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-sm font-semibold" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Margem por Produto
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: B.muted }}>
            Impostos, taxas e custo por produto · clique na linha para abrir por estado
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map(d => (
            <Link
              key={d}
              href={`/dashboard?days=${d}`}
              className="text-[12px] font-medium px-2.5 py-1 rounded-full"
              style={{
                background: days === d ? B.brand : B.bgSubtle,
                color: days === d ? 'white' : B.muted,
                textDecoration: 'none',
              }}
            >
              {d} dias
            </Link>
          ))}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ border: `1px solid ${B.border}` }}>
            <Search size={12} style={{ color: B.muted }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar produto…"
              className="text-[12px] outline-none w-32"
              style={{ color: B.text, background: 'transparent' }}
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${B.border}` }}>
              <HTH k="name" label="Produto" right={false} />
              <HTH k="units" label="Un" />
              <HTH k="revenue" label="Faturamento" />
              <HTH k="icms" label="ICMS R$" />
              <HTH k="icmsPct" label="ICMS %" />
              <HTH k="difal" label="DIFAL R$" />
              <HTH k="difalPct" label="DIFAL %" />
              <HTH k="piscofins" label="PIS+COFINS" />
              <HTH k="freteMedio" label="Frete méd" />
              <HTH k="estornoMedio" label="Estorno méd" />
              <HTH k="commissionPct" label="Comissão %" />
              <HTH k="adsPct" label="Ads %" />
              <HTH k="ads" label="Ads R$" />
              <HTH k="cmvMedio" label="CMV méd" />
              <HTH k="marginPct" label="Margem méd %" />
              <HTH k="velocityDay" label="Vel/dia" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const isOpen = expanded.has(r.productId)
              const totalUfUnits = r.byUf.reduce((s, u) => s + u.units, 0)
              const semImpostos = r.taxedRevenue === 0
              return (
                <>
                  <tr
                    key={r.productId}
                    onClick={() => toggleRow(r.productId)}
                    className="cursor-pointer"
                    style={{ borderBottom: `1px solid ${B.bgSubtle}` }}
                  >
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {isOpen ? <ChevronDown size={13} style={{ color: B.brand }} /> : <ChevronRight size={13} style={{ color: B.muted }} />}
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium truncate max-w-[180px]" style={{ color: B.text }}>{r.name}</div>
                          <div className="text-[11px]" style={{ color: B.muted }}>
                            {r.sku}
                            {r.inCalc > 0 && <span className="italic"> · {r.inCalc} em cálculo</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right text-[13px]" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{r.units}</td>
                    <td className="px-2 py-2.5 text-right text-[13px] font-semibold" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{fmtR0(r.revenue)}</td>
                    <Num v={semImpostos ? null : r.icms} />
                    <td className="px-2 py-2.5 text-right text-[12px]" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                      {semImpostos ? '—' : pctOf(r.icms, r.taxedRevenue)}
                    </td>
                    <Num v={semImpostos ? null : r.difal} />
                    <td className="px-2 py-2.5 text-right text-[12px]" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                      {semImpostos ? '—' : pctOf(r.difal, r.taxedRevenue)}
                    </td>
                    <Num v={semImpostos ? null : r.piscofins} />
                    <Num v={r.freteMedio} />
                    <td className="px-2 py-2.5 text-right text-[13px]" style={{ color: r.estornoMedio !== null ? '#16a34a' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                      {r.estornoMedio !== null ? fmtR(r.estornoMedio) : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md" style={{ color: '#d97706', background: B.bgSubtle }}>
                        {pctOf(r.commission, r.revenue)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px]" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                      {r.ads > 0 ? pctOf(r.ads, r.revenue) : '—'}
                    </td>
                    <Num v={r.ads > 0 ? r.ads : null} />
                    <Num v={r.cmvMedio} bold />
                    <td className="px-2 py-2.5 text-right">
                      {r.marginPct !== null ? (
                        <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md" style={{ color: marginColor(r.marginPct), background: B.bgSubtle }}>
                          {r.marginPct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[11px] italic" style={{ color: B.muted }}>em cálculo</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[13px]" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                      {r.velocityDay.toFixed(1)}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${r.productId}-uf`}>
                      <td colSpan={16} className="px-2 pb-3 pt-1" style={{ background: B.bgSubtle }}>
                        <div className="flex flex-wrap gap-2 pl-6 pt-2">
                          {r.byUf.map(u => (
                            <div key={u.uf} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5" style={{ border: `1px solid ${B.border}` }}>
                              <span className="text-[12px] font-bold" style={{ color: B.brand }}>{u.uf}</span>
                              <span className="text-[12px]" style={{ color: B.text }}>
                                {totalUfUnits > 0 ? `${((u.units / totalUfUnits) * 100).toFixed(0)}% das vendas` : `${u.units} un`}
                              </span>
                              <span className="text-[12px] font-medium" style={{ color: u.marginPct !== null ? marginColor(u.marginPct) : B.muted }}>
                                {u.marginPct !== null ? `margem ${u.marginPct.toFixed(1)}%` : 'margem —'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={16} className="px-2 py-6 text-center text-[13px]" style={{ color: B.muted }}>Nenhum produto no período/busca.</td></tr>
            )}
            {/* ── Linha TOTAL (produtos filtrados) ── */}
            {sorted.length > 0 && (() => {
              const t = sorted.reduce((a, r) => {
                a.units += r.units; a.revenue += r.revenue
                a.icms += r.icms; a.difal += r.difal; a.piscofins += r.piscofins
                a.taxedRevenue += r.taxedRevenue
                a.commission += r.commission; a.ads += r.ads
                a.cost += (r.cmvMedio ?? 0) * r.units
                if (r.marginPct !== null) { a.mv += (r.marginPct / 100) * r.revenue; a.mb += r.revenue }
                a.vel += r.velocityDay
                return a
              }, { units: 0, revenue: 0, icms: 0, difal: 0, piscofins: 0, taxedRevenue: 0, commission: 0, ads: 0, cost: 0, mv: 0, mb: 0, vel: 0 })
              const tMargin = t.mb > 0 ? (t.mv / t.mb) * 100 : null
              const td = 'px-2 py-2.5 text-right text-[13px] font-bold'
              const mono = { fontFamily: 'var(--font-geist-mono)', color: B.text }
              return (
                <tr style={{ background: B.bgSubtle, borderTop: `2px solid ${B.border}` }}>
                  <td className="px-2 py-2.5 text-[13px] font-bold" style={{ color: B.text }}>TOTAL</td>
                  <td className={td} style={mono}>{t.units}</td>
                  <td className={td} style={mono}>{fmtR0(t.revenue)}</td>
                  <td className={td} style={mono}>{fmtR0(t.icms)}</td>
                  <td className={td} style={mono}>{t.taxedRevenue > 0 ? pctOf(t.icms, t.taxedRevenue) : '—'}</td>
                  <td className={td} style={mono}>{fmtR0(t.difal)}</td>
                  <td className={td} style={mono}>{t.taxedRevenue > 0 ? pctOf(t.difal, t.taxedRevenue) : '—'}</td>
                  <td className={td} style={mono}>{fmtR0(t.piscofins)}</td>
                  <td className={td} style={{ color: B.muted }}>—</td>
                  <td className={td} style={{ color: B.muted }}>—</td>
                  <td className={td} style={{ ...mono, color: '#d97706' }}>{pctOf(t.commission, t.revenue)}</td>
                  <td className={td} style={mono}>{t.ads > 0 ? pctOf(t.ads, t.revenue) : '—'}</td>
                  <td className={td} style={mono}>{t.ads > 0 ? fmtR0(t.ads) : '—'}</td>
                  <td className={td} style={mono}>{t.units > 0 && t.cost > 0 ? fmtR(t.cost / t.units) : '—'}</td>
                  <td className={td}>
                    {tMargin !== null
                      ? <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md" style={{ color: marginColor(tMargin), background: 'white' }}>{tMargin.toFixed(1)}%</span>
                      : '—'}
                  </td>
                  <td className={td} style={mono}>{t.vel.toFixed(1)}</td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
