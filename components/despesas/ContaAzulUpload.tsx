'use client'
/**
 * Envio mensal do relatório "Visão Contas a Pagar" da Conta Azul → despesas do DRE.
 * Mostra o que entrou, o que ficou fora (já está no Oryma) e as categorias novas
 * para escolher o destino uma vez.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EXPENSE_CATEGORY_LABELS } from '@/types'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.97 0.008 258)', text: '#0B1023', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }
const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
type Res = { meses: string[]; lancamentos: number; no_dre: number; ignorado: Record<string, number>; pendentes: Array<{ categoria: string; valor: number }> }

export function ContaAzulUpload() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [res, setRes] = useState<Res | null>(null)
  const [escolha, setEscolha] = useState<Record<string, string>>({})

  async function enviar() {
    if (!file) { setErro('Escolha o arquivo exportado da Conta Azul.'); return }
    setBusy(true); setErro('')
    const fd = new FormData(); fd.set('file', file)
    const r = await fetch('/api/despesas/contaazul', { method: 'POST', body: fd })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setErro(d.error ?? `Erro ${r.status}`); return }
    setRes(d); router.refresh()
  }

  async function vincular(categoria: string) {
    const destino = escolha[categoria]; if (!destino) return
    setBusy(true)
    const r = await fetch('/api/despesas/contaazul', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoria, destino }) })
    setBusy(false)
    if (!r.ok) { setErro('Erro ao salvar a categoria'); return }
    if (file) await enviar()   // reaplica o mesmo arquivo com a categoria nova
  }

  const ign = Object.entries(res?.ignorado ?? {}).sort((a, b) => b[1] - a[1])
  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="text-sm font-semibold mb-1" style={{ color: B.text }}>Importar despesas do mês (Conta Azul)</div>
      <div className="text-[12px] mb-3" style={{ color: B.muted }}>
        Conta Azul → Financeiro → Contas a pagar → filtre o mês pelo <b>vencimento</b> → Exportar (.xls).
        Compras de mercadoria, importação, ADS do Mercado Livre e DIFAL das vendas ficam fora — o Oryma já conta.
        Reenviar o mesmo mês substitui o envio anterior.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".xls,.xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
        <button onClick={enviar} disabled={busy} className="text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                style={{ background: B.brand, color: 'white', border: 'none', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Processando…' : 'Enviar'}
        </button>
      </div>
      {erro && <div className="text-[12px] mt-3" style={{ color: '#dc2626' }}>{erro}</div>}

      {res && (
        <div className="mt-4 space-y-3 text-[12px]" style={{ color: B.text }}>
          <div className="px-3 py-2 rounded-lg" style={{ background: B.bg }}>
            ✓ {res.lancamentos} lançamentos ({res.meses.map(m => m.slice(5, 7) + '/' + m.slice(0, 4)).join(', ')}) ·{' '}
            <b>{fmtR(res.no_dre)}</b> entraram no DRE
          </div>
          {ign.length > 0 && (
            <div>
              <div className="font-semibold mb-1" style={{ color: B.muted }}>Ficaram fora (já estão no Oryma)</div>
              {ign.map(([c, v]) => (
                <div key={c} className="flex justify-between max-w-md"><span>{c}</span><span style={{ fontFamily: 'var(--font-geist-mono)' }}>{fmtR(v)}</span></div>
              ))}
            </div>
          )}
          {res.pendentes.length > 0 && (
            <div>
              <div className="font-semibold mb-1" style={{ color: '#d97706' }}>Categorias novas — escolha uma vez; vale para os próximos meses</div>
              {res.pendentes.map(p => (
                <div key={p.categoria} className="flex flex-wrap items-center gap-2 py-1">
                  <span className="w-60 truncate">{p.categoria}</span>
                  <span className="w-24 text-right" style={{ fontFamily: 'var(--font-geist-mono)', color: B.muted }}>{fmtR(p.valor)}</span>
                  <select value={escolha[p.categoria] ?? ''} onChange={e => setEscolha({ ...escolha, [p.categoria]: e.target.value })}
                          className="px-2 py-1 rounded-lg" style={{ border: `1px solid ${B.border}` }}>
                    <option value="">— destino —</option>
                    <option value="ignorar">Fora do DRE (já está no Oryma)</option>
                    {Object.entries(EXPENSE_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button onClick={() => vincular(p.categoria)} disabled={busy || !escolha[p.categoria]}
                          className="px-2 py-1 rounded-lg cursor-pointer" style={{ background: B.bg, color: B.brand, border: `1px solid ${B.border}` }}>salvar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
