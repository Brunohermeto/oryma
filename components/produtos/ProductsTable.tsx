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
  stock: number            // galpão próprio (Bling)
  stockFull: number        // CDs dos marketplaces (Full ML etc.)
  sold12m: number          // unidades vendidas nos últimos 12 meses
  velocityPerDay: number   // un/dia descontando períodos de ruptura de estoque
  cmp: number | null
}

type SortKey = 'name' | 'stock' | 'velocity' | 'coverage' | 'cmp'

function fmtR(v: number) {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type Situacao = 'todos' | 'com_estoque' | 'sem_estoque' | 'critico' | 'sem_giro' | 'sem_custo'

const SITUACOES: Array<{ key: Situacao; label: string }> = [
  { key: 'todos',       label: 'Todos' },
  { key: 'com_estoque', label: 'Com estoque' },
  { key: 'sem_estoque', label: 'Sem estoque' },
  { key: 'critico',     label: 'Repor (cobertura < 30d)' },
  { key: 'sem_giro',    label: 'Sem giro (capital parado)' },
  { key: 'sem_custo',   label: 'Sem custo' },
]

export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const [search, setSearch] = useState('')
  const [situacao, setSituacao] = useState<Situacao>('todos')
  const [sortKey, setSortKey] = useState<SortKey>('velocity')
  const [asc, setAsc] = useState(false)

  const enriched = useMemo(() => rows.map(r => {
    const totalStock = r.stock + r.stockFull
    // cobertura: dias de estoque TOTAL (galpão + Full) no ritmo de venda
    // (velocidade já vem descontada dos períodos sem estoque)
    const coverage = r.velocityPerDay > 0 ? totalStock / r.velocityPerDay : null
    return { ...r, totalStock, coverage }
  }), [rows])

  const view = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q
      ? enriched.filter(r => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
      : enriched
    if (situacao !== 'todos') {
      list = list.filter(r =>
        situacao === 'com_estoque' ? r.totalStock > 0
        : situacao === 'sem_estoque' ? r.totalStock === 0
        : situacao === 'critico' ? (r.coverage !== null && r.coverage < 30)
        : situacao === 'sem_giro' ? (r.sold12m === 0 && r.totalStock > 0)
        : r.cmp === null  // sem_custo
      )
    }
    const dir = asc ? 1 : -1
    const val = (r: typeof list[number]) =>
      sortKey === 'name' ? r.name.toLowerCase()
      : sortKey === 'stock' ? r.totalStock
      : sortKey === 'velocity' ? r.velocityPerDay
      : sortKey === 'coverage' ? (r.coverage ?? Infinity)
      : (r.cmp ?? -1)
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }, [enriched, search, situacao, sortKey, asc])

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

  function coverageBadge(coverage: number | null, sold12m: number) {
    if (sold12m === 0) return <span className="text-[11px]" style={{ color: B.muted }}>sem giro</span>
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
      <div className="px-4 py-3 space-y-2.5" style={{ borderBottom: `1px solid ${B.border}` }}>
        <div className="flex items-center gap-3">
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
        {/* Filtros rápidos por situação */}
        <div className="flex flex-wrap gap-1.5">
          {SITUACOES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSituacao(key)}
              className="text-[12px] font-semibold px-3 py-1 rounded-full transition-colors"
              style={situacao === key
                ? { background: B.brand, color: 'white' }
                : { background: B.bgSubtle, color: B.muted }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: B.bgSubtle }}>
              {header('Produto', 'name', 'left')}
              {header('Estoque', 'stock')}
              {header('Velocidade', 'velocity')}
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
                <td className="py-2.5 px-4 text-right num" style={{ fontFamily: 'var(--font-geist-mono)', color: r.totalStock === 0 ? '#dc2626' : B.text }}>
                  <span className="font-bold">{r.totalStock.toFixed(0)}</span>
                  {r.totalStock > 0 && (
                    <div className="text-[10px]" style={{ color: B.muted }}>
                      galpão {r.stock.toFixed(0)} · full {r.stockFull.toFixed(0)}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right num" style={{ fontFamily: 'var(--font-geist-mono)', color: B.text }}>
                  {r.velocityPerDay > 0 ? (
                    <>
                      <span className="font-bold">{r.velocityPerDay.toFixed(1)}/dia</span>
                      <div className="text-[10px]" style={{ color: B.muted }}>{r.sold12m.toFixed(0)} un em 12m</div>
                    </>
                  ) : (
                    <span style={{ color: B.muted }}>—</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right">{coverageBadge(r.coverage, r.sold12m)}</td>
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
