'use client'

/**
 * Custos por SKU — todos os produtos com o custo vigente (NF ou manual),
 * edição manual (valor + data de vigência obrigatória) e cadeado por SKU
 * (travado = NF de entrada não altera; para kits/conjuntos).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Pencil, Lock, LockOpen, Check, X } from 'lucide-react'

export interface SkuCostRow {
  productId: string
  sku: string
  name: string
  cost: number | null
  effectiveDate: string | null
  source: 'nf' | 'manual' | null
  locked: boolean
  archived: boolean
  salesCount: number
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
function fmtDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

type Filter = 'todos' | 'sem_custo' | 'manual' | 'travado' | 'arquivados'

export function SkuCostTable({ rows }: { rows: SkuCostRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('todos')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editDate, setEditDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [lockBusy, setLockBusy] = useState<string | null>(null)

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (q && !r.sku.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false
    // Arquivados (sem venda 6m + sem estoque) só aparecem no próprio filtro
    if (filter === 'arquivados') return r.archived
    if (r.archived) return false
    if (filter === 'sem_custo') return r.cost === null
    if (filter === 'manual') return r.source === 'manual'
    if (filter === 'travado') return r.locked
    return true
  })

  function startEdit(r: SkuCostRow) {
    setEditing(r.productId)
    setEditValue(r.cost !== null ? String(r.cost.toFixed(2)).replace('.', ',') : '')
    setEditDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()))
    setMsg('')
  }

  async function saveEdit(r: SkuCostRow) {
    const value = Number(editValue.replace(/\./g, '').replace(',', '.'))
    if (!value || value <= 0) { setMsg('Informe um valor maior que zero.'); return }
    if (!editDate) { setMsg('Informe a data de início da vigência.'); return }
    setSaving(true)
    setMsg('Salvando e recalculando margens…')
    try {
      const res = await fetch('/api/cmp/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ product_id: r.productId, cmp_value: value, effective_date: editDate }] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'falhou')
      setMsg(`✓ Custo de ${r.sku} salvo: ${fmtR(value)} a partir de ${fmtDate(editDate)}`)
      setEditing(null)
      router.refresh()
    } catch (e) {
      setMsg(`Erro: ${String(e).replace('Error: ', '')}`)
    }
    setSaving(false)
  }

  async function toggleLock(r: SkuCostRow) {
    setLockBusy(r.productId)
    try {
      const res = await fetch('/api/products/cost-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: r.productId, locked: !r.locked }),
      })
      if (res.ok) {
        setMsg(!r.locked
          ? `🔒 ${r.sku} travado — NFs de entrada não alteram mais o custo (só manual).`
          : `🔓 ${r.sku} destravado — a próxima NF de entrada volta a definir o custo.`)
        router.refresh()
      }
    } catch { /* mantém estado */ }
    setLockBusy(null)
  }

  const vivos = rows.filter(r => !r.archived)
  const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: 'todos', label: `Todos (${vivos.length})` },
    { key: 'sem_custo', label: `Sem custo (${vivos.filter(r => r.cost === null).length})` },
    { key: 'manual', label: `Manual (${vivos.filter(r => r.source === 'manual').length})` },
    { key: 'travado', label: `Travados (${vivos.filter(r => r.locked).length})` },
    { key: 'arquivados', label: `Arquivados (${rows.length - vivos.length})` },
  ]

  return (
    <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="text-[12px] font-medium px-2.5 py-1 rounded-full cursor-pointer"
              style={{
                background: filter === f.key ? B.brand : B.bgSubtle,
                color: filter === f.key ? 'white' : B.muted,
                border: 'none',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ border: `1px solid ${B.border}` }}>
          <Search size={12} style={{ color: B.muted }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar SKU ou nome…"
            className="text-[12px] outline-none w-40"
            style={{ color: B.text, background: 'transparent' }}
          />
        </div>
      </div>

      {msg && (
        <div className="text-[12px] mb-3 px-3 py-2 rounded-lg" style={{ background: B.bgSubtle, color: msg.startsWith('Erro') ? '#dc2626' : B.text }}>
          {msg}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${B.border}` }}>
              {['SKU / Produto', 'Custo vigente', 'Vigente desde', 'Origem', 'Vendas', 'Cadeado', ''].map((h, i) => (
                <th key={h + i} className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: B.muted }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.productId} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-2 py-2.5">
                  <div className="text-[13px] font-medium" style={{ color: B.text }}>{r.sku}</div>
                  <div className="text-[11px] truncate max-w-[260px]" style={{ color: B.muted }}>{r.name}</div>
                </td>
                {editing === r.productId ? (
                  <td className="px-2 py-2.5 text-right" colSpan={3}>
                    <div className="flex items-center gap-2 justify-end flex-wrap">
                      <input
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        placeholder="0,00"
                        autoFocus
                        className="text-[13px] px-2 py-1 rounded-lg w-24 text-right outline-none"
                        style={{ border: `1px solid ${B.brand}`, color: B.text, fontFamily: 'var(--font-geist-mono)' }}
                      />
                      <span className="text-[11px]" style={{ color: B.muted }}>vigente desde</span>
                      <input
                        type="date"
                        value={editDate}
                        onChange={e => setEditDate(e.target.value)}
                        className="text-[12px] px-2 py-1 rounded-lg outline-none"
                        style={{ border: `1px solid ${B.border}`, color: B.text }}
                      />
                      <button onClick={() => saveEdit(r)} disabled={saving} className="p-1 rounded-lg cursor-pointer" style={{ background: B.brand, border: 'none' }}>
                        <Check size={13} color="white" />
                      </button>
                      <button onClick={() => setEditing(null)} disabled={saving} className="p-1 rounded-lg cursor-pointer" style={{ background: B.bgSubtle, border: 'none' }}>
                        <X size={13} style={{ color: B.muted }} />
                      </button>
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-2.5 text-right text-[13px] font-semibold" style={{ color: r.cost !== null ? B.text : '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                      {r.cost !== null ? fmtR(r.cost) : 'sem custo'}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px]" style={{ color: B.muted }}>
                      {r.effectiveDate ? fmtDate(r.effectiveDate) : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {r.source && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-md" style={{
                          background: r.source === 'manual' ? 'oklch(0.94 0.06 280)' : B.bgSubtle,
                          color: r.source === 'manual' ? '#7B61FF' : B.muted,
                        }}>
                          {r.source === 'manual' ? 'Manual' : 'NF de entrada'}
                        </span>
                      )}
                    </td>
                  </>
                )}
                <td className="px-2 py-2.5 text-right text-[12px]" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>{r.salesCount}</td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    onClick={() => toggleLock(r)}
                    disabled={lockBusy === r.productId}
                    title={r.locked ? 'Travado: NFs não alteram o custo (kits). Clique para destravar.' : 'Destravado: NF nova define o custo. Clique para travar.'}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ background: r.locked ? 'oklch(0.94 0.06 70)' : B.bgSubtle, border: 'none' }}
                  >
                    {r.locked
                      ? <Lock size={13} style={{ color: '#d97706' }} />
                      : <LockOpen size={13} style={{ color: B.muted }} />}
                  </button>
                </td>
                <td className="px-2 py-2.5 text-right">
                  {editing !== r.productId && (
                    <div className="flex items-center gap-1.5 justify-end">
                      {r.source === 'manual' && (
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Remover o custo manual de ${r.sku} e voltar ao custo da NF de entrada?\n(O cadeado também será destravado e as margens recalculadas.)`)) return
                            setMsg('Removendo custo manual e recalculando…')
                            const res = await fetch('/api/cmp/manual', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ remove_manual_product_id: r.productId }),
                            })
                            const d = await res.json()
                            setMsg(res.ok ? `✓ ${d.message}` : `Erro: ${d.error}`)
                            router.refresh()
                          }}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg cursor-pointer whitespace-nowrap"
                          title="Remove o custo manual — o custo da NF de entrada reassume"
                          style={{ background: 'white', color: '#d97706', border: '1px dashed #d97706' }}
                        >
                          voltar à NF
                        </button>
                      )}
                      <button onClick={() => startEdit(r)} className="p-1.5 rounded-lg cursor-pointer" title="Editar custo manualmente" style={{ background: B.bgSubtle, border: 'none' }}>
                        <Pencil size={13} style={{ color: B.brand }} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-6 text-center text-[13px]" style={{ color: B.muted }}>Nenhum SKU no filtro/busca.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
