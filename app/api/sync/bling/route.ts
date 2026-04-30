import { NextRequest, NextResponse } from 'next/server'
import { syncNFeEntrada } from '@/lib/bling/sync-nfe-entrada'
import { syncNFeSaida } from '@/lib/bling/sync-nfe-saida'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Allow manual trigger from dashboard (cookie auth) or cron (secret header)
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized =
    authCookie === process.env.APP_PASSWORD ||
    cronSecret === process.env.CRON_SECRET

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const now = new Date()
  const startDate = format(subDays(now, 90), 'yyyy-MM-dd')
  const endDate = format(now, 'yyyy-MM-dd')

  const { data: log } = await db.from('sync_logs').insert({
    source: 'bling',
    sync_type: 'nfe',
    status: 'running',
    started_at: now.toISOString(),
  }).select().single()

  try {
    const [entrada, saida] = await Promise.all([
      syncNFeEntrada(startDate, endDate),
      syncNFeSaida(startDate, endDate),
    ])

    await db.from('sync_logs').update({
      status: 'success',
      records_synced: entrada + saida,
      finished_at: new Date().toISOString(),
    }).eq('id', log.id)

    return NextResponse.json({ ok: true, nfe_entrada: entrada, nfe_saida: saida })
  } catch (err) {
    await db.from('sync_logs').update({
      status: 'error',
      error_message: String(err),
      finished_at: new Date().toISOString(),
    }).eq('id', log.id)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
