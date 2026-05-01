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

  // Parseia resultados por canal
  let channelResults: Record<string, number | string> = {}
  try {
    if (log.error_message) {
      channelResults = JSON.parse(log.error_message)
    }
  } catch {}

  return NextResponse.json({
    status: log.status,
    records_synced: log.records_synced,
    finished_at: log.finished_at,
    channels: channelResults,
    // Se há erros específicos por canal
    errors: Object.fromEntries(
      Object.entries(channelResults)
        .filter(([, v]) => typeof v === 'string' && v.startsWith('error:'))
    ),
  })
}
