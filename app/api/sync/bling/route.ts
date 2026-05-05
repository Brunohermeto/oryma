import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { syncNFeEntrada } from '@/lib/bling/sync-nfe-entrada'
import { syncNFeSaida } from '@/lib/bling/sync-nfe-saida'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'  // São Paulo — próximo ao Bling BR, reduz latência de 1500ms → 200ms

export async function POST(request: NextRequest) {
  const authCookie  = request.cookies.get('mi_auth')?.value
  const cronSecret  = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD || cronSecret === process.env.CRON_SECRET

  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db       = createSupabaseServiceClient()
  const now      = new Date()
  const queryDays = request.nextUrl.searchParams.get('days')
  const isCron    = !!request.headers.get('x-cron-secret')
  const days      = queryDays ? Number(queryDays) : 1
  const startDate = format(subDays(now, days), 'yyyy-MM-dd')
  const endDate   = format(now, 'yyyy-MM-dd')

  // Cria log de sync
  const { data: log } = await db.from('sync_logs').insert({
    source: 'bling', sync_type: 'nfe', status: 'running', started_at: now.toISOString(),
  }).select().single()

  const syncId = log?.id

  // ── waitUntil: resposta imediata, sync em background ────────────────────────
  // Limite: Vercel Hobby tem ~10s de execução real.
  // Com 8 NF-e × (150ms sleep + 300ms XML + 200ms DB) = 5.2s → cabe nos 10s.
  // O botão fica girando e faz polling a cada 3s até receber 'success' ou 'error'.
  // ──────────────────────────────────────────────────────────────────────────────
  waitUntil((async () => {
    try {
      // Manual: 8 NF-e por rodada (cabe nos 10s do Vercel Hobby)
      // Cron:   50 NF-e (maioria já processada via skip de chaves vinculadas)
      const maxNFe = isCron ? 150 : 15
      const saida = await syncNFeSaida(startDate, endDate, maxNFe)

      let entrada = 0
      if (isCron) entrada = await syncNFeEntrada(startDate, endDate)

      await db.from('sync_logs').update({
        status: 'success',
        records_synced: entrada + saida,
        error_message: JSON.stringify({ nfe_entrada: entrada, nfe_saida: saida }),
        finished_at: new Date().toISOString(),
      }).eq('id', syncId)
    } catch (err) {
      await db.from('sync_logs').update({
        status: 'error',
        error_message: String(err),
        finished_at: new Date().toISOString(),
      }).eq('id', syncId)
    }
  })())

  return NextResponse.json({ ok: true, sync_id: syncId, message: 'Sincronização iniciada' })
}
