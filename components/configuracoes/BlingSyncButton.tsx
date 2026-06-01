'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, Zap, Package, FileText } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const B = {
  brand:  '#125BFF',
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  bg:     'oklch(0.96 0.010 258)',
}

/**
 * Arquitetura em duas fases (Vercel Hobby — limite ~10s por função):
 *
 * Fase 1 — /api/sync/bling/start (~500ms)
 *   Cria sync_log + lista NF-e pendentes do Bling. Sem XML.
 *
 * Fase 2 — /api/sync/bling/process (1 chamada por NF-e, ~400ms cada)
 *   Baixa 1 XML + vincula à venda. Nunca estoura o timeout.
 *
 * Cada chamada individual cabe facilmente nos 10s. O browser orquestra
 * todas as chamadas em sequência e mostra o progresso em tempo real.
 */
interface NFeDebug {
  numeroPedidoLoja?: string | null
  canal_xml?: string
  vNF?: number
  dhEmi?: string
}

export function BlingSyncButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')
  const [progress, setProgress] = useState('')
  const [debugSample, setDebugSample] = useState<NFeDebug | null>(null)
  const [firstReason, setFirstReason] = useState<string | null>(null)

  async function handleSync() {
    setStatus('running')
    setResult('')
    setProgress('')
    setDebugSample(null)
    setFirstReason(null)

    // Janelas de 30 dias cobrindo os últimos 180 dias
    // Começa pelo mais recente (mais provável de ter match)
    const WINDOWS = [
      { label: '0-30 dias',   daysFrom: 0,   daysTo: 30  },
      { label: '30-60 dias',  daysFrom: 30,  daysTo: 60  },
      { label: '60-90 dias',  daysFrom: 60,  daysTo: 90  },
      { label: '90-120 dias', daysFrom: 90,  daysTo: 120 },
      { label: '120-150 dias',daysFrom: 120, daysTo: 150 },
      { label: '150-180 dias',daysFrom: 150, daysTo: 180 },
    ]

    let totalSynced = 0
    let lastSyncId: string | null = null

    // Rastreia chaves já tentadas para não repetir na mesma sessão
    const attemptedChaves = new Set<string>()

    try {
      for (let w = 0; w < WINDOWS.length; w++) {
        const win = WINDOWS[w]
        setProgress(`Janela ${w + 1}/${WINDOWS.length}: ${win.label}…`)

        let batchSynced = 0
        let hasMore     = true

        // Dentro de cada janela, processa em lotes até não restar nada
        while (hasMore) {
          const skipParam = Array.from(attemptedChaves).join(',')
          const url = `/api/sync/bling/start?daysFrom=${win.daysFrom}&daysTo=${win.daysTo}&limit=50${skipParam ? `&skip=${encodeURIComponent(skipParam)}` : ''}`

          const startRes = await fetch(url, { method: 'POST' })
          if (!startRes.ok) {
            const err = await startRes.json().catch(() => ({}))
            throw new Error(err.error ?? `HTTP ${startRes.status}`)
          }

          const { sync_id, pending } = await startRes.json() as {
            sync_id: string
            pending: Array<{ id: number; chaveAcesso: string | null }>
          }
          lastSyncId = sync_id

          if (!pending?.length) {
            hasMore = false
            break
          }

          // Processa cada NF-e do lote
          let matchedInBatch = 0
          for (let i = 0; i < pending.length; i++) {
            const nfe = pending[i]
            setProgress(`Janela ${w + 1}/${WINDOWS.length} (${win.label}) — NF-e ${i + 1}/${pending.length} · ${totalSynced + batchSynced} vinculadas`)

            if (nfe.chaveAcesso) attemptedChaves.add(nfe.chaveAcesso)

            const res = await fetch('/api/sync/bling/process', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nfe_id: nfe.id, nfe_chave_acesso: nfe.chaveAcesso }),
            })

            if (res.ok) {
              const data = await res.json()
              if (data.matched) { batchSynced++; matchedInBatch++ }
              else {
                if (!firstReason) setFirstReason(data.reason ?? 'unknown')
                if (data.debug && !debugSample) setDebugSample(data.debug as NFeDebug)
              }
            }
          }

          // Para de tentar esta janela se não houve nenhum match (todos já falharam)
          if (matchedInBatch === 0 && pending.length < 50) hasMore = false
          else if (pending.length < 50) hasMore = false
        }

        totalSynced += batchSynced
      }

      // Fecha o último sync_log
      if (lastSyncId) {
        const db = createSupabaseBrowserClient()
        await db.from('sync_logs').update({
          status: 'success',
          records_synced: totalSynced,
          error_message: JSON.stringify({ nfe_entrada: 0, nfe_saida: totalSynced }),
          finished_at: new Date().toISOString(),
        }).eq('id', lastSyncId)
      }

      setResult(`✓ ${totalSynced} NF-e saída vinculadas (180 dias varridos)`)
      setStatus('done')
    } catch (err) {
      setResult(`Erro: ${String(err).replace('Error: ', '')}`)
      setStatus('error')
    }

    setProgress('')
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── NF-e saída (vincular a vendas) ─────────────────── */}
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
          {status === 'running' ? 'Sincronizando…' : 'Sincronizar NF-e Saída'}
        </button>

        {status === 'running' && progress && (
          <span className="text-sm" style={{ color: B.muted }}>{progress}</span>
        )}

        {status === 'done' && (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
              <CheckCircle size={13} /> {result}
            </span>
            {(firstReason || debugSample) && (
              <div className="text-xs rounded p-2 max-w-lg" style={{ background: 'oklch(0.97 0.01 258)', color: B.muted, fontFamily: 'monospace' }}>
                {firstReason && <div><b>motivo:</b> {firstReason}</div>}
                {debugSample && <>
                  <div><b>numeroPedidoLoja:</b> {debugSample.numeroPedidoLoja ?? '(vazio)'}</div>
                  <div><b>infCpl (XML):</b> {debugSample.canal_xml || '(vazio)'}</div>
                  <div><b>valor NF:</b> R$ {debugSample.vNF} | <b>data:</b> {debugSample.dhEmi}</div>
                </>}
              </div>
            )}
          </div>
        )}

        {status === 'error' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
            <XCircle size={13} /> {result}
          </span>
        )}
      </div>

      {/* ── Re-extrair impostos ─────────────────────────────── */}
      <RetaxButton />

      {/* ── Importar produtos do Bling ──────────────────────── */}
      <ProductsSyncButton />

      {/* ── NF-e de entrada (importações/compras) ───────────── */}
      <NFeEntradaButton />
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function RetaxButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')

  async function handleRetax() {
    setStatus('running')
    setResult('')
    try {
      const res  = await fetch('/api/sync/bling/retax', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setResult(data.updated === 0
          ? '✓ Nenhuma NF-e com impostos pendentes'
          : `✓ Impostos atualizados em ${data.updated} NF-e`)
        setStatus('done')
      } else throw new Error(data.error ?? 'Erro desconhecido')
    } catch (err) {
      setResult(`Erro: ${String(err).replace('Error: ', '')}`)
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleRetax}
        disabled={status === 'running'}
        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
        style={{
          background: B.bg,
          color:      status === 'running' ? B.muted : B.brand,
          border:     `1px solid ${B.border}`,
          cursor:     status === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        <Zap size={11} className={status === 'running' ? 'animate-pulse' : ''} />
        {status === 'running' ? 'Atualizando impostos…' : 'Re-extrair impostos das NF-e vinculadas'}
      </button>
      {status === 'done' && (
        <span className="flex items-center gap-1 text-xs" style={{ color: '#16a34a' }}>
          <CheckCircle size={11} />{result}
        </span>
      )}
      {status === 'error' && (
        <span className="text-xs" style={{ color: '#dc2626' }}>{result}</span>
      )}
    </div>
  )
}

function ProductsSyncButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')

  async function handleSync() {
    setStatus('running')
    setResult('')
    try {
      const res  = await fetch('/api/sync/bling/products', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setResult(`✓ ${data.synced} produto${data.synced !== 1 ? 's' : ''} importados do Bling`)
        setStatus('done')
      } else throw new Error(data.error ?? 'Erro desconhecido')
    } catch (err) {
      setResult(`Erro: ${String(err).replace('Error: ', '')}`)
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={status === 'running'}
        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
        style={{
          background: B.bg,
          color:      status === 'running' ? B.muted : B.brand,
          border:     `1px solid ${B.border}`,
          cursor:     status === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        <Package size={11} className={status === 'running' ? 'animate-pulse' : ''} />
        {status === 'running' ? 'Importando produtos…' : 'Importar produtos do Bling (SKU + estoque)'}
      </button>
      {status === 'done' && (
        <span className="flex items-center gap-1 text-xs" style={{ color: '#16a34a' }}>
          <CheckCircle size={11} />{result}
        </span>
      )}
      {status === 'error' && (
        <span className="text-xs" style={{ color: '#dc2626' }}>{result}</span>
      )}
    </div>
  )
}

function NFeEntradaButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')

  async function handleSync() {
    setStatus('running')
    setResult('')
    try {
      const res  = await fetch('/api/sync/bling/nfe-entrada?days=180', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        const skippedMsg = data.skipped_already_imported > 0
          ? ` (${data.skipped_already_imported} já importadas)`
          : ''
        setResult(`✓ ${data.synced} NF-e de entrada importadas${skippedMsg}`)
        setStatus('done')
      } else throw new Error(data.error ?? 'Erro desconhecido')
    } catch (err) {
      setResult(`Erro: ${String(err).replace('Error: ', '')}`)
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={status === 'running'}
        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
        style={{
          background: B.bg,
          color:      status === 'running' ? B.muted : B.brand,
          border:     `1px solid ${B.border}`,
          cursor:     status === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        <FileText size={11} className={status === 'running' ? 'animate-pulse' : ''} />
        {status === 'running' ? 'Importando NF-e entrada…' : 'Importar NF-e de entrada do Bling (180 dias)'}
      </button>
      {status === 'done' && (
        <span className="flex items-center gap-1 text-xs" style={{ color: '#16a34a' }}>
          <CheckCircle size={11} />{result}
        </span>
      )}
      {status === 'error' && (
        <span className="text-xs" style={{ color: '#dc2626' }}>{result}</span>
      )}
    </div>
  )
}
