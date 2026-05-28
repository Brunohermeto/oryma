'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

export function FixCommissionButton() {
  const [status, setStatus]   = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult]   = useState('')
  const [total, setTotal]     = useState(0)

  async function handleFix() {
    setStatus('running')
    setResult('')
    setTotal(0)

    let totalFixed = 0
    let batch = 0

    // Processa em lotes de 20 até não ter mais nada para corrigir
    while (true) {
      batch++
      try {
        const res  = await fetch('/api/debug/fix-commission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: 20, max_commission: 5 }),
        })
        const data = await res.json()

        if (!res.ok || data.error) {
          setResult(`Erro: ${data.error ?? 'falha na requisição'}`)
          setStatus('error')
          return
        }

        totalFixed += data.fixed ?? 0
        setTotal(totalFixed)

        // Para quando não há mais vendas para processar ou nenhuma foi corrigida no lote
        if (data.total_processed === 0 || data.fixed === 0) break
        if (batch > 50) break // segurança: máximo 1000 correções por execução
      } catch (err) {
        setResult(`Erro: ${String(err)}`)
        setStatus('error')
        return
      }
    }

    setResult(`✓ ${totalFixed} comissões corrigidas`)
    setStatus('done')
  }

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Corrigir Comissões ML
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Busca a comissão real no ML para vendas com valor suspeito ({"<"} R$ 5).
        Necessário para produtos de catálogo como RAGA001-C.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleFix}
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
          {status === 'running' ? `Corrigindo… (${total} até agora)` : 'Corrigir Comissões'}
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
