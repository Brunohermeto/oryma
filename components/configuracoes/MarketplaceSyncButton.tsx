'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, History } from 'lucide-react'

const B = {
  brand:  '#125BFF',
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  bg:     'oklch(0.96 0.010 258)',
}

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

// Roda uma rota fatiada (invoices/shipping/tariffs) até esvaziar a fila
async function loopRota(
  path: string,
  bodyBase: Record<string, unknown>,
  onProgress: (feitas: number, restam: number) => void,
  pausaMs = 1000,
  maxRodadas = 10,
): Promise<number> {
  const skip: string[] = []
  let total = 0
  for (let i = 0; i < maxRodadas; i++) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bodyBase, skip }),
    })
    if (!res.ok) break
    const r = await res.json()
    const feitas = Number(r.sales_updated ?? r.sales_linked ?? 0)
    total += feitas
    onProgress(total, Number(r.remaining_orders ?? 0))
    skip.push(...(r.processed_ids ?? []))
    if (Number(r.processed_orders ?? 0) === 0) break
    await new Promise(res2 => setTimeout(res2, pausaMs))
  }
  return total
}

export function MarketplaceSyncButton() {
  // Sincronização completa (vendas + todo o enriquecimento) — orquestrada no navegador
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState('')

  // Backfill histórico (somente vendas, janelas de 30 dias)
  const [backStatus, setBackStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [backResult, setBackResult] = useState('')
  const [backProgress, setBackProgress] = useState('')

  const isAnyRunning = status === 'running' || backStatus === 'running'

  async function syncCompleto() {
    setStatus('running')
    setResult('')
    const resumo: string[] = []
    try {
      // 1/7 vendas (últimos 3 dias)
      setProgress('Etapa 1/7 — Vendas dos marketplaces…')
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
      const d3 = new Date(); d3.setUTCDate(d3.getUTCDate() - 3)
      const from = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d3)
      const v = await runSyncChunk(from, hoje)
      if (v.error) throw new Error(`vendas: ${v.error}`)
      resumo.push(`${v.synced} vendas`)

      // 2/7 NF-e via ML (impostos Full + vínculo por EAN)
      setProgress('Etapa 2/7 — Notas fiscais via Mercado Livre…')
      const nf = await loopRota('/api/sync/ml/invoices', { days: 4, limit: 20 },
        (f, r) => setProgress(`Etapa 2/7 — Notas via ML… ${f} vinculadas, restam ${r}`), 2000)
      resumo.push(`${nf} notas ML`)

      // 3/7 frete do vendedor
      setProgress('Etapa 3/7 — Frete do vendedor…')
      const fr = await loopRota('/api/sync/ml/shipping', { days: 4, limit: 12 },
        (f, r) => setProgress(`Etapa 3/7 — Frete… ${f} vendas, restam ${r}`), 500)
      resumo.push(`${fr} fretes`)

      // 4/7 tarifas/estorno/UF (rate limit do extrato: 14s entre lotes)
      setProgress('Etapa 4/7 — Tarifas e estornos (extrato ML)…')
      const tf = await loopRota('/api/sync/ml/tariffs', { days: 4, limit: 30 },
        (f, r) => setProgress(`Etapa 4/7 — Tarifas… ${f} vendas, restam ${r}`), 14000, 6)
      resumo.push(`${tf} tarifas`)

      // 5/7 ads/rebates por período
      setProgress('Etapa 5/7 — Publicidade e rebates…')
      await fetch('/api/sync/ml/billing?days=4', { method: 'POST' }).catch(() => null)

      // 6/7 estoque Full
      setProgress('Etapa 6/7 — Estoque Full…')
      await fetch('/api/sync/ml/stock', { method: 'POST' }).catch(() => null)

      // 7/7 margens + auditoria + vistoria de taxas
      setProgress('Etapa 7/7 — Recalculando custos, margens e auditoria…')
      await fetch('/api/landed-cost/relink', { method: 'POST' })
      await fetch('/api/audit/sales?days=45', { method: 'POST' }).catch(() => null)

      // Vistoria de taxas vs tabela oficial (fatiada por anúncio, skip numérico)
      setProgress('Etapa 7/7 — Vistoria de taxas vs tabela oficial do ML…')
      for (let skip = 0; skip < 400; skip += 25) {
        const r = await fetch('/api/audit/fees', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: 4, limit: 25, skip }),
        }).then(x => x.ok ? x.json() : null).catch(() => null)
        if (!r?.ok || (r.remaining_items ?? 0) <= 0) break
      }

      setProgress('')
      setResult(`✓ Completo: ${resumo.join(' · ')} — margens, auditoria e vistoria de taxas atualizadas`)
      setStatus('done')
    } catch (err) {
      setProgress('')
      setResult(String(err instanceof Error ? err.message : err))
      setStatus('error')
    }
  }

  async function handleBackfill() {
    setBackStatus('running')
    setBackResult('')
    setBackProgress('Preparando janelas…')
    const chunks = buildBackfillChunks(180, 30)
    let totalSynced = 0
    for (let i = 0; i < chunks.length; i++) {
      const { from, to } = chunks[i]
      setBackProgress(`Janela ${i + 1}/${chunks.length} — ${from} a ${to}…`)
      try {
        const { synced, error } = await runSyncChunk(from, to)
        if (error) {
          setBackResult(`Erro na janela ${i + 1}: ${error}`)
          setBackStatus('error')
          return
        }
        totalSynced += synced
      } catch (err) {
        setBackResult(`Erro de conexão na janela ${i + 1}: ${String(err)}`)
        setBackStatus('error')
        return
      }
    }
    setBackProgress('')
    setBackResult(`✓ ${totalSynced} vendas importadas (6 meses) — rode a Sincronização completa depois para enriquecer`)
    setBackStatus('done')
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Sincronização completa ─────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={syncCompleto}
            disabled={isAnyRunning}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
            style={{
              background: status === 'running' ? B.bg : B.brand,
              color:      status === 'running' ? B.muted : 'white',
              border:     status === 'running' ? `1px solid ${B.border}` : 'none',
              cursor:     isAnyRunning ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={13} className={status === 'running' ? 'animate-spin' : ''} />
            {status === 'running' ? 'Sincronizando…' : 'Sincronização completa (3 dias)'}
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
        {status === 'running' && progress && (
          <div className="text-xs pl-1" style={{ color: B.muted }}>
            <Clock size={10} className="inline mr-1" />
            {progress} — não feche esta página
          </div>
        )}
      </div>

      {/* ── Backfill histórico (180 dias em janelas de 30d) ──── */}
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
            {backStatus === 'running' ? 'Importando histórico…' : 'Backfill histórico (180 dias, só vendas)'}
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
