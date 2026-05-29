'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

export function SyncMLFeesButton() {
  const [status,  setStatus]  = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState({ fixed: 0, processed: 0 })
  const [result,  setResult]  = useState('')

  async function handleSync() {
    setStatus('running')
    setProgress({ fixed: 0, processed: 0 })
    setResult('')

    let totalFixed     = 0
    let totalProcessed = 0
    let offset         = 0
    let batch          = 0

    while (true) {
      batch++
      try {
        const res  = await fetch('/api/debug/sync-ml-fees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: 25, offset }),
        })
        const data = await res.json()

        if (!res.ok || data.error) {
          setResult(`Erro: ${data.error ?? 'falha'}`)
          setStatus('error')
          return
        }

        totalFixed     += data.fixed ?? 0
        totalProcessed += data.total_processed ?? 0
        offset          = data.next_offset ?? (offset + 25)
        setProgress({ fixed: totalFixed, processed: totalProcessed })

        // Para quando não há mais vendas para processar
        if (!data.has_more || data.total_processed === 0) break
        if (batch > 200) break  // segurança: máx 5000 vendas por execução

      } catch (err) {
        setResult(`Erro: ${String(err)}`)
        setStatus('error')
        return
      }
    }

    setResult(`✓ ${totalFixed} vendas atualizadas (frete + rebate + comissão)`)
    setStatus('done')
  }

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Buscar Frete, Rebate e Comissão do ML
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        A API de sincronização em massa do ML não retorna frete e rebates. Este botão busca cada
        pedido individualmente para preencher <strong>frete cobrado ao vendedor</strong>,{' '}
        <strong>rebates</strong> e <strong>comissões</strong> corretos. Pode demorar alguns minutos
        para processar todas as vendas.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSync}
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
          {status === 'running'
            ? `Buscando… ${progress.processed} vendas (${progress.fixed} atualizadas)`
            : 'Buscar Taxas do ML'}
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
      {status === 'done' && (
        <p className="text-[12px] mt-3" style={{ color: B.muted }}>
          Clique em <strong>Recalcular CMV e Margens</strong> abaixo para aplicar as margens corretas com os novos valores.
        </p>
      )}
    </div>
  )
}
