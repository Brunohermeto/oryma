'use client'
/** Despesas do mês com ajuste por linha (valor corrigido, excluir, observação). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EXPENSE_CATEGORY_LABELS } from '@/types'

const B = { border: 'oklch(0.88 0.016 258)', bgSubtle: 'oklch(0.96 0.010 258)', text: '#0B1023', muted: 'oklch(0.50 0.025 258)', subtle: 'oklch(0.40 0.020 258)', brand: '#125BFF' }
const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export type Despesa = {
  id: string; period: string; dre_category: string; subcategory: string | null; description: string | null
  supplier: string | null; amount: number; valor_original: number | null; observacao: string | null; source: string | null
}

export function DespesasTable({ despesas, titulo = 'Despesas do mês' }: { despesas: Despesa[]; titulo?: string }) {
  const router = useRouter()
  const [aberta, setAberta] = useState<string | null>(null)
  const [valor, setValor] = useState(''); const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false); const [erro, setErro] = useState('')

  function abrir(d: Despesa) {
    setAberta(d.id); setErro('')
    setValor(String(d.amount).replace('.', ',')); setObs(d.observacao ?? '')
  }
  async function salvar(id: string, excluir = false) {
    // aceita 15.000,00 e 15000.00
    const v = excluir ? 0 : Number(valor.includes(',') ? valor.replace(/\./g, '').replace(',', '.') : valor)
    if (!Number.isFinite(v) || v < 0) { setErro('Valor inválido'); return }
    setBusy(true)
    const r = await fetch('/api/despesas/ajuste', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, valor: v, observacao: obs || (excluir ? 'Excluído do DRE' : '') }) })
    setBusy(false)
    if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? 'Erro ao salvar'); return }
    setAberta(null); router.refresh()
  }

  const total = despesas.reduce((s, d) => s + Number(d.amount), 0)
  const input = { border: `1px solid ${B.border}`, color: B.text } as const
  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${B.border}` }}>
        <div className="font-semibold text-sm" style={{ color: B.text }}>{titulo}</div>
        <div className="text-sm" style={{ color: B.muted }}>
          Total no DRE: <span className="font-semibold" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>{fmtR(total)}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}>
              {['', 'Linha do DRE', 'Categoria Conta Azul', 'Descrição', 'Valor'].map((h, i) => (
                <th key={i} className={`py-3 px-4 text-[11px] font-semibold uppercase tracking-wide ${i === 4 ? 'text-right' : 'text-left'}`} style={{ color: B.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {despesas.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-sm" style={{ color: B.muted }}>Nenhuma despesa neste mês.</td></tr>
            )}
            {despesas.map(d => {
              const ajustada = d.valor_original != null && Number(d.valor_original) !== Number(d.amount)
              return [
                <tr key={d.id} onClick={() => (aberta === d.id ? setAberta(null) : abrir(d))} className="cursor-pointer"
                    title="Clique para editar o valor, excluir ou anotar uma observação"
                    style={{ borderBottom: `1px solid ${B.bgSubtle}`, opacity: Number(d.amount) === 0 ? 0.55 : 1, background: aberta === d.id ? B.bgSubtle : undefined }}>
                  <td className="pl-4 pr-1 py-2.5">
                    <span className="text-[12px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap"
                          style={{ background: B.bgSubtle, color: B.brand, border: `1px solid ${B.border}` }}>✎ editar</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="font-semibold px-2 py-0.5 rounded-full" style={{ background: 'oklch(0.94 0.06 258)', color: B.brand }}>
                      {(EXPENSE_CATEGORY_LABELS as Record<string, string>)[d.dre_category] ?? d.dre_category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: B.muted }}>{d.subcategory ?? 'lançamento manual'}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: B.subtle }}>
                    {d.description ?? '—'}
                    {d.observacao && <div className="text-[11px] mt-0.5" style={{ color: '#b45309' }}>✎ {d.observacao}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-semibold whitespace-nowrap" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                    {fmtR(Number(d.amount))}
                    {ajustada && <div className="text-[10px] font-normal line-through" style={{ color: B.muted }}>{fmtR(Number(d.valor_original))}</div>}
                  </td>
                </tr>,
                aberta === d.id && (
                  <tr key={d.id + '-aj'} style={{ background: B.bgSubtle }}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span style={{ color: B.muted }}>Valor no DRE (R$)</span>
                        <input value={valor} onChange={e => setValor(e.target.value)} className="px-2 py-1 rounded-lg w-28 bg-white" style={input} />
                        <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Observação (ex.: R$ 15.000 é principal)"
                               className="px-2 py-1 rounded-lg flex-1 min-w-[220px] bg-white" style={input} />
                        <button onClick={() => salvar(d.id)} disabled={busy} className="px-3 py-1 rounded-lg cursor-pointer" style={{ background: B.brand, color: 'white', border: 'none' }}>salvar</button>
                        <button onClick={() => salvar(d.id, true)} disabled={busy} className="px-3 py-1 rounded-lg cursor-pointer" style={{ background: 'white', color: '#dc2626', border: `1px solid ${B.border}` }}>excluir do DRE</button>
                        {erro && <span style={{ color: '#dc2626' }}>{erro}</span>}
                      </div>
                      {d.source === 'contaazul' && <div className="text-[11px] mt-1.5" style={{ color: B.muted }}>O ajuste fica salvo e volta a valer se o relatório deste mês for reenviado.</div>}
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
