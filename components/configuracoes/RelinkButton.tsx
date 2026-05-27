'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'

const B = {
  border: 'oklch(0.88 0.016 258)',
  bg:     'oklch(0.96 0.010 258)',
  muted:  'oklch(0.50 0.025 258)',
  brand:  '#125BFF',
}

export function RelinkButton() {
  const [status, setStatus]   = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult]   = useState('')

  async function handleRelink() {
    setStatus('running')
    setResult('')
    try {
      const res  = await fetch('/api/landed-cost/relink', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setResult(data.message ?? `✓ ${data.sales_updated} vendas atualizadas`)
        setStatus('done')
      } else {
        throw new Error(data.error ?? data.message ?? 'Erro desconhecido')
      }
    } catch (err) {
      setResult(`Erro: ${String(err).replace('Error: ', '')}`)
      setStatus('error')
    }
  }

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Recalcular CMV e Margens
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Vincula todas as vendas ao seu CMP histórico e recalcula margem de lucro.
        Rode sempre após importar NF-e de entrada ou sincronizar novas vendas.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleRelink}
          disabled={status === 'running'}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
          style={{
            background: status === 'running' ? B.bg : B.brand,
            color:      status === 'running' ? B.muted : 'white',
            border:     status === 'running' ? `1px solid ${B.border}` : 'none',
            cursor:     status === 'running' ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={13} className={status === 'running' ? 'animate-spin' : ''} />
          {status === 'running' ? 'Calculando…' : 'Recalcular CMV e Margens'}
        </button>

        {status === 'done' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
            <CheckCircle size={13} /> {result}
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
            <XCircle size={13} /> {result}
          </span>
        )}
      </div>
    </div>
  )
}
