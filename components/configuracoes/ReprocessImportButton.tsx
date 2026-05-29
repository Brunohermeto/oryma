'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

export function ReprocessImportButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')
  const [log,    setLog]    = useState<string[]>([])

  async function handle() {
    setStatus('running'); setResult(''); setLog([])
    try {
      const res  = await fetch('/api/debug/reprocess-import-items', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) {
        setResult(`Erro: ${data.error ?? 'falha'}`)
        setStatus('error')
        return
      }
      setResult(data.message)
      setLog(data.log ?? [])
      setStatus('done')
    } catch (err) {
      setResult(`Erro: ${String(err)}`)
      setStatus('error')
    }
  }

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Reprocessar Itens de Importação
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Corrige NF-e de entrada importadas com SKU errado do fornecedor.
        Consulta o catálogo do Bling (Cadastro → Produto) para resolver o código correto
        e recalcula o CMV automaticamente.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handle}
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
          {status === 'running' ? 'Reprocessando…' : 'Reprocessar via Catálogo Bling'}
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

      {log.length > 0 && (
        <details className="mt-3" open={status === 'done'}>
          <summary className="text-[11px] cursor-pointer" style={{ color: B.muted }}>
            Ver log detalhado ({log.length} linhas)
          </summary>
          <div className="mt-1 rounded-lg p-3 font-mono text-[11px] space-y-0.5 max-h-48 overflow-y-auto"
            style={{ background: B.bg, color: B.muted }}>
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </details>
      )}
    </div>
  )
}
