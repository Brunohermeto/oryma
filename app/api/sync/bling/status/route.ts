import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = createSupabaseServiceClient()
  const { data: log } = await db
    .from('sync_logs')
    .select('status, records_synced, error_message, finished_at')
    .eq('id', id)
    .single()

  if (!log) return NextResponse.json({ status: 'not_found' }, { status: 404 })

  // Parseia o error_message que pode conter { nfe_entrada, nfe_saida }
  let extra: Record<string, number> = {}
  try {
    if (log.error_message && log.status === 'success') {
      extra = JSON.parse(log.error_message)
    }
  } catch {}

  return NextResponse.json({
    status: log.status,
    records_synced: log.records_synced,
    finished_at: log.finished_at,
    nfe_entrada: extra.nfe_entrada,
    nfe_saida: extra.nfe_saida,
    error_message: log.status === 'error' ? log.error_message : undefined,
  })
}
