'use client'
import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react'

const B = {
  brand:  '#125BFF',
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  bg:     'oklch(0.96 0.010 258)',
}

export function MarketplaceSyncButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')
  const [syncId, setSyncId] = useState<string | null>(null)

  // Polling: verifica o sync_log até terminar
  useEffect(() => {
    if (!syncId || status !== 'running') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sync/marketplaces/status?id=${syncId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.status === 'success') {
          const ch = data.channels ?? {}
          const ml = typeof ch.mercado_livre === 'number' ? ch.mercado_livre : 0
          const sh = typeof ch.shopee === 'number' ? ch.shopee : 0
          const az = typeof ch.amazon === 'number' ? ch.amazon : 0
          const total = data.records_synced ?? (ml + sh + az)
          const parts = []
          if (ml > 0 || ch.mercado_livre !== undefined) parts.push(`ML: ${ml}`)
          if (sh > 0 || ch.shopee !== undefined) parts.push(`Shopee: ${sh}`)
          if (az > 0 || ch.amazon !== undefined) parts.push(`Amazon: ${az}`)
          setResult(`✓ ${parts.join(' · ')} vendas (total: ${total})`)
          setStatus('done')
          clearInterval(interval)
        } else if (data.status === 'error') {
          const firstError = Object.values(data.errors ?? {})[0] ?? data.error_message ?? 'desconhecido'
          setResult(`Erro: ${String(firstError).replace('error: ', '')}`)
          setStatus('error')
          clearInterval(interval)
        }
        // se ainda 'running', continua polling
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [syncId, status])

  async function handleSync() {
    setStatus('running')
    setResult('')
    setSyncId(null)
    try {
      const res = await fetch('/api/sync/marketplaces', { method: 'POST' })
      const data = await res.json()
      if (data.sync_id) {
        setSyncId(data.sync_id)
      } else {
        setResult(data.error ?? 'Erro desconhecido')
        setStatus('error')
      }
    } catch {
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
        {status === 'running' ? 'Sincronizando… pode navegar' : 'Sincronizar Vendas'}
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
