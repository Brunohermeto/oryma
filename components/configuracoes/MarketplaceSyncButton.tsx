'use client'
import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, History } from 'lucide-react'

const B = {
  brand:  '#125BFF',
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  bg:     'oklch(0.96 0.010 258)',
}

const STORAGE_KEY = 'marketplace_sync_id'

// Gera N chunks de 30 dias indo para trás, no formato YYYY-MM-DD
function buildBackfillChunks(totalDays: number, chunkDays = 30): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = []
  const now = new Date()
  for (let offset = 0; offset < totalDays; offset += chunkDays) {
    const toDate   = new Date(now); toDate.setUTCDate(now.getUTCDate() - offset)
    const fromDate = new Date(now); fromDate.setUTCDate(now.getUTCDate() - Math.min(offset + chunkDays, totalDays))
    const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    chunks.push({ from: fmt(fromDate), to: fmt(toDate) })
  }
  return chunks
}

async function runSyncChunk(from: string, to: string): Promise<{ synced: number; error?: string }> {
  const res = await fetch(`/api/sync/marketplaces?from=${from}&to=${to}`, { method: 'POST' })
  const data = await res.json()
  if (!data.sync_id) return { synced: 0, error: data.error ?? 'sem sync_id' }

  // Polling até terminar
  for (let attempts = 0; attempts < 30; attempts++) {
    await new Promise(r => setTimeout(r, 3000))
    const poll = await fetch(`/api/sync/marketplaces/status?id=${data.sync_id}`)
    const status = await poll.json()
    if (status.status === 'success') return { synced: status.records_synced ?? 0 }
    if (status.status === 'error') {
      const firstErr = Object.values(status.errors ?? {})[0]
      return { synced: 0, error: firstErr ? String(firstErr).replace('error: ', '') : status.error_message ?? 'falhou' }
    }
  }
  return { synced: 0, error: 'timeout' }
}

function useSyncState() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')
  const [syncId, setSyncId] = useState<string | null>(null)

  useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY)
    if (savedId) { setSyncId(savedId); setStatus('running') }
  }, [])

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
          localStorage.removeItem(STORAGE_KEY)
          clearInterval(interval)
        } else if (data.status === 'error') {
          const firstError = Object.values(data.errors ?? {})[0]
          const msg = firstError ? String(firstError).replace('error: ', '') : (data.error_message ?? 'Tente novamente')
          setResult(`Erro: ${msg}`)
          setStatus('error')
          localStorage.removeItem(STORAGE_KEY)
          clearInterval(interval)
        } else if (data.status === 'not_found') {
          localStorage.removeItem(STORAGE_KEY)
          setStatus('idle')
          clearInterval(interval)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [syncId, status])

  async function startSync(days: number) {
    setStatus('running')
    setResult('')
    setSyncId(null)
    localStorage.removeItem(STORAGE_KEY)
    try {
      const res  = await fetch(`/api/sync/marketplaces?days=${days}`, { method: 'POST' })
      const data = await res.json()
      if (data.sync_id) {
        setSyncId(data.sync_id)
        localStorage.setItem(STORAGE_KEY, data.sync_id)
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
  const sync = useSyncState()

  // Backfill tem estado próprio (não usa polling — é síncrono no browser)
  const [backStatus, setBackStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [backResult, setBackResult] = useState('')
  const [backProgress, setBackProgress] = useState('')

  const isAnyRunning = sync.status === 'running' || backStatus === 'running'

  async function handleBackfill() {
    setBackStatus('running')
    setBackResult('')
    setBackProgress('Preparando chunks…')

    const chunks = buildBackfillChunks(180, 30)  // 6 chunks de 30 dias
    let totalSynced = 0

    for (let i = 0; i < chunks.length; i++) {
      const { from, to } = chunks[i]
      setBackProgress(`Chunk ${i + 1}/${chunks.length} — ${from} a ${to}…`)
      try {
        const { synced, error } = await runSyncChunk(from, to)
        if (error) {
          setBackResult(`Erro no chunk ${i + 1}: ${error}`)
          setBackStatus('error')
          return
        }
        totalSynced += synced
      } catch (err) {
        setBackResult(`Erro de conexão no chunk ${i + 1}: ${String(err)}`)
        setBackStatus('error')
        return
      }
    }

    setBackProgress('')
    setBackResult(`✓ ${totalSynced} vendas importadas (6 meses)`)
    setBackStatus('done')
  }

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

      {/* ── Backfill histórico (180 dias em chunks de 30d) ──── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleBackfill}
            disabled={isAnyRunning}
            className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-all"
            style={{
              background: backStatus === 'running' ? B.bg : 'transparent',
              color:      backStatus === 'running' ? B.muted : B.brand,
              border:     `1px solid ${backStatus === 'running' ? B.border : B.brand}`,
              cursor:     isAnyRunning ? 'not-allowed' : 'pointer',
            }}
          >
            <History size={12} className={backStatus === 'running' ? 'animate-spin' : ''} />
            {backStatus === 'running' ? 'Importando histórico…' : 'Backfill histórico (180 dias)'}
          </button>

          {backStatus === 'done' && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: '#16a34a' }}>
              <CheckCircle size={12} /> {backResult}
            </span>
          )}
          {backStatus === 'error' && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: '#dc2626' }}>
              <XCircle size={12} /> {backResult}
            </span>
          )}
        </div>

        {backStatus === 'running' && backProgress && (
          <div className="text-xs pl-1" style={{ color: B.muted }}>
            <Clock size={10} className="inline mr-1" />
            {backProgress} — não feche esta página
          </div>
        )}
      </div>
    </div>
  )
}
