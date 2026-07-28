'use client'

/**
 * Auditoria sob demanda na Visão Geral: roda as mesmas verificações do ciclo
 * diário (regras por venda + vistoria de taxas vs tabela oficial), atualiza os
 * painéis e libera o relatório CSV para conferência/contestação.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Download, RefreshCw } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

export function RunAuditButton() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [resumo, setResumo] = useState('')

  async function run() {
    setStatus('running')
    setResumo('')
    try {
      // 1. Regras por venda (NF incorreta, sem tarifas, custo, margem…)
      setProgress('Auditando vendas (NF, tarifas, custos, margens)…')
      const a = await fetch('/api/audit/sales?days=45', { method: 'POST' }).then(r => r.json())

      // 2. Vistoria de taxas vs tabela oficial do ML (fatiada por anúncio)
      let achadosFees = 0
      for (let skip = 0; skip < 400; skip += 25) {
        setProgress(`Conferindo taxas vs tabela oficial do ML… (${skip} anúncios verificados)`)
        const r = await fetch('/api/audit/fees', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: 30, limit: 25, skip }),
        }).then(x => x.ok ? x.json() : null).catch(() => null)
        if (!r?.ok) break
        achadosFees += Number(r.achados ?? 0)
        if ((r.remaining_items ?? 0) <= 0) break
      }

      setProgress('')
      setResumo(`${a?.auditadas ?? 0} vendas auditadas · ${a?.achados ?? 0} apontamentos + ${achadosFees} divergências de taxa`)
      setStatus('done')
      router.refresh()
    } catch (e) {
      setProgress('')
      setResumo(`Erro: ${String(e).slice(0, 80)}`)
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={run}
        disabled={status === 'running'}
        className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg"
        style={{
          background: status === 'running' ? 'oklch(0.96 0.010 258)' : B.brand,
          color: status === 'running' ? B.muted : 'white',
          border: 'none',
          cursor: status === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        {status === 'running'
          ? <RefreshCw size={12} className="animate-spin" />
          : <ShieldCheck size={12} />}
        {status === 'running' ? 'Auditando…' : 'Executar auditoria agora'}
      </button>
      {status !== 'running' && (
        <a
          href="/api/audit/report"
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
          style={{ border: `1px solid ${B.border}`, color: B.brand, textDecoration: 'none' }}
        >
          <Download size={12} />
          Baixar relatório (Excel)
        </a>
      )}
      {progress && <span className="text-[12px]" style={{ color: B.muted }}>{progress}</span>}
      {resumo && (
        <span className="text-[12px] font-medium" style={{ color: status === 'error' ? '#dc2626' : '#16a34a' }}>
          {status === 'done' ? '✓ ' : ''}{resumo}
        </span>
      )}
    </div>
  )
}
