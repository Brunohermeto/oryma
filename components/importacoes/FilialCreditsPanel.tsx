'use client'

/**
 * Transferências matriz/filial: o crédito de PIS/COFINS fica na NF de ENTRADA
 * da filial. Este painel lista as transferências e permite anexar o XML dessa
 * NF (caminho principal — extrai os créditos item a item) ou informar os
 * totais manualmente (reserva). Depois recalcula custos e margens.
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, Upload, CheckCircle, RefreshCw } from 'lucide-react'

export interface TransferOrder {
  id: string
  nfe_number: string
  issue_date: string
  hasCredits: boolean
}

const B = {
  border: 'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text: '#0B1023',
  muted: 'oklch(0.50 0.025 258)',
  brand: '#125BFF',
}

export function FilialCreditsPanel({ transfers }: { transfers: TransferOrder[] }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [activeOrder, setActiveOrder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [manualFor, setManualFor] = useState<string | null>(null)
  const [pis, setPis] = useState('')
  const [cofins, setCofins] = useState('')
  const [icms, setIcms] = useState('')

  if (!transfers.length) return null

  async function enviar(orderId: string, payload: Record<string, unknown>) {
    setBusy(true)
    setMsg('Aplicando créditos e recalculando custos…')
    try {
      const res = await fetch('/api/import-orders/filial-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'falhou')
      setMsg('Créditos aplicados. Recalculando margens de todas as vendas…')
      await fetch('/api/landed-cost/relink', { method: 'POST' }).catch(() => null)
      const aviso = data.nao_casados?.length ? ` (sem par: ${data.nao_casados.join(', ')})` : ''
      setMsg(`✓ ${data.itens_atualizados} item(ns) creditados — custos e margens recalculados${aviso}`)
      setManualFor(null)
      router.refresh()
    } catch (e) {
      setMsg(`Erro: ${String(e).replace('Error: ', '')}`)
    }
    setBusy(false)
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    const orderId = activeOrder
    e.target.value = ''
    if (!f || !orderId) return
    const reader = new FileReader()
    reader.onload = () => enviar(orderId, { xml: String(reader.result ?? '') })
    reader.readAsText(f)
  }

  const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.')) || 0

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <ArrowLeftRight size={15} style={{ color: B.brand }} />
        <span className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
          Transferências matriz/filial — créditos da filial
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: B.muted }}>
        O crédito de PIS/COFINS destas NF-e fica na NF de entrada da filial. Anexe o XML dela
        para o sistema extrair e abater no custo automaticamente (ou informe os totais manualmente).
      </p>
      <input ref={fileRef} type="file" accept=".xml,text/xml" className="hidden" onChange={onFile} />

      {msg && (
        <div className="text-[12px] mb-3 px-3 py-2 rounded-lg" style={{ background: B.bgSubtle, color: msg.startsWith('Erro') ? '#dc2626' : B.text }}>
          {busy && <RefreshCw size={11} className="inline animate-spin mr-1.5" />}
          {msg}
        </div>
      )}

      <div className="space-y-2">
        {transfers.map(t => (
          <div key={t.id} className="rounded-lg px-3 py-2.5" style={{ background: B.bgSubtle }}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[13px] font-medium" style={{ color: B.text }}>
                NF {t.nfe_number} · {t.issue_date}
              </span>
              {t.hasCredits ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: 'oklch(0.94 0.10 145)', color: '#15803d' }}>
                  <CheckCircle size={11} /> créditos aplicados
                </span>
              ) : (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: 'oklch(0.96 0.08 70)', color: '#92400e' }}>
                  créditos pendentes
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => { setActiveOrder(t.id); fileRef.current?.click() }}
                  disabled={busy}
                  className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer"
                  style={{ background: B.brand, color: 'white', border: 'none' }}
                >
                  <Upload size={12} />
                  {t.hasCredits ? 'Reenviar XML da filial' : 'Anexar XML da NF da filial'}
                </button>
                <button
                  onClick={() => setManualFor(m => (m === t.id ? null : t.id))}
                  disabled={busy}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                  style={{ background: 'white', color: B.brand, border: `1px solid ${B.border}` }}
                >
                  informar manualmente
                </button>
              </div>
            </div>
            {manualFor === t.id && (
              <div className="flex items-end gap-3 flex-wrap mt-3 pt-3" style={{ borderTop: `1px solid ${B.border}` }}>
                {[['PIS total (R$)', pis, setPis], ['COFINS total (R$)', cofins, setCofins], ['ICMS total (R$, se houver)', icms, setIcms]].map(([label, val, set]: any) => (
                  <label key={label} className="text-[11px] font-medium" style={{ color: B.muted }}>
                    {label}
                    <input
                      value={val}
                      onChange={e => set(e.target.value)}
                      placeholder="0,00"
                      className="block mt-1 text-[13px] px-2 py-1.5 rounded-lg w-36 outline-none"
                      style={{ border: `1px solid ${B.border}`, color: B.text, background: 'white', fontFamily: 'var(--font-geist-mono)' }}
                    />
                  </label>
                ))}
                <button
                  onClick={() => enviar(t.id, { pis_total: num(pis), cofins_total: num(cofins), icms_total: num(icms) })}
                  disabled={busy}
                  className="text-[12px] font-semibold px-4 py-2 rounded-lg cursor-pointer"
                  style={{ background: B.brand, color: 'white', border: 'none' }}
                >
                  Aplicar créditos
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
