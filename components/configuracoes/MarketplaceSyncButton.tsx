'use client'
import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, History } from 'lucide-react'

const B = {
  brand:  '#125BFF',
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  bg:     'oklch(0.96 0.010 258)',
}

const STORAGE_KEY      = 'marketplace_sync_id'
const STORAGE_KEY_BACK = 'marketplace_backfill_id'

function useSyncState(storageKey: string) {
  const [status, setStatus]   = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult]   = useState('')
  const [syncId, setSyncId]   = useState<string | null>(null)

  useEffect(() => {
    const savedId = localStorage.getItem(storageKey)
    if (savedId) { setSyncId(savedId); setStatus('running') }
  }, [storageKey])

  useEffect(() => {
    if (!syncId || status !== 'running') return
    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`/api/sync/marketplaces/status?id=${syncId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.status === 'success') {
          const ch    = data.channels ?? {}
          const ml    = typeof ch.mercado_livre === 'number' ? ch.mercado_livre : 0
          const sh    = typeof ch.shopee        === 'number' ? ch.shopee        : 0
          const az    = typeof ch.amazon        === 'number' ? ch.amazon        : 0
          const total = data.records_synced ?? (ml + sh + az)
          const parts: string[] = []
          if (ch.mercado_livre !== undefined) parts.push(`ML: ${ml}`)
          if (ch.shopee        !== undefined) parts.push(`Shopee: ${sh}`)
          if (ch.amazon        !== undefined) parts.push(`Amazon: ${az}`)
          setResult(`✓ ${parts.join(' · ')} vendas (total: ${total})`)
          setStatus('done')
          localStorage.removeItem(storageKey)
          clearInterval(interval)
        } else if (data.status === 'error') {
          const firstError = Object.values(data.errors ?? {})[0] ?? 'desconhecido'
          setResult(`Erro: ${String(firstError).replace('error: ', '')}`)
          setStatus('error')
          localStorage.removeItem(storageKey)
          clearInterval(interval)
        } else if (data.status === 'not_found') {
          localStorage.removeItem(storageKey)
          setStatus('idle')
          clearInterval(interval)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [syncId, status, storageKey])

  async function startSync(days: number) {
    setStatus('running')
    setResult('')
    setSyncId(null)
    localStorage.removeItem(storageKey)
    try {
      const res  = await fetch(`/api/sync/marketplaces?days=${days}`, { method: 'POST' })
      const data = await res.json()
      if (data.sync_id) {
        setSyncId(data.sync_id)
        localStorage.setItem(storageKey, data.sync_id)
      } else {
        setResult(data.error ?? 'Erro desconhecido')
        setStatus('error')
      }
    } catch {
      setResult('Erro de conexão')
      setStatus('error')
    }
  }

  return { status, result, startSync }
}

export function MarketplaceSyncButton() {
  const sync     = useSyncState(STORAGE_KEY)
  const backfill = useSyncState(STORAGE_KEY_BACK)

  const isAnyRunning = sync.status === 'running' || backfill.status === 'running'

  return (
    <div className="flex flex-col gap-3">
      {/* ── Sync rápido (7 dias) ─────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => sync.startSync(7)}
          disabled={isAnyRunning}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
          style={{
            background: sync.status === 'running' ? B.bg : B.brand,
            color:      sync.status === 'running' ? B.muted : 'white',
            border:     sync.status === 'running' ? `1px solid ${B.border}` : 'none',
            cursor:     isAnyRunning ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={13} className={sync.status === 'running' ? 'animate-spin' : ''} />
          {sync.status === 'running' ? 'Sincronizando… pode navegar' : 'Sincronizar Vendas (7 dias)'}
        </button>

        {sync.status === 'running' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: B.muted }}>
            <Clock size={12} />
            Rodando em background
          </span>
        )}
        {sync.status === 'done' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
            <CheckCircle size={13} /> {sync.result}
          </span>
        )}
        {sync.status === 'error' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
            <XCircle size={13} /> {sync.result}
          </span>
        )}
      </div>

      {/* ── Backfill histórico (180 dias) ───────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => backfill.startSync(180)}
          disabled={isAnyRunning}
          className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-all"
          style={{
            background: backfill.status === 'running' ? B.bg : 'transparent',
            color:      backfill.status === 'running' ? B.muted : B.brand,
            border:     `1px solid ${backfill.status === 'running' ? B.border : B.brand}`,
            cursor:     isAnyRunning ? 'not-allowed' : 'pointer',
          }}
        >
          <History size={12} className={backfill.status === 'running' ? 'animate-spin' : ''} />
          {backfill.status === 'running' ? 'Buscando histórico…' : 'Backfill histórico (180 dias)'}
        </button>

        {backfill.status === 'running' && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: B.muted }}>
            <Clock size={11} />
            Pode levar alguns minutos
          </span>
        )}
        {backfill.status === 'done' && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: '#16a34a' }}>
            <CheckCircle size={12} /> {backfill.result}
          </span>
        )}
        {backfill.status === 'error' && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: '#dc2626' }}>
            <XCircle size={12} /> {backfill.result}
          </span>
        )}
      </div>
    </div>
  )
}
