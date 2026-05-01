import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = createSupabaseServiceClient()
  const { data: log } = await db
    .from('sync_logs')
    .select('status, records_synced, error_message, finished_at, started_at')
    .eq('id', id)
    .single()

  if (!log) return NextResponse.json({ status: 'not_found' }, { status: 404 })

  // Se está "running" há mais de 90s, provavelmente atingiu o timeout do Vercel
  let status = log.status
  if (status === 'running' && log.started_at) {
    const elapsed = Date.now() - new Date(log.started_at).getTime()
    if (elapsed > 90_000) {
      status = 'error'
      // Marca como erro no banco para não ficar preso
      await db.from('sync_logs').update({
        status: 'error',
        error_message: 'Timeout: sincronização excedeu o limite de tempo. Tente novamente.',
        finished_at: new Date().toISOString(),
      }).eq('id', id)
    }
  }

  let extra: Record<string, number> = {}
  try {
    if (log.error_message && log.status === 'success') {
      extra = JSON.parse(log.error_message)
    }
  } catch {}

  return NextResponse.json({
    status,
    records_synced: log.records_synced,
    finished_at: log.finished_at,
    nfe_entrada: extra.nfe_entrada,
    nfe_saida: extra.nfe_saida,
    error_message: status === 'error'
      ? (log.status === 'error' ? log.error_message : 'Timeout: sincronização excedeu o limite de tempo. Tente novamente.')
      : undefined,
  })
}
