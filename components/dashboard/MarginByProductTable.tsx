'use client'

/**
 * Margem média por produto — coração da gestão/precificação.
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
  cost: number
  fees: number
  marginValue: number
  marginRevenue: number
  inCalc: number
  velocityDay: number
  coverageDays: number | null
  byUf: Array<{ uf: string; units: number; marginPct: number | null }>
}

const B = {
  border: 'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.97 0.008 258)',
  text: '#0B1023',
  muted: 'oklch(0.50 0.025 258)',
  brand: '#125BFF',
}

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }

function marginColor(m: number) {
  if (m >= 25) return 'oklch(0.50 0.19 145)'
  if (m >= 10) return 'oklch(0.62 0.16 70)'
  return 'oklch(0.52 0.20 25)'
}

type SortKey = 'name' | 'units' | 'revenue' | 'cost' | 'fees' | 'marginValue' | 'marginPct' | 'velocityDay' | 'coverageDays'

export function MarginByProductTable({ rows, days }: { rows: ProductMarginRow[]; days: number }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => !q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))

  const val = (r: ProductMarginRow): number | string => {
    if (sortKey === 'name') return r.name.toLowerCase()
    if (sortKey === 'marginPct') return r.marginRevenue > 0 ? r.marginValue / r.marginRevenue : -999
    if (sortKey === 'coverageDays') return r.coverageDays ?? 99999
    return r[sortKey]
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

  return (
    <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid rgba(15,23,42,0.07)', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-sm font-semibold" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Margem por Produto
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: B.muted }}>
            Clique no produto para abrir a distribuição por estado
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
              <HTH k="cost" label="Custo" />
              <HTH k="fees" label="Taxas" />
              <HTH k="marginValue" label="Margem R$" />
              <HTH k="marginPct" label="Margem %" />
              <HTH k="velocityDay" label="Vel/dia" />
              <HTH k="coverageDays" label="Cobertura" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const pct = r.marginRevenue > 0 ? (r.marginValue / r.marginRevenue) * 100 : null
              const isOpen = expanded.has(r.productId)
              const totalUfUnits = r.byUf.reduce((s, u) => s + u.units, 0)
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
                          <div className="text-[13px] font-medium truncate max-w-[220px]" style={{ color: B.text }}>{r.name}</div>
                          <div className="text-[11px]" style={{ color: B.muted }}>{r.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right text-[13px]" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{r.units}</td>
                    <td className="px-2 py-2.5 text-right text-[13px] font-semibold" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{fmtR(r.revenue)}</td>
                    <td className="px-2 py-2.5 text-right text-[13px]" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>{r.cost > 0 ? fmtR(r.cost) : '—'}</td>
                    <td className="px-2 py-2.5 text-right text-[13px]" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>{fmtR(r.fees)}</td>
                    <td className="px-2 py-2.5 text-right text-[13px] font-semibold" style={{ color: pct !== null ? marginColor(pct) : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                      {pct !== null ? fmtR(r.marginValue) : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {pct !== null ? (
                        <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md" style={{ color: marginColor(pct), background: B.bgSubtle }}>
                          {pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[11px] italic" style={{ color: B.muted }}>em cálculo</span>
                      )}
                      {r.inCalc > 0 && pct !== null && (
                        <div className="text-[10px] mt-0.5" style={{ color: B.muted }}>+{r.inCalc} em cálculo</div>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[13px]" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{r.velocityDay.toFixed(1)}</td>
                    <td className="px-2 py-2.5 text-right">
                      {r.coverageDays !== null ? (
                        <span
                          className="text-[12px] font-medium px-1.5 py-0.5 rounded-md"
                          style={{
                            color: r.coverageDays < 30 ? 'oklch(0.52 0.20 25)' : r.coverageDays < 60 ? 'oklch(0.62 0.16 70)' : B.muted,
                            background: B.bgSubtle,
                          }}
                        >
                          {Math.round(r.coverageDays)}d
                        </span>
                      ) : <span className="text-[12px]" style={{ color: B.muted }}>—</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${r.productId}-uf`}>
                      <td colSpan={9} className="px-2 pb-3 pt-1" style={{ background: B.bgSubtle }}>
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
              <tr><td colSpan={9} className="px-2 py-6 text-center text-[13px]" style={{ color: B.muted }}>Nenhum produto no período/busca.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
