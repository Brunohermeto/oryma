'use client'

/**
 * Planejamento de Importação — Etapa 1.
 * Abas: Ruptura (projeção de estoque) · Pedidos (linha do tempo viva +
 * pagamentos) · Perfis (prazos e parcelas padrão por produto).
 * As datas são recalculadas em cascata pelo motor (lib/import-planning/engine).
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ship, Plus, Pencil, Trash2, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  resolvePlanDates, resolvePagamentos, STATUS_COLORS,
  type ImportPlan, type ImportProfile, type Parcela,
} from '@/lib/import-planning/engine'

export interface RupturaRow {
  sku: string; name: string; stock: number; velocityDay: number
  diasAteRuptura: number; dataRuptura: string
  proximaChegada: { date: string; qty: number; invoice: string } | null
  gapDias: number | null
  pedidoSemItens: { invoice: string; date: string } | null
}
export interface ProductOption { id: string; sku: string; name: string }
interface PlanItem { id?: string; plan_id?: string; product_id: string | null; sku: string; quantity: number }

const B = {
  border: 'oklch(0.88 0.016 258)', bgSubtle: 'oklch(0.97 0.008 258)',
  text: '#0B1023', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF',
}
const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtD = (d: string | null | undefined) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '—'

function parseParcelas(txt: string): Parcela[] {
  // "20% D0 · 80% D1+90" → [{pct:.2,ancora:'D0',offset:0},{pct:.8,ancora:'D1',offset:90}]
  const out: Parcela[] = []
  for (const part of txt.split(/[·;,]+/)) {
    const m = part.trim().match(/^(\d+(?:[.,]\d+)?)\s*%\s*(D0|D1|D2|DG)\s*(?:\+\s*(\d+)\s*d?(?:ias)?)?$/i)
    if (m) out.push({ pct: Number(m[1].replace(',', '.')) / 100, ancora: m[2].toUpperCase() as Parcela['ancora'], offset: Number(m[3] ?? 0) })
  }
  return out
}
const parcelasToText = (ps: Parcela[] | null | undefined) =>
  (ps ?? []).map(p => `${Math.round(p.pct * 100)}% ${p.ancora}${p.offset ? `+${p.offset}` : ''}`).join(' · ')

export function PlanejamentoView({ profiles, plans, items, ruptura, products, hoje }: {
  profiles: ImportProfile[]
  plans: (ImportPlan & { id: string })[]
  items: PlanItem[]
  ruptura: RupturaRow[]
  products: ProductOption[]
  hoje: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'ruptura' | 'pedidos' | 'caixa' | 'perfis'>(ruptura.some(r => (r.gapDias ?? 1) < 0 || (!r.proximaChegada && r.diasAteRuptura < 60)) ? 'ruptura' : 'pedidos')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const profById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/import-planning', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'falhou')
      setMsg('✓ salvo')
      router.refresh()
      return true
    } catch (e) { setMsg(`Erro: ${String(e).replace('Error: ', '')}`); return false }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {([['ruptura', 'Projeção de ruptura'], ['pedidos', `Pedidos (${plans.filter(p => !p.done).length} em curso)`], ['caixa', 'Fluxo de caixa'], ['perfis', `Perfis de produto (${profiles.length})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-full cursor-pointer"
            style={{ background: tab === k ? B.brand : 'white', color: tab === k ? 'white' : B.muted, border: `1px solid ${tab === k ? B.brand : B.border}` }}>
            {label}
          </button>
        ))}
        {busy && <RefreshCw size={13} className="animate-spin" style={{ color: B.muted }} />}
        {msg && <span className="text-[12px]" style={{ color: msg.startsWith('Erro') ? '#dc2626' : '#16a34a' }}>{msg}</span>}
      </div>

      {tab === 'ruptura' && <RupturaPanel rows={ruptura} hoje={hoje} />}
      {tab === 'pedidos' && <PedidosPanel plans={plans} items={items} profiles={profiles} profById={profById} products={products} hoje={hoje} onSave={post} />}
      {tab === 'caixa' && <CaixaPanel plans={plans} profById={profById} hoje={hoje} />}
      {tab === 'perfis' && <PerfisPanel profiles={profiles} onSave={post} />}
    </div>
  )
}

/* ── Ruptura ─────────────────────────────────────────────────────────── */
function RupturaPanel({ rows, hoje }: { rows: RupturaRow[]; hoje: string }) {
  // Simulador: velocidade editável por produto — recalcula a linha na hora.
  // Só na tela (recarregar volta à velocidade real).
  const [velSim, setVelSim] = useState<Record<string, number>>({})
  const addDays = (iso: string, days: number) => {
    const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  const temSim = Object.keys(velSim).length > 0
  return (
    <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-[12px]" style={{ color: B.muted }}>
          Estoque real (galpão + Full) ÷ velocidade de venda → data prevista de ruptura, contra a próxima chegada.
          A <b>Vel/dia é editável</b> — digite outro valor para simular cenários.
        </span>
        {temSim && (
          <button onClick={() => setVelSim({})} className="text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer"
                  style={{ background: 'oklch(0.96 0.08 70)', color: '#92400e', border: 'none' }}>
            simulação ativa — restaurar velocidade real
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${B.border}` }}>
              {['Produto', 'Estoque', 'Vel/dia (editável)', 'Rompe em', 'Data ruptura', 'Próxima chegada', 'Situação'].map((h, i) => (
                <th key={h} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: B.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r0 => {
              const vel = velSim[r0.sku] ?? r0.velocityDay
              const simulado = velSim[r0.sku] !== undefined && Math.abs(vel - r0.velocityDay) > 0.001
              const dias = vel > 0 ? Math.floor(r0.stock / vel) : 9999
              const dataRuptura = addDays(hoje, dias)
              const gap = r0.proximaChegada
                ? Math.round((new Date(r0.proximaChegada.date).getTime() - new Date(dataRuptura).getTime()) / 86400000)
                : null
              const r = { ...r0, velocityDay: vel, diasAteRuptura: dias, dataRuptura, gapDias: gap }
              const semCobertura = !r.proximaChegada
              const furo = r.gapDias !== null && r.gapDias > 0
              const cor = semCobertura && r.diasAteRuptura < 90 ? '#dc2626' : furo ? '#dc2626' : '#16a34a'
              return (
                <tr key={r.sku} style={{ borderBottom: `1px solid ${B.bgSubtle}`, background: simulado ? 'oklch(0.98 0.03 70)' : undefined }}>
                  <td className="px-3 py-2">
                    <div className="text-[13px] font-medium" style={{ color: B.text }}>{r.sku}</div>
                    <div className="text-[11px] truncate max-w-[240px]" style={{ color: B.muted }}>{r.name}</div>
                  </td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: 'var(--font-geist-mono)' }}>{r.stock}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number" step="0.1" min="0"
                      value={velSim[r.sku] ?? r0.velocityDay}
                      onChange={e => setVelSim({ ...velSim, [r.sku]: Number(e.target.value) })}
                      className="w-16 text-right text-[13px] px-1.5 py-0.5 rounded-md outline-none"
                      style={{
                        border: `1px solid ${simulado ? '#d97706' : B.border}`,
                        color: simulado ? '#92400e' : B.text,
                        fontFamily: 'var(--font-geist-mono)',
                        background: 'white',
                      }}
                    />
                    {simulado && <div className="text-[10px]" style={{ color: B.muted }}>real: {r0.velocityDay.toFixed(1)}</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ color: r.diasAteRuptura < 30 ? '#dc2626' : r.diasAteRuptura < 60 ? '#d97706' : B.text, fontFamily: 'var(--font-geist-mono)' }}>
                    {r.diasAteRuptura >= 9999 ? '—' : `${r.diasAteRuptura}d`}
                  </td>
                  <td className="px-3 py-2 text-right text-[12px]" style={{ color: B.muted }}>{r.diasAteRuptura >= 9999 ? '—' : fmtD(r.dataRuptura)}</td>
                  <td className="px-3 py-2 text-right text-[12px]" style={{ color: B.muted }}>
                    {r.proximaChegada
                      ? `${fmtD(r.proximaChegada.date)} (+${r.proximaChegada.qty} un · ${r.proximaChegada.invoice})`
                      : r.pedidoSemItens
                        ? <span style={{ color: '#d97706' }}>pedido {r.pedidoSemItens.invoice} em curso (chega ~{fmtD(r.pedidoSemItens.date)}) — preencher itens</span>
                        : 'nenhuma programada'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: cor, background: cor === '#dc2626' ? 'oklch(0.96 0.04 25)' : 'oklch(0.95 0.06 145)' }}>
                      {semCobertura
                        ? (r.pedidoSemItens ? 'preencher itens' : r.diasAteRuptura < 90 ? 'PEDIR AGORA' : 'sem pedido')
                        : furo ? `FURO de ${r.gapDias}d` : 'coberto'}
                    </span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-[13px]" style={{ color: B.muted }}>Sem produtos com giro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Pedidos ─────────────────────────────────────────────────────────── */
function PedidosPanel({ plans, items, profiles, profById, products, hoje, onSave }: {
  plans: (ImportPlan & { id: string })[]
  items: PlanItem[]
  profiles: ImportProfile[]
  profById: Map<string, ImportProfile>
  products: ProductOption[]
  hoje: string
  onSave: (p: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<Partial<ImportPlan & { id?: string }> | null>(null)
  const [editItems, setEditItems] = useState<PlanItem[]>([])
  const [parcelasTxt, setParcelasTxt] = useState('')
  const [showDone, setShowDone] = useState(false)

  function openNew() {
    setEditing({ containers: 1, order_date: hoje, valor_fornecedor: 0, valor_imposto_frete: 0, done: false })
    setEditItems([]); setParcelasTxt('')
  }
  function openEdit(pl: ImportPlan & { id: string }) {
    setEditing({ ...pl })
    setEditItems(items.filter(i => i.plan_id === pl.id).map(i => ({ ...i })))
    setParcelasTxt(parcelasToText(pl.parcelas))
  }
  async function save() {
    if (!editing) return
    const ok = await onSave({
      action: 'save_plan',
      plan: { ...editing, parcelas: parcelasTxt.trim() ? parseParcelas(parcelasTxt) : null },
      items: editItems,
    })
    if (ok) setEditing(null)
  }

  const visiveis = plans.filter(p => showDone || !p.done)

  // Ação rápida: marcar data real (embarque/galpão) — preserva os itens atuais
  async function marcarData(pl: ImportPlan & { id: string }, campo: 'embarque_real' | 'santos_real' | 'galpao_real', label: string) {
    const data = window.prompt(`${label} — confirme a data (AAAA-MM-DD):`, hoje)
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return
    await onSave({
      action: 'save_plan',
      plan: { ...pl, [campo]: data },
      items: items.filter(i => i.plan_id === pl.id),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={openNew} className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer" style={{ background: B.brand, color: 'white', border: 'none' }}>
          <Plus size={13} /> Novo pedido
        </button>
        <label className="text-[12px] flex items-center gap-1.5" style={{ color: B.muted }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> mostrar concluídos
        </label>
      </div>

      {editing && (
        <div className="bg-white rounded-2xl p-5 space-y-3" style={{ border: `2px solid ${B.brand}` }}>
          <div className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            {editing.id ? `Editar pedido ${editing.invoice}` : 'Novo pedido'}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Campo label="Invoice"><input className="inp" value={editing.invoice ?? ''} onChange={e => setEditing({ ...editing, invoice: e.target.value })} /></Campo>
            <Campo label="Produto (perfil)">
              <select className="inp" value={editing.profile_id ?? ''} onChange={e => setEditing({ ...editing, profile_id: e.target.value })}>
                <option value="">selecione…</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.root_sku} — {p.name}</option>)}
              </select>
            </Campo>
            <Campo label="Containers"><input className="inp" type="number" value={editing.containers ?? 1} onChange={e => setEditing({ ...editing, containers: Number(e.target.value) })} /></Campo>
            <Campo label="Data do pedido (D0)"><input className="inp" type="date" value={editing.order_date ?? ''} onChange={e => setEditing({ ...editing, order_date: e.target.value })} /></Campo>
            <Campo label="Valor fornecedor (R$)"><input className="inp" type="number" step="0.01" value={editing.valor_fornecedor ?? 0} onChange={e => setEditing({ ...editing, valor_fornecedor: Number(e.target.value) })} /></Campo>
            <Campo label="Impostos + frete (R$)"><input className="inp" type="number" step="0.01" value={editing.valor_imposto_frete ?? 0} onChange={e => setEditing({ ...editing, valor_imposto_frete: Number(e.target.value) })} /></Campo>
            <Campo label="Embarque REAL (se houver)"><input className="inp" type="date" value={editing.embarque_real ?? ''} onChange={e => setEditing({ ...editing, embarque_real: e.target.value || null })} /></Campo>
            <Campo label="Chegada galpão REAL"><input className="inp" type="date" value={editing.galpao_real ?? ''} onChange={e => setEditing({ ...editing, galpao_real: e.target.value || null })} /></Campo>
          </div>
          <Campo label={`Parcelas deste pedido (vazio = herda do perfil${editing.profile_id ? `: ${parcelasToText(profById.get(editing.profile_id!)?.parcelas)}` : ''}) — formato: 20% D0 · 80% D1+90`}>
            <input className="inp w-full" value={parcelasTxt} onChange={e => setParcelasTxt(e.target.value)} placeholder="ex: 25% D0 · 25% D1 · 25% D2+30 · 25% D2+60" />
          </Campo>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: B.muted }}>Itens (SKUs e quantidades)</div>
            {editItems.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-1.5">
                <select className="inp flex-1" value={it.product_id ?? ''} onChange={e => {
                  const prod = products.find(p => p.id === e.target.value)
                  const next = [...editItems]; next[idx] = { ...it, product_id: prod?.id ?? null, sku: prod?.sku ?? it.sku }
                  setEditItems(next)
                }}>
                  <option value="">SKU livre…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name.slice(0, 40)}</option>)}
                </select>
                <input className="inp w-24" placeholder="SKU" value={it.sku} onChange={e => { const n = [...editItems]; n[idx] = { ...it, sku: e.target.value }; setEditItems(n) }} />
                <input className="inp w-24" type="number" placeholder="qtd" value={it.quantity || ''} onChange={e => { const n = [...editItems]; n[idx] = { ...it, quantity: Number(e.target.value) }; setEditItems(n) }} />
                <button onClick={() => setEditItems(editItems.filter((_, i) => i !== idx))} className="p-1 cursor-pointer" style={{ border: 'none', background: 'transparent' }}><Trash2 size={13} style={{ color: '#dc2626' }} /></button>
              </div>
            ))}
            <button onClick={() => setEditItems([...editItems, { product_id: null, sku: '', quantity: 0 }])} className="text-[12px] font-medium cursor-pointer" style={{ color: B.brand, border: 'none', background: 'transparent' }}>+ adicionar item</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} className="text-[12px] font-semibold px-4 py-2 rounded-lg cursor-pointer" style={{ background: B.brand, color: 'white', border: 'none' }}>Salvar pedido</button>
            <button onClick={() => setEditing(null)} className="text-[12px] px-4 py-2 rounded-lg cursor-pointer" style={{ background: 'white', color: B.muted, border: `1px solid ${B.border}` }}>Cancelar</button>
            {editing.id && (
              <label className="text-[12px] flex items-center gap-1.5 ml-auto" style={{ color: B.muted }}>
                <input type="checkbox" checked={!!editing.done} onChange={e => setEditing({ ...editing, done: e.target.checked })} /> pedido concluído
              </label>
            )}
          </div>
        </div>
      )}

      {visiveis.map(pl => {
        const prof = profById.get(pl.profile_id ?? '')
        if (!prof) return null
        const dates = resolvePlanDates(pl, prof, hoje)
        const pags = resolvePagamentos(pl, prof, dates)
        const aPagar = pags.filter(p => p.date >= hoje).reduce((s, p) => s + p.amount, 0)
        const sc = STATUS_COLORS[dates.status] ?? { bg: B.bgSubtle, color: B.muted }
        const planItems = items.filter(i => i.plan_id === pl.id)
        return (
          <div key={pl.id} className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${B.border}`, opacity: pl.done ? 0.6 : 1 }}>
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <Ship size={15} style={{ color: B.brand }} />
              <span className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
                {pl.invoice} · {prof.root_sku} · {pl.containers} container{pl.containers > 1 ? 's' : ''}
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>{dates.status}</span>
              {aPagar > 0 && !pl.done && (
                <span className="text-[12px] font-semibold" style={{ color: '#d97706' }}>a pagar: {fmtR(aPagar)}</span>
              )}
              {planItems.length === 0 && !pl.done && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'oklch(0.96 0.08 70)', color: '#92400e' }}>
                  itens não preenchidos
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {!pl.embarque_real && !pl.done && (
                  <button onClick={() => marcarData(pl, 'embarque_real', `Embarque do pedido ${pl.invoice}`)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg cursor-pointer"
                    style={{ background: 'white', color: '#0097b2', border: '1px dashed #0097b2' }}>
                    registrar embarque…
                  </button>
                )}
                {!pl.santos_real && !pl.done && (
                  <button onClick={() => marcarData(pl, 'santos_real', `Chegada no PORTO (Santos) do pedido ${pl.invoice} — libera o pagamento de impostos/frete sobre a carga`)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg cursor-pointer"
                    style={{ background: 'white', color: '#7B61FF', border: '1px dashed #7B61FF' }}>
                    registrar chegada no porto…
                  </button>
                )}
                {!pl.galpao_real && !pl.done && (
                  <button onClick={() => marcarData(pl, 'galpao_real', `Chegada no GALPÃO do pedido ${pl.invoice} — estoque disponível`)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg cursor-pointer"
                    style={{ background: 'white', color: '#15803d', border: '1px dashed #15803d' }}>
                    registrar chegada no galpão…
                  </button>
                )}
                <button onClick={() => openEdit(pl)} className="p-1.5 rounded-lg cursor-pointer" style={{ background: B.bgSubtle, border: 'none' }}>
                  <Pencil size={13} style={{ color: B.brand }} />
                </button>
              </div>
            </div>
            {/* Linha do tempo */}
            <div className="flex items-center gap-1 flex-wrap text-[12px] mb-2" style={{ color: B.muted }}>
              {[['Pedido', dates.d0, true], ['Fim produção', dates.fimProducao, hoje >= dates.fimProducao], ['Embarque', dates.d1, hoje >= dates.d1], ['Santos', dates.d2, hoje >= dates.d2], ['Galpão', dates.dg, hoje >= dates.dg]].map(([label, d, past], i) => (
                <span key={label as string} className="flex items-center gap-1">
                  {i > 0 && <span style={{ color: 'oklch(0.80 0.01 258)' }}>→</span>}
                  <span className="px-2 py-0.5 rounded-md" style={{ background: past ? 'oklch(0.94 0.10 145)' : B.bgSubtle, color: past ? '#15803d' : B.muted }}>
                    {label as string} {fmtD(d as string)}
                  </span>
                </span>
              ))}
            </div>
            {/* Pagamentos + itens */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]" style={{ color: B.muted }}>
              {pags.map((p, i) => (
                <span key={i} style={{ color: p.date < hoje ? 'oklch(0.65 0.02 258)' : B.text }}>
                  {p.date < hoje ? '✓' : '○'} {fmtD(p.date)} · {fmtR(p.amount)} <span style={{ color: B.muted }}>({p.label.replace('Parcela ', 'P')})</span>
                </span>
              ))}
            </div>
            {planItems.length > 0 && (
              <div className="text-[12px] mt-2" style={{ color: B.muted }}>
                Itens: {planItems.map(i => `${i.sku} ×${i.quantity}`).join(' · ')}
              </div>
            )}
          </div>
        )
      })}
      {visiveis.length === 0 && !editing && (
        <div className="bg-white rounded-2xl p-8 text-center text-[13px]" style={{ border: `1px solid ${B.border}`, color: B.muted }}>
          Nenhum pedido ainda. Cadastre os perfis de produto e clique em "Novo pedido".
        </div>
      )}
      <style>{`.inp{border:1px solid ${B.border};border-radius:8px;padding:6px 8px;font-size:13px;color:${B.text};background:white;outline:none}`}</style>
    </div>
  )
}

/* ── Fluxo de caixa (Etapa 2): desencaixe mensal consolidado ─────────── */
function CaixaPanel({ plans, profById, hoje }: {
  plans: (ImportPlan & { id: string })[]
  profById: Map<string, ImportProfile>
  hoje: string
}) {
  // Todos os pagamentos dos pedidos não concluídos, resolvidos em datas
  const lancamentos: Array<{ invoice: string; label: string; date: string; amount: number; pago: boolean }> = []
  for (const pl of plans) {
    if (pl.done) continue
    const prof = profById.get(pl.profile_id ?? '')
    if (!prof) continue
    const dates = resolvePlanDates(pl, prof, hoje)
    for (const p of resolvePagamentos(pl, prof, dates)) {
      lancamentos.push({ invoice: pl.invoice, label: p.label, date: p.date, amount: p.amount, pago: p.date < hoje })
    }
  }
  const aVencer = lancamentos.filter(l => !l.pago)
  const totalAberto = aVencer.reduce((s, l) => s + l.amount, 0)

  // Agrupa por mês (passado em aberto entra como "vencido")
  const byMonth = new Map<string, typeof lancamentos>()
  for (const l of aVencer) {
    const m = l.date.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m)!.push(l)
  }
  const meses = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const fmtMes = (m: string) => {
    const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
    return `${nomes[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`
  }
  const maxMes = Math.max(...meses.map(([, ls]) => ls.reduce((s, l) => s + l.amount, 0)), 1)

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${B.border}` }}>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <span className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Desencaixe das importações em curso
          </span>
          <span className="text-[13px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'oklch(0.96 0.04 25)', color: '#dc2626' }}>
            total em aberto: {fmtR(totalAberto)}
          </span>
        </div>
        <div className="text-[12px] mb-4" style={{ color: B.muted }}>
          Parcelas e impostos de todos os pedidos não concluídos, nas datas resolvidas pela linha do tempo
          (parcela com data passada é considerada paga e sai daqui). Mudou uma data no pedido → o caixa move junto.
        </div>
        <div className="space-y-2">
          {meses.map(([mes, ls]) => {
            const total = ls.reduce((s, l) => s + l.amount, 0)
            const vencido = mes < hoje.slice(0, 7)
            return (
              <details key={mes} className="rounded-lg" style={{ background: B.bgSubtle }}>
                <summary className="cursor-pointer select-none flex items-center gap-3 px-3 py-2.5">
                  <span className="w-20 text-[13px] font-bold" style={{ color: vencido ? '#dc2626' : B.text }}>
                    {vencido ? `${fmtMes(mes)} ⚠` : fmtMes(mes)}
                  </span>
                  <div className="flex-1 h-3.5 rounded-full overflow-hidden" style={{ background: 'white' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max((total / maxMes) * 100, 2)}%`, background: vencido ? '#dc2626' : 'linear-gradient(90deg, #125BFF, #7B61FF)' }} />
                  </div>
                  <span className="w-32 text-right text-[13px] font-bold" style={{ color: vencido ? '#dc2626' : B.text, fontFamily: 'var(--font-geist-mono)' }}>
                    {fmtR(total)}
                  </span>
                  <span className="text-[11px]" style={{ color: B.muted }}>{ls.length} parcela{ls.length > 1 ? 's' : ''}</span>
                </summary>
                <div className="px-3 pb-3 space-y-1">
                  {ls.sort((a, b) => (a.date < b.date ? -1 : 1)).map((l, i) => (
                    <div key={i} className="flex items-center gap-3 text-[12px] bg-white rounded-md px-2.5 py-1.5">
                      <span className="w-16" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>{fmtD(l.date)}</span>
                      <span className="font-medium" style={{ color: B.text }}>{l.invoice}</span>
                      <span style={{ color: B.muted }}>{l.label}</span>
                      <span className="ml-auto font-semibold" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{fmtR(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )
          })}
          {meses.length === 0 && (
            <div className="text-[13px] py-4 text-center" style={{ color: B.muted }}>
              Nenhum pagamento em aberto nos pedidos em curso.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Perfis ──────────────────────────────────────────────────────────── */
function PerfisPanel({ profiles, onSave }: { profiles: ImportProfile[]; onSave: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState<Partial<ImportProfile> | null>(null)
  const [parcelasTxt, setParcelasTxt] = useState('')

  function openEdit(p?: ImportProfile) {
    setEditing(p ? { ...p } : { dias_producao: 45, dias_embarque: 60, dias_santos: 100, dias_galpao: 125, imposto_frete_ancora: 'D2' })
    setParcelasTxt(p ? parcelasToText(p.parcelas) : '20% D0 · 80% D1+90')
  }
  async function save() {
    if (!editing) return
    const parcelas = parseParcelas(parcelasTxt)
    const soma = parcelas.reduce((s, p) => s + p.pct, 0)
    if (parcelas.length && Math.abs(soma - 1) > 0.01) {
      alert(`As parcelas somam ${(soma * 100).toFixed(0)}% — devem somar 100%.`)
      return
    }
    const ok = await onSave({ action: 'save_profile', profile: { ...editing, parcelas } })
    if (ok) setEditing(null)
  }

  return (
    <div className="space-y-3">
      <button onClick={() => openEdit()} className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer" style={{ background: B.brand, color: 'white', border: 'none' }}>
        <Plus size={13} /> Novo perfil de produto
      </button>

      {editing && (
        <div className="bg-white rounded-2xl p-5 space-y-3" style={{ border: `2px solid ${B.brand}` }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Campo label="SKU raiz"><input className="inp" value={editing.root_sku ?? ''} onChange={e => setEditing({ ...editing, root_sku: e.target.value })} /></Campo>
            <Campo label="Nome do produto"><input className="inp" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Campo>
            <Campo label="Dias até fim de produção"><input className="inp" type="number" value={editing.dias_producao ?? 45} onChange={e => setEditing({ ...editing, dias_producao: Number(e.target.value) })} /></Campo>
            <Campo label="Dias até embarque (D1)"><input className="inp" type="number" value={editing.dias_embarque ?? 60} onChange={e => setEditing({ ...editing, dias_embarque: Number(e.target.value) })} /></Campo>
            <Campo label="Dias até Santos (D2)"><input className="inp" type="number" value={editing.dias_santos ?? 100} onChange={e => setEditing({ ...editing, dias_santos: Number(e.target.value) })} /></Campo>
            <Campo label="Dias até galpão (DG)"><input className="inp" type="number" value={editing.dias_galpao ?? 125} onChange={e => setEditing({ ...editing, dias_galpao: Number(e.target.value) })} /></Campo>
            <Campo label="Impostos+frete pagos em">
              <select className="inp" value={editing.imposto_frete_ancora ?? 'D2'} onChange={e => setEditing({ ...editing, imposto_frete_ancora: e.target.value as any })}>
                {['D0', 'D1', 'D2', 'DG'].map(a => <option key={a}>{a}</option>)}
              </select>
            </Campo>
          </div>
          <Campo label="Regra de parcelas — formato: 20% D0 · 80% D1+90 (âncoras: D0 pedido, D1 embarque, D2 Santos, DG galpão)">
            <input className="inp w-full" value={parcelasTxt} onChange={e => setParcelasTxt(e.target.value)} />
          </Campo>
          <div className="flex gap-2">
            <button onClick={save} className="text-[12px] font-semibold px-4 py-2 rounded-lg cursor-pointer" style={{ background: B.brand, color: 'white', border: 'none' }}>Salvar perfil</button>
            <button onClick={() => setEditing(null)} className="text-[12px] px-4 py-2 rounded-lg cursor-pointer" style={{ background: 'white', color: B.muted, border: `1px solid ${B.border}` }}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${B.border}` }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${B.border}` }}>
              {['SKU raiz', 'Produto', 'Produção', 'Embarque', 'Santos', 'Galpão', 'Parcelas', ''].map((h, i) => (
                <th key={h + i} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${i < 2 ? 'text-left' : 'text-right'}`} style={{ color: B.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => (
              <tr key={p.id} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-3 py-2 text-[13px] font-semibold" style={{ color: B.text }}>{p.root_sku}</td>
                <td className="px-3 py-2 text-[12px]" style={{ color: B.muted }}>{p.name}</td>
                <td className="px-3 py-2 text-right text-[12px]" style={{ fontFamily: 'var(--font-geist-mono)' }}>{p.dias_producao}d</td>
                <td className="px-3 py-2 text-right text-[12px]" style={{ fontFamily: 'var(--font-geist-mono)' }}>{p.dias_embarque}d</td>
                <td className="px-3 py-2 text-right text-[12px]" style={{ fontFamily: 'var(--font-geist-mono)' }}>{p.dias_santos}d</td>
                <td className="px-3 py-2 text-right text-[12px]" style={{ fontFamily: 'var(--font-geist-mono)' }}>{p.dias_galpao}d</td>
                <td className="px-3 py-2 text-right text-[12px]" style={{ color: B.muted }}>{parcelasToText(p.parcelas) || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg cursor-pointer" style={{ background: B.bgSubtle, border: 'none' }}>
                    <Pencil size={13} style={{ color: B.brand }} />
                  </button>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-[13px]" style={{ color: B.muted }}>Nenhum perfil cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <style>{`.inp{border:1px solid ${B.border};border-radius:8px;padding:6px 8px;font-size:13px;color:${B.text};background:white;outline:none}`}</style>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium" style={{ color: B.muted }}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}
