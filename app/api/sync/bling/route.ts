import { NextRequest, NextResponse } from 'next/server'
import { syncNFeEntrada } from '@/lib/bling/sync-nfe-entrada'
import { syncNFeSaida } from '@/lib/bling/sync-nfe-saida'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'  // São Paulo — mesmo DC do Bling BR

export async function POST(request: NextRequest) {
  const authCookie  = request.cookies.get('mi_auth')?.value
  const cronSecret  = request.headers.get('x-cron-secret')
  // Aceita: cookie de auth manual OU cron-secret configurado OU cron sem secret (CRON_SECRET não configurado)
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')

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

  // ── SÍNCRONO: sem waitUntil — resposta enviada só após terminar ──────────
  // waitUntil não funciona neste ambiente (função morta antes do background rodar).
  // Com GRU1 + in-memory matching: 10 NF-e × ~350ms = 3.5s + 1s overhead = 4.5s
  // Botão fica girando ~5s e recebe resultado direto. Bem dentro dos 10s do Vercel.
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    // Manual: 10 NF-e (~4.5s) | Cron: 30 (skip de chaves vinculadas = muito rápido)
    const maxNFe = isCron ? 30 : 40
    const saida = await syncNFeSaida(startDate, endDate, maxNFe)

    let entrada = 0
    if (isCron) entrada = await syncNFeEntrada(startDate, endDate)

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
