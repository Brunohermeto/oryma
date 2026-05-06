'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'
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
  infCpl: string
  canal: string | null
  numeroPedido: string | null
  vNF: number
  dhEmi: string
}

export function BlingSyncButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')
  const [progress, setProgress] = useState('')
  const [debugSample, setDebugSample] = useState<NFeDebug | null>(null)

  async function handleSync() {
    setStatus('running')
    setResult('')
    setProgress('Carregando lista de NF-e...')
    setDebugSample(null)

    try {
      // ── Fase 1: pega a lista de NF-e pendentes ────────────────────────
      const startRes = await fetch('/api/sync/bling/start?days=30&limit=100', { method: 'POST' })
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${startRes.status}`)
      }
      const { sync_id, pending } = await startRes.json() as {
        sync_id: string
        pending: Array<{ id: number; chaveAcesso: string | null }>
      }

      if (!pending || pending.length === 0) {
        // Nada a processar — marca como sucesso
        const db = createSupabaseBrowserClient()
        await db.from('sync_logs').update({
          status: 'success', records_synced: 0,
          error_message: JSON.stringify({ nfe_entrada: 0, nfe_saida: 0 }),
          finished_at: new Date().toISOString(),
        }).eq('id', sync_id)
        setResult('✓ 0 NF-e novas (tudo já sincronizado)')
        setStatus('done')
        return
      }

      // ── Fase 2: processa cada NF-e individualmente ───────────────────
      let synced = 0
      for (let i = 0; i < pending.length; i++) {
        const nfe = pending[i]
        setProgress(`Processando ${i + 1} de ${pending.length}...`)

        const res = await fetch('/api/sync/bling/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nfe_id: nfe.id, nfe_chave_acesso: nfe.chaveAcesso }),
        })

        if (res.ok) {
          const data = await res.json()
          if (data.matched) synced++
          // Captura primeiro debug disponível para mostrar na UI
          if (!data.matched && data.debug && !debugSample) {
            setDebugSample(data.debug as NFeDebug)
          }
        }
        // Se der erro numa NF-e específica, continua para a próxima
      }

      // ── Fase 3: fecha o sync_log ──────────────────────────────────────
      const db = createSupabaseBrowserClient()
      await db.from('sync_logs').update({
        status: 'success',
        records_synced: synced,
        error_message: JSON.stringify({ nfe_entrada: 0, nfe_saida: synced }),
        finished_at: new Date().toISOString(),
      }).eq('id', sync_id)

      setResult(`✓ ${synced} NF-e saída vinculadas (de ${pending.length} processadas)`)
      setStatus('done')
    } catch (err) {
      setResult(`Erro: ${String(err).replace('Error: ', '')}`)
      setStatus('error')
    }

    setProgress('')
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
        {status === 'running' ? 'Sincronizando…' : 'Sincronizar NF-e Bling'}
      </button>

      {status === 'running' && progress && (
        <span className="text-sm" style={{ color: B.muted }}>{progress}</span>
      )}

      {status === 'done' && (
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
            <CheckCircle size={13} />
            {result}
          </span>
          {debugSample && (
            <div className="text-xs rounded p-2 max-w-lg" style={{ background: 'oklch(0.97 0.01 258)', color: B.muted, fontFamily: 'monospace' }}>
              <div><b>infCpl:</b> {debugSample.infCpl || '(vazio)'}</div>
              <div><b>canal:</b> {debugSample.canal ?? '(não encontrado)'}</div>
              <div><b>pedido:</b> {debugSample.numeroPedido ?? '(não encontrado)'}</div>
              <div><b>valor NF:</b> R$ {debugSample.vNF} | <b>data:</b> {debugSample.dhEmi}</div>
            </div>
          )}
        </div>
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
