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
import { FluxoGeralMatriz, type FluxoGeralData } from './FluxoGeralMatriz'
import {
  resolvePlanDates, resolvePagamentos, STATUS_COLORS,
  type ImportPlan, type ImportProfile, type Parcela, type PagamentoExtra, type PagamentoReal,
} from '@/lib/import-planning/engine'

export interface RupturaRow {
  sku: string; name: string; stock: number; velocityDay: number
  diasAteRuptura: number; dataRuptura: string
  proximaChegada: { date: string; qty: number; invoice: string } | null
  gapDias: number | null
  pedidoSemItens: { invoice: string; date: string } | null
}
export interface ProductOption { id: string; sku: string; name: string }
export interface ProjecaoMes { mes: string; receita: number; lucro: number }
export interface EstoqueTempoRow { sku: string; name: string; vel: number; meses: Record<string, number> }
interface PlanItem { id?: string; plan_id?: string; product_id: string | null; sku: string; quantity: number; custo_total?: number }

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

export function PlanejamentoView({ profiles, plans, items, ruptura, products, projecao, estoqueTempo, fluxoGeral, hoje }: {
  profiles: ImportProfile[]
  plans: (ImportPlan & { id: string })[]
  items: PlanItem[]
  ruptura: RupturaRow[]
  products: ProductOption[]
  projecao: ProjecaoMes[]
  estoqueTempo: EstoqueTempoRow[]
  fluxoGeral: FluxoGeralData
  hoje: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'ruptura' | 'pedidos' | 'caixa' | 'perfis'>('caixa')
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
        {([['caixa', 'Visão geral'], ['ruptura', 'Projeção de ruptura'], ['pedidos', `Pedidos (${plans.filter(p => !p.done).length} em curso)`], ['perfis', `Perfis de produto (${profiles.length})`]] as const).map(([k, label]) => (
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
      {tab === 'caixa' && <CaixaPanel plans={plans} profById={profById} fluxoGeral={fluxoGeral} hoje={hoje} />}
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
  const [editExtras, setEditExtras] = useState<PagamentoExtra[]>([])
  const [editPagos, setEditPagos] = useState<Record<string, { valor?: number; data?: string }>>({})
  const [parcelasTxt, setParcelasTxt] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [filtroRoot, setFiltroRoot] = useState('')     // filtro por família de produto (root_sku)
  const [filtroStatus, setFiltroStatus] = useState('') // filtro por status da linha do tempo

  function openNew() {
    setEditing({ containers: 1, order_date: hoje, valor_fornecedor: 0, valor_imposto_frete: 0, done: false })
    setEditItems([]); setEditExtras([]); setEditPagos({}); setParcelasTxt('')
  }
  function openEdit(pl: ImportPlan & { id: string }) {
    setEditing({ ...pl })
    setEditItems(items.filter(i => i.plan_id === pl.id).map(i => ({ ...i })))
    setEditExtras((pl.extras ?? []).map(e => ({ ...e })))
    setEditPagos(Object.fromEntries((pl.pagamentos_reais ?? []).map(r => [r.label, { valor: r.valor, data: r.data }])))
    setParcelasTxt(parcelasToText(pl.parcelas))
  }
  async function save() {
    if (!editing) return
    const itensValidos = editItems.filter(i => i.sku && Number(i.quantity) > 0)
    if (!itensValidos.length) {
      const seguir = window.confirm(
        'Este pedido está SEM itens (SKU + quantidade que vai chegar).\n' +
        'Sem eles, a chegada não alimenta a projeção de estoque nem a ruptura.\n\nSalvar assim mesmo?'
      )
      if (!seguir) return
    }
    const pagosArr: PagamentoReal[] = Object.entries(editPagos)
      .filter(([, v]) => Number(v.valor) > 0)
      .map(([label, v]) => ({ label, valor: Number(v.valor), data: v.data || undefined }))
    const ok = await onSave({
      action: 'save_plan',
      plan: { ...editing, parcelas: parcelasTxt.trim() ? parseParcelas(parcelasTxt) : null, extras: editExtras, pagamentos_reais: pagosArr },
      items: editItems,
    })
    if (ok) setEditing(null)
  }

  // Lista com filtros (família de produto + status) e ordenada por DATA DO PEDIDO
  const rootsDisponiveis = [...new Set(plans.map(p => profById.get(p.profile_id ?? '')?.root_sku).filter(Boolean))].sort() as string[]
  const statusDe = (pl: ImportPlan & { id: string }) => {
    const prof = profById.get(pl.profile_id ?? '')
    return prof ? resolvePlanDates(pl, prof, hoje).status : ''
  }
  const statusDisponiveis = [...new Set(plans.map(statusDe).filter(Boolean))]
  const visiveis = plans
    .filter(p => showDone || !p.done)
    .filter(p => !filtroRoot || profById.get(p.profile_id ?? '')?.root_sku === filtroRoot)
    .filter(p => !filtroStatus || statusDe(p) === filtroStatus)
    .sort((a, b) => (a.order_date < b.order_date ? -1 : a.order_date > b.order_date ? 1 : 0)) // data do pedido (antiga → recente)

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
        <select className="inp" value={filtroRoot} onChange={e => setFiltroRoot(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">Todos os produtos</option>
          {rootsDisponiveis.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="inp" value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={{ minWidth: 150 }}>
          <option value="">Todos os status</option>
          {statusDisponiveis.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(filtroRoot || filtroStatus) && (
          <button onClick={() => { setFiltroRoot(''); setFiltroStatus('') }} className="text-[11px] cursor-pointer" style={{ color: B.brand, border: 'none', background: 'transparent' }}>
            limpar filtros
          </button>
        )}
        <span className="text-[11px]" style={{ color: B.muted }}>{visiveis.length} pedido{visiveis.length !== 1 ? 's' : ''}</span>
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
            <Campo label="Situação do pedido">
              <select className="inp" value={editing.compromissado === false ? 'previsto' : 'compromissado'}
                      onChange={e => setEditing({ ...editing, compromissado: e.target.value === 'compromissado' })}>
                <option value="compromissado">Compromissado (fechado)</option>
                <option value="previsto">Previsto (em estudo)</option>
              </select>
            </Campo>
            <Campo label="Valor fornecedor (R$)"><input className="inp" type="number" step="0.01" value={editing.valor_fornecedor ?? 0} onChange={e => setEditing({ ...editing, valor_fornecedor: Number(e.target.value) })} /></Campo>
            <Campo label="Impostos + frete (R$)"><input className="inp" type="number" step="0.01" value={editing.valor_imposto_frete ?? 0} onChange={e => setEditing({ ...editing, valor_imposto_frete: Number(e.target.value) })} /></Campo>
            <Campo label="Valor JÁ PAGO (R$) — efetivo"><input className="inp" type="number" step="0.01" value={editing.valor_pago ?? 0} onChange={e => setEditing({ ...editing, valor_pago: Number(e.target.value) })} /></Campo>
            <Campo label="Embarque REAL (se houver)"><input className="inp" type="date" value={editing.embarque_real ?? ''} onChange={e => setEditing({ ...editing, embarque_real: e.target.value || null })} /></Campo>
            <Campo label="Chegada galpão REAL"><input className="inp" type="date" value={editing.galpao_real ?? ''} onChange={e => setEditing({ ...editing, galpao_real: e.target.value || null })} /></Campo>
          </div>
          <Campo label={`Parcelas deste pedido (vazio = herda do perfil${editing.profile_id ? `: ${parcelasToText(profById.get(editing.profile_id!)?.parcelas)}` : ''}) — formato: 20% D0 · 80% D1+90`}>
            <input className="inp w-full" value={parcelasTxt} onChange={e => setParcelasTxt(e.target.value)} placeholder="ex: 25% D0 · 25% D1 · 25% D2+30 · 25% D2+60" />
          </Campo>
          {/* Pagamentos: previsto × efetivamente pago, por parcela */}
          {editing.profile_id && profById.get(editing.profile_id) && (() => {
            const prof = profById.get(editing.profile_id!)!
            const planPreview = {
              ...editing,
              order_date: editing.order_date ?? hoje,
              parcelas: parcelasTxt.trim() ? parseParcelas(parcelasTxt) : null,
              extras: editExtras,
              valor_fornecedor: Number(editing.valor_fornecedor ?? 0),
              valor_imposto_frete: Number(editing.valor_imposto_frete ?? 0),
            } as ImportPlan
            const dates = resolvePlanDates(planPreview, prof, hoje)
            const pags = resolvePagamentos(planPreview, prof, dates)
            if (!pags.length) return null
            return (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: B.muted }}>
                  Pagamentos — previsto × efetivamente PAGO (preencha ao pagar cada parcela)
                </div>
                <table className="text-[12px]" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${B.border}` }}>
                      {['Parcela', 'Vencimento', 'Previsto R$', 'PAGO R$', 'Data do pagamento'].map(h => (
                        <th key={h} className="px-2 py-1 text-left text-[10px] font-semibold uppercase" style={{ color: B.muted }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pags.map(p => (
                      <tr key={p.label} style={{ borderBottom: `1px solid oklch(0.97 0.008 258)` }}>
                        <td className="px-2 py-1" style={{ color: B.text }}>{p.label}</td>
                        <td className="px-2 py-1" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>{fmtD(p.date)}</td>
                        <td className="px-2 py-1 text-right" style={{ fontFamily: 'var(--font-geist-mono)' }}>{fmtR(p.amount)}</td>
                        <td className="px-1 py-0.5">
                          <input className="inp w-28" type="number" step="0.01" placeholder="—"
                            value={editPagos[p.label]?.valor ?? ''}
                            onChange={e => setEditPagos(prev => ({ ...prev, [p.label]: { ...prev[p.label], valor: e.target.value === '' ? undefined : Number(e.target.value) } }))} />
                        </td>
                        <td className="px-1 py-0.5">
                          <input className="inp" type="date"
                            value={editPagos[p.label]?.data ?? ''}
                            onChange={e => setEditPagos(prev => ({ ...prev, [p.label]: { ...prev[p.label], data: e.target.value || undefined } }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: B.muted }}>
              Taxas extras da importação (Siscomex, AFRMM, armazenagem, despachante…) — cada uma com sua data
            </div>
            {editExtras.map((ex, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-1.5 flex-wrap">
                <input className="inp flex-1" placeholder="descrição (ex: Taxa Siscomex)" value={ex.label}
                       onChange={e => { const n = [...editExtras]; n[idx] = { ...ex, label: e.target.value }; setEditExtras(n) }} />
                <input className="inp w-28" type="number" step="0.01" placeholder="valor R$" value={ex.valor || ''}
                       onChange={e => { const n = [...editExtras]; n[idx] = { ...ex, valor: Number(e.target.value) }; setEditExtras(n) }} />
                <select className="inp" value={ex.data ? 'data' : (ex.ancora ?? 'D2')}
                        onChange={e => {
                          const n = [...editExtras]
                          n[idx] = e.target.value === 'data'
                            ? { ...ex, ancora: undefined, offset: undefined, data: hoje }
                            : { ...ex, ancora: e.target.value as PagamentoExtra['ancora'], data: undefined }
                          setEditExtras(n)
                        }}>
                  <option value="D0">no pedido (D0)</option>
                  <option value="D1">no embarque (D1)</option>
                  <option value="D2">no porto (D2)</option>
                  <option value="DG">no galpão</option>
                  <option value="data">data fixa</option>
                </select>
                {ex.data !== undefined ? (
                  <input className="inp" type="date" value={ex.data}
                         onChange={e => { const n = [...editExtras]; n[idx] = { ...ex, data: e.target.value }; setEditExtras(n) }} />
                ) : (
                  <input className="inp w-20" type="number" placeholder="+dias" value={ex.offset || ''}
                         onChange={e => { const n = [...editExtras]; n[idx] = { ...ex, offset: Number(e.target.value) }; setEditExtras(n) }} />
                )}
                <button onClick={() => setEditExtras(editExtras.filter((_, i) => i !== idx))} className="p-1 cursor-pointer" style={{ border: 'none', background: 'transparent' }}>
                  <Trash2 size={13} style={{ color: '#dc2626' }} />
                </button>
              </div>
            ))}
            <button onClick={() => setEditExtras([...editExtras, { label: '', valor: 0, ancora: 'D2', offset: 0 }])}
                    className="text-[12px] font-medium cursor-pointer mb-3" style={{ color: B.brand, border: 'none', background: 'transparent' }}>
              + adicionar taxa extra
            </button>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: B.muted }}>Itens (SKUs e quantidades)</div>
              {editItems.some(i => Number(i.quantity) > 0) && (
                <button onClick={() => {
                  const totalImp = Number(editing.valor_fornecedor ?? 0) + Number(editing.valor_imposto_frete ?? 0)
                    + editExtras.reduce((s, e) => s + Number(e.valor ?? 0), 0)
                  const totalQty = editItems.reduce((s, i) => s + Number(i.quantity ?? 0), 0)
                  if (!totalImp || !totalQty) return
                  setEditItems(editItems.map(i => ({
                    ...i, custo_total: Math.round(totalImp * (Number(i.quantity ?? 0) / totalQty) * 100) / 100,
                  })))
                }} className="text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer"
                   style={{ background: 'white', color: B.brand, border: `1px dashed ${B.brand}` }}>
                  calcular custos (ratear importação por unidade)
                </button>
              )}
            </div>
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
                <input className="inp w-32" type="number" step="0.01" placeholder="custo total R$" title="Custo total deste SKU no pedido (alimenta a planilha de custo do estoque)" value={it.custo_total || ''} onChange={e => { const n = [...editItems]; n[idx] = { ...it, custo_total: Number(e.target.value) }; setEditItems(n) }} />
                {Number(it.custo_total) > 0 && Number(it.quantity) > 0 && (
                  <span className="text-[11px] whitespace-nowrap" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                    {(Number(it.custo_total) / Number(it.quantity)).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}/un
                  </span>
                )}
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
        const aPagar = pags.filter(p => !p.pago && p.date >= hoje).reduce((s, p) => s + p.amount, 0)
        const pagoTotal = pags.reduce((s, p) => s + (p.pago ?? 0), 0) + Number(pl.valor_pago ?? 0)
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
              {pl.compromissado === false ? (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'white', color: '#d97706', border: '1.5px dashed #d97706' }}>
                  PREVISTO
                </span>
              ) : (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'oklch(0.94 0.06 258)', color: '#125BFF' }}>
                  compromissado
                </span>
              )}
              {aPagar > 0 && !pl.done && (
                <span className="text-[12px] font-semibold" style={{ color: '#d97706' }}>a pagar: {fmtR(aPagar)}</span>
              )}
              {pagoTotal > 0 && (
                <span className="text-[12px] font-semibold" style={{ color: '#16a34a' }}>pago: {fmtR(pagoTotal)}</span>
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
                <span key={i} style={{ color: p.pago ? '#16a34a' : p.date < hoje ? 'oklch(0.65 0.02 258)' : B.text }}>
                  {p.pago ? '✓' : p.date < hoje ? '✓' : '○'} {fmtD(p.pago ? (p.dataPago ?? p.date) : p.date)} · {fmtR(p.pago ?? p.amount)}
                  <span style={{ color: B.muted }}> ({p.label.replace('Parcela ', 'P')}{p.pago ? ' · pago' : ''})</span>
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
          {filtroRoot || filtroStatus
            ? 'Nenhum pedido com esse filtro. Ajuste ou limpe os filtros acima.'
            : 'Nenhum pedido ainda. Cadastre os perfis de produto e clique em "Novo pedido".'}
        </div>
      )}
      <style>{`.inp{border:1px solid ${B.border};border-radius:8px;padding:6px 8px;font-size:13px;color:${B.text};background:white;outline:none}`}</style>
    </div>
  )
}

/* ── Fluxo de caixa (Etapa 2): desencaixe mensal consolidado ─────────── */
function CaixaPanel({ plans, profById, fluxoGeral, hoje }: {
  plans: (ImportPlan & { id: string })[]
  profById: Map<string, ImportProfile>
  fluxoGeral: FluxoGeralData
  hoje: string
}) {
  // Filtros: em curso / planejados (previstos) / concluídos
  const [showCurso, setShowCurso] = useState(true)
  const [showPrev, setShowPrev] = useState(true)
  const [showDone, setShowDone] = useState(false)
  // Pagamentos em aberto de cada pedido, resolvidos em datas
  interface Linha {
    invoice: string; root: string; status: string; compromissado: boolean; done: boolean
    emTransito: boolean   // pago mas mercadoria ainda não chegou ao galpão
    total: number; pago: number; porMes: Map<string, number>
    detalhes: Array<{ date: string; label: string; amount: number; pago?: number }>
  }
  const linhas: Linha[] = []
  for (const pl of plans) {
    const prof = profById.get(pl.profile_id ?? '')
    if (!prof) continue
    const ehPrevisto = pl.compromissado === false
    if (pl.done ? !showDone : ehPrevisto ? !showPrev : !showCurso) continue
    const dates = resolvePlanDates(pl, prof, hoje)
    const todos = resolvePagamentos(pl, prof, dates)
    const abertos = pl.done ? [] : todos.filter(p => !p.pago && p.date >= hoje)
    const passados = todos.filter(p => p.pago || p.date < hoje)
    const pago = todos.reduce((s, p) => s + (p.pago ?? 0), 0) + Number(pl.valor_pago ?? 0)
    if (!abertos.length && !passados.length && !(pl.done && showDone) && pago <= 0) continue
    const porMes = new Map<string, number>()
    for (const p of [...passados, ...abertos]) {
      const m = p.date.slice(0, 7)
      porMes.set(m, (porMes.get(m) ?? 0) + p.amount)
    }
    linhas.push({
      invoice: pl.invoice, root: prof.root_sku, status: dates.status,
      compromissado: pl.compromissado !== false, done: !!pl.done,
      emTransito: !pl.done && !pl.galpao_real,
      total: abertos.reduce((s, p) => s + p.amount, 0), pago,
      porMes, detalhes: todos,
    })
  }
  linhas.sort((a, b) => (a.detalhes[0]?.date ?? '') < (b.detalhes[0]?.date ?? '') ? -1 : 1)

  // Agrupamento por família (SKU raiz) — resumo com expansão por clique
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const famílias = useMemo(() => {
    const map = new Map<string, { root: string; pedidos: Linha[]; total: number; pago: number; porMes: Map<string, number>; porMesComp: Map<string, number>; porMesPrev: Map<string, number> }>()
    for (const l of linhas) {
      if (!map.has(l.root)) map.set(l.root, { root: l.root, pedidos: [], total: 0, pago: 0, porMes: new Map(), porMesComp: new Map(), porMesPrev: new Map() })
      const f = map.get(l.root)!
      f.pedidos.push(l)
      f.total += l.total
      f.pago += l.pago
      for (const [m, v] of l.porMes) {
        f.porMes.set(m, (f.porMes.get(m) ?? 0) + v)
        const alvo = l.compromissado ? f.porMesComp : f.porMesPrev
        alvo.set(m, (alvo.get(m) ?? 0) + v)
      }
    }
    return [...map.values()].sort((a, b) => (a.root < b.root ? -1 : 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, showCurso, showPrev, showDone, hoje])

  const mesesSet = new Set<string>()
  for (const l of linhas) for (const m of l.porMes.keys()) mesesSet.add(m)
  const mesesCols = [...mesesSet].sort()
  const byMonth = new Map<string, Array<{ amount: number }>>()
  for (const l of linhas) for (const [m, v] of l.porMes) {
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m)!.push({ amount: v })
  }
  const totalComp = linhas.filter(l => l.compromissado).reduce((s, l) => s + l.total, 0)
  const totalPrev = linhas.filter(l => !l.compromissado).reduce((s, l) => s + l.total, 0)
  const fmtMes = (m: string) => {
    const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
    return `${nomes[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
  }
  const fmtRk = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : v.toFixed(0)

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${B.border}` }}>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <span className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Fluxo de Pagamentos — Importação
          </span>
          <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'oklch(0.94 0.06 258)', color: '#125BFF' }}>
            compromissado: {fmtR(totalComp)}
          </span>
          {totalPrev > 0 && (
            <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'white', color: '#d97706', border: '1.5px dashed #d97706' }}>
              previsto: {fmtR(totalPrev)}
            </span>
          )}
          <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'oklch(0.95 0.06 145)', color: '#15803d' }}>
            pago: {fmtR(linhas.reduce((s, l) => s + l.pago, 0))}
          </span>
          <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" title="Caixa alocado em mercadoria paga que ainda não chegou ao galpão (em produção ou em trânsito)"
                style={{ background: 'oklch(0.94 0.08 280)', color: '#7B61FF' }}>
            pago em trânsito/produção: {fmtR(linhas.filter(l => l.emTransito).reduce((s, l) => s + l.pago, 0))}
          </span>
          <span className="mx-1" style={{ borderLeft: `1px solid ${B.border}`, height: 18 }} />
          {([['em curso', showCurso, setShowCurso], ['planejados', showPrev, setShowPrev], ['concluídos', showDone, setShowDone]] as const).map(([label, on, set]) => (
            <button key={label} onClick={() => set(!on)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer"
              style={{ background: on ? B.brand : 'white', color: on ? 'white' : B.muted, border: `1px solid ${on ? B.brand : B.border}` }}>
              {on ? '✓ ' : ''}{label}
            </button>
          ))}
        </div>
        <div className="text-[12px] mb-4" style={{ color: B.muted }}>
          Pedidos nas linhas, meses nas colunas — como a planilha. Valores em R$ mil; passe o mouse na célula para o detalhe.
          Células <b>verdes</b> = meses passados (parcelas vencidas, consideradas pagas). Linhas âmbar tracejadas = pedidos <b>previstos</b> (em estudo).
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${B.border}` }}>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide sticky left-0 bg-white" style={{ color: B.muted }}>Pedido</th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: B.muted }}>Status</th>
                <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide" style={{ color: B.muted }}>Pago</th>
                <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide" style={{ color: B.muted }}>A pagar</th>
                {mesesCols.map(m => (
                  <th key={m} className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: B.muted }}>{fmtMes(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {famílias.map(f => {
                const aberta = expandidas.has(f.root)
                return (
                  <FamiliaRows key={f.root} f={f} aberta={aberta}
                    onToggle={() => setExpandidas(prev => {
                      const n = new Set(prev)
                      if (n.has(f.root)) n.delete(f.root); else n.add(f.root)
                      return n
                    })}
                    mesesCols={mesesCols} hoje={hoje} fmtRk={fmtRk} />
                )
              })}
              {/* Totais */}
              <tr style={{ borderTop: `2px solid ${B.border}`, background: B.bgSubtle }}>
                <td className="px-3 py-2 text-[12px] font-bold sticky left-0" style={{ color: B.text, background: B.bgSubtle }}>TOTAL</td>
                <td />
                <td className="px-2 py-2 text-right text-[13px] font-bold" style={{ color: '#15803d', fontFamily: 'var(--font-geist-mono)' }}>
                  {fmtRk(linhas.reduce((s, l) => s + l.pago, 0))}
                </td>
                <td className="px-2 py-2 text-right text-[13px] font-bold" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {fmtRk(totalComp + totalPrev)}
                </td>
                {mesesCols.map(m => {
                  const t = (byMonth.get(m) ?? []).reduce((s, x) => s + x.amount, 0)
                  return (
                    <td key={m} className="px-2 py-2 text-right text-[13px] font-bold" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                      {t ? fmtRk(t) : '·'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
        {linhas.length === 0 && (
          <div className="text-[13px] py-4 text-center" style={{ color: B.muted }}>
            Nenhum pagamento em aberto nos pedidos em curso.
          </div>
        )}
      </div>

      {/* ── Fluxo Geral (formato da planilha): blocos empilhados ── */}
      <FluxoGeralMatriz
        data={fluxoGeral}
        pagamentosMes={Object.fromEntries([...byMonth.entries()].map(([m, ls]) => [m, ls.reduce((s2, l) => s2 + l.amount, 0)]))}
      />
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

/* Linha de família (resumo) + pedidos expandidos no Fluxo de Pagamentos */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FamiliaRows({ f, aberta, onToggle, mesesCols, hoje, fmtRk }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  f: any; aberta: boolean; onToggle: () => void
  mesesCols: string[]; hoje: string; fmtRk: (v: number) => string
}) {
  const mesAtual = hoje.slice(0, 7)
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer" style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
        <td className="px-3 py-2 sticky left-0 bg-white">
          <div className="flex items-center gap-2">
            <span style={{ color: B.muted, fontSize: 11 }}>{aberta ? '▾' : '▸'}</span>
            <div>
              <div className="text-[13px] font-bold" style={{ color: B.text }}>{f.root}</div>
              <div className="text-[11px]" style={{ color: B.muted }}>{f.pedidos.length} pedido{f.pedidos.length > 1 ? 's' : ''}</div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2 text-[11px]" style={{ color: B.muted }}>
          {f.pedidos.filter((p: any) => !p.compromissado).length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'white', color: '#d97706', border: '1px dashed #d97706' }}>
              {f.pedidos.filter((p: any) => !p.compromissado).length} prev.
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-right text-[13px] font-bold" style={{ color: f.pago > 0 ? '#15803d' : 'oklch(0.85 0.01 258)', fontFamily: 'var(--font-geist-mono)' }}>
          {f.pago > 0 ? fmtRk(f.pago) : '·'}
        </td>
        <td className="px-2 py-2 text-right text-[13px] font-bold" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
          {fmtRk(f.total)}
        </td>
        {mesesCols.map(m => {
          const comp = f.porMesComp.get(m) ?? 0
          const prev = f.porMesPrev.get(m) ?? 0
          const passado = m < mesAtual
          return (
            <td key={m} className="px-2 py-2 text-right text-[13px] font-bold whitespace-nowrap"
                style={{ fontFamily: 'var(--font-geist-mono)', background: passado ? 'oklch(0.97 0.02 145)' : undefined }}>
              {passado && (comp + prev > 0) ? <span style={{ color: '#15803d' }}>{fmtRk(comp + prev)}</span> : (
                <>
                  {comp > 0 && <span style={{ color: '#125BFF' }}>{fmtRk(comp)}</span>}
                  {comp > 0 && prev > 0 && <span style={{ color: B.muted }}> + </span>}
                  {prev > 0 && <span style={{ color: '#d97706' }}>{fmtRk(prev)}</span>}
                  {comp === 0 && prev === 0 && <span style={{ color: 'oklch(0.85 0.01 258)' }}>·</span>}
                </>
              )}
            </td>
          )
        })}
      </tr>
      {aberta && f.pedidos.map((l: any) => {
        const sc = STATUS_COLORS[l.status] ?? { bg: B.bgSubtle, color: B.muted }
        return (
          <tr key={l.invoice} style={{ borderBottom: `1px solid ${B.bgSubtle}`, background: l.compromissado ? 'oklch(0.99 0.003 258)' : 'oklch(0.98 0.03 70)' }}>
            <td className="px-3 py-1.5 sticky left-0 pl-8" style={{ background: l.compromissado ? 'oklch(0.99 0.003 258)' : 'oklch(0.98 0.03 70)' }}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium" style={{ color: B.text }}>{l.invoice}</span>
                {!l.compromissado && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'white', color: '#d97706', border: '1px dashed #d97706' }}>PREV</span>
                )}
              </div>
            </td>
            <td className="px-2 py-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: sc.bg, color: sc.color }}>{l.status}</span>
            </td>
            <td className="px-2 py-1.5 text-right text-[12px]" style={{ color: l.pago > 0 ? '#15803d' : 'oklch(0.85 0.01 258)', fontFamily: 'var(--font-geist-mono)' }}>
              {l.pago > 0 ? fmtRk(l.pago) : '·'}
            </td>
            <td className="px-2 py-1.5 text-right text-[12px] font-semibold" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
              {fmtRk(l.total)}
            </td>
            {mesesCols.map(m => {
              const v = l.porMes.get(m)
              const passado = m < mesAtual
              const det = l.detalhes.filter((d: any) => d.date.slice(0, 7) === m).map((d: any) => `${d.date < hoje ? '✓ pago' : '○'} ${fmtD(d.date)} ${d.label}: ${fmtR(d.amount)}`).join('\n')
              return (
                <td key={m} title={det || undefined} className="px-2 py-1.5 text-right text-[12px]"
                    style={{ fontFamily: 'var(--font-geist-mono)', color: v ? (passado ? '#15803d' : l.compromissado ? '#125BFF' : '#d97706') : 'oklch(0.88 0.01 258)', background: passado ? 'oklch(0.97 0.02 145)' : undefined }}>
                  {v ? fmtRk(v) : '·'}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
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
