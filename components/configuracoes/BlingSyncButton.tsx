'use client'
import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react'

const B = {
  brand:  '#125BFF',
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  bg:     'oklch(0.96 0.010 258)',
}

export function BlingSyncButton() {
  const [status, setStatus]   = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult]   = useState('')
  const [syncId, setSyncId]   = useState<string | null>(null)

  // Polling: verifica o sync_log até terminar
  useEffect(() => {
    if (!syncId || status !== 'running') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sync/bling/status?id=${syncId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.status === 'success') {
          setResult(`✓ ${data.nfe_entrada ?? 0} NF-e entrada · ${data.nfe_saida ?? 0} NF-e saída sincronizadas`)
          setStatus('done')
          clearInterval(interval)
        } else if (data.status === 'error') {
          setResult(`Erro: ${data.error_message ?? 'desconhecido'}`)
          setStatus('error')
          clearInterval(interval)
        }
        // se ainda 'running', continua polling
      } catch {}
    }, 3000) // verifica a cada 3s
    return () => clearInterval(interval)
  }, [syncId, status])

  async function handleSync() {
    setStatus('running')
    setResult('')
    setSyncId(null)
    try {
      const res = await fetch('/api/sync/bling', { method: 'POST' })
      const data = await res.json()
      if (data.sync_id) {
        // Background: acompanha pelo polling
        setSyncId(data.sync_id)
      } else if (data.ok) {
        // Síncrono (fallback)
        setResult(`✓ ${data.nfe_entrada} NF-e entrada · ${data.nfe_saida} NF-e saída sincronizadas`)
        setStatus('done')
      } else {
        setResult(data.error ?? 'Erro desconhecido')
        setStatus('error')
      }
    } catch (e) {
      setResult('Erro de conexão')
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={handleSync}
        disabled={status === 'running'}
        className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
        style={{
          background: status === 'running' ? B.bg : B.brand,
          color: status === 'running' ? B.muted : 'white',
          border: status === 'running' ? `1px solid ${B.border}` : 'none',
          cursor: status === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        <RefreshCw size={13} className={status === 'running' ? 'animate-spin' : ''} />
        {status === 'running' ? 'Sincronizando… pode navegar' : 'Sincronizar NF-e Bling'}
      </button>

      {status === 'running' && !result && (
        <span className="flex items-center gap-1.5 text-sm" style={{ color: B.muted }}>
          <Clock size={12} />
          Rodando em background — pode navegar normalmente
        </span>
      )}

      {status === 'done' && (
        <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
          <CheckCircle size={13} />
          {result}
        </span>
      )}

      {status === 'error' && (
        <span className="flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
          <XCircle size={13} />
          {result}
        </span>
      )}
    </div>
  )
}
