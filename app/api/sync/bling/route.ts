import { NextRequest, NextResponse } from 'next/server'
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

  // ── Executa SINCRONAMENTE (sem waitUntil) ──────────────────────────────────
  // waitUntil causava morte silenciosa do processo sem atualizar o sync_log.
  // Com await, a resposta só é enviada após o sync terminar.
  // 20 NF-e × ~700ms = ~15s — confortável dentro dos 60s do Vercel.
  // ──────────────────────────────────────────────────────────────────────────
  try {
    // Manual: 20 NF-e por rodada | Cron: 100 (maioria já processada via skip)
    const maxNFe = isCron ? 100 : 20
    const saida = await syncNFeSaida(startDate, endDate, maxNFe)

    // NF-e entrada só no cron (não atrasa o sync manual)
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

    return NextResponse.json({ ok: true, sync_id: syncId, saida, entrada })
  } catch (err) {
    await db.from('sync_logs').update({
      status: 'error',
      error_message: String(err),
      finished_at: new Date().toISOString(),
    }).eq('id', syncId)

    return NextResponse.json({ ok: true, sync_id: syncId })
  }
}
