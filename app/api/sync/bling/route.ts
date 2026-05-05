import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { syncNFeEntrada } from '@/lib/bling/sync-nfe-entrada'
import { syncNFeSaida } from '@/lib/bling/sync-nfe-saida'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const authCookie  = request.cookies.get('mi_auth')?.value
  const cronSecret  = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD || cronSecret === process.env.CRON_SECRET

  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db       = createSupabaseServiceClient()
  const now      = new Date()
  // Cron passa ?days= calculado pelo sync incremental; botão manual usa 7 dias
  const queryDays = request.nextUrl.searchParams.get('days')
  const isCron    = !!request.headers.get('x-cron-secret')
  // Manual: 1 dia (300 NF-e/dia × 80ms ≈ 24s, cabe nos 60s)
  // Cron: usa ?days= calculado pelo sync incremental (1-2 dias normalmente)
  const days      = queryDays ? Number(queryDays) : 1
  const startDate = format(subDays(now, days), 'yyyy-MM-dd')
  const endDate   = format(now, 'yyyy-MM-dd')

  // Cria log de sync
  const { data: log } = await db.from('sync_logs').insert({
    source: 'bling', sync_type: 'nfe', status: 'running', started_at: now.toISOString(),
  }).select().single()

  const syncId = log?.id

  // Roda o sync de forma que não bloqueie a resposta
  // waitUntil garante execução mesmo após resposta enviada (suportado no Vercel)
  const syncWork = async () => {
    try {
      // NF-e saída: vincula impostos (PIS/COFINS/ICMS) às vendas
      // Manual: 100 NF-e por rodada (seguro dentro de 60s) — rode 3x para cobrir 300/dia
      // Cron: 500 NF-e (maioria já processada, skip rápido)
      const maxNFe = isCron ? 200 : 40
      const saida = await syncNFeSaida(startDate, endDate, maxNFe)

      // NF-e entrada (série 0, CFOP 3102): só executa no cron para não atrasar o manual
      let entrada = 0
      if (isCron) {
        entrada = await syncNFeEntrada(startDate, endDate)
      }

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
  }

  // waitUntil garante que o Vercel mantém a função viva até o sync terminar
  waitUntil(syncWork())

  // Responde imediatamente com o ID para o cliente fazer polling
  return NextResponse.json({ ok: true, sync_id: syncId, message: 'Sincronização iniciada em background' })
}
