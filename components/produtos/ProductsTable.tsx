'use client'
import { useMemo, useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

export interface ProductRow {
  id: string
  name: string
  sku: string
  stock: number
  velocity30d: number      // unidades vendidas nos últimos 30 dias
  cmp: number | null
}

type SortKey = 'name' | 'stock' | 'velocity' | 'coverage' | 'cmp'

function fmtR(v: number) {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('velocity')
  const [asc, setAsc] = useState(false)

  const enriched = useMemo(() => rows.map(r => {
    const perDay = r.velocity30d / 30
    // cobertura: dias de estoque no ritmo atual (∞ se não vende)
    const coverage = perDay > 0 ? r.stock / perDay : null
    return { ...r, perDay, coverage }
  }), [rows])

  const view = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q
      ? enriched.filter(r => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
      : enriched
    const dir = asc ? 1 : -1
    const val = (r: typeof list[number]) =>
      sortKey === 'name' ? r.name.toLowerCase()
      : sortKey === 'stock' ? r.stock
      : sortKey === 'velocity' ? r.velocity30d
      : sortKey === 'coverage' ? (r.coverage ?? Infinity)
      : (r.cmp ?? -1)
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }, [enriched, search, sortKey, asc])

  function header(label: string, key: SortKey, align: 'left' | 'right' = 'right') {
    const active = sortKey === key
    const Icon = active ? (asc ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <th
        className={`py-3 px-4 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none ${align === 'left' ? 'text-left' : 'text-right'}`}
        style={{ color: active ? B.brand : B.muted }}
        onClick={() => { if (active) setAsc(!asc); else { setSortKey(key); setAsc(key === 'name') } }}
      >
        <span className="inline-flex items-center gap-1">{label}<Icon size={11} /></span>
      </th>
    )
  }

  function coverageBadge(coverage: number | null, velocity30d: number) {
    if (velocity30d === 0) return <span className="text-[11px]" style={{ color: B.muted }}>sem giro</span>
    if (coverage === null) return <span style={{ color: B.muted }}>—</span>
    const days = Math.round(coverage)
    const color = days < 30 ? '#dc2626' : days < 60 ? '#d97706' : '#16a34a'
    const bg    = days < 30 ? 'oklch(0.96 0.04 25)' : days < 60 ? 'oklch(0.96 0.06 85)' : 'oklch(0.95 0.06 145)'
    return (
      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full num" style={{ color, background: bg }}>
        {days} dias
      </span>
    )
  }

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
      <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${B.border}` }}>
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: B.muted }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou SKU…"
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: `1px solid ${B.border}`, color: B.text }}
          />
        </div>
        <span className="text-[12px]" style={{ color: B.muted }}>{view.length} produtos</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: B.bgSubtle }}>
              {header('Produto', 'name', 'left')}
              {header('Estoque', 'stock')}
              {header('Vendas 30d', 'velocity')}
              {header('Cobertura', 'coverage')}
              {header('CMP', 'cmp')}
            </tr>
          </thead>
          <tbody>
            {view.map(r => (
              <tr key={r.id} className="hover:bg-[oklch(0.97_0.008_258)]" style={{ borderTop: `1px solid ${B.bgSubtle}` }}>
                <td className="py-2.5 px-4">
                  <a href={`/dashboard/vendas?product=${r.id}`} className="font-medium hover:underline" style={{ color: B.text }}>
                    {r.name}
                  </a>
                  <div className="text-[11px]" style={{ color: B.muted }}>{r.sku}</div>
                </td>
                <td className="py-2.5 px-4 text-right num" style={{ fontFamily: 'var(--font-geist-mono)', color: r.stock === 0 ? '#dc2626' : B.text }}>
                  {r.stock.toFixed(0)}
                </td>
                <td className="py-2.5 px-4 text-right num" style={{ fontFamily: 'var(--font-geist-mono)', color: B.text }}>
                  {r.velocity30d.toFixed(0)}
                  {r.velocity30d > 0 && (
                    <span className="text-[10px] ml-1" style={{ color: B.muted }}>({r.perDay.toFixed(1)}/dia)</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right">{coverageBadge(r.coverage, r.velocity30d)}</td>
                <td className="py-2.5 px-4 text-right num" style={{ fontFamily: 'var(--font-geist-mono)', color: r.cmp ? B.text : B.muted }}>
                  {r.cmp !== null ? fmtR(r.cmp) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
