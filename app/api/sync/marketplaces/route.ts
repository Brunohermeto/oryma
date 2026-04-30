import { NextRequest, NextResponse } from 'next/server'
import { syncMercadoLivre } from '@/lib/marketplace/sync-ml'
import { syncShopee } from '@/lib/marketplace/sync-shopee'
import { syncAmazon } from '@/lib/marketplace/sync-amazon'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  if (authCookie !== process.env.APP_PASSWORD && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const endDate = format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(), 90), 'yyyy-MM-dd')

  const results: Record<string, number | string> = {}

  for (const [name, syncFn, source] of [
    ['mercado_livre', syncMercadoLivre, 'mercado_livre'],
    ['shopee', syncShopee, 'shopee'],
    ['amazon', syncAmazon, 'amazon'],
  ] as const) {
    const { data: log } = await db.from('sync_logs').insert({
      source,
      sync_type: 'sales',
      status: 'running',
      started_at: new Date().toISOString(),
    }).select().single()

    try {
      const count = await syncFn(startDate, endDate)
      results[name] = count
      await db.from('sync_logs').update({
        status: 'success',
        records_synced: count,
        finished_at: new Date().toISOString(),
      }).eq('id', log.id)
    } catch (err) {
      results[name] = `error: ${String(err)}`
      await db.from('sync_logs').update({
        status: 'error',
        error_message: String(err),
        finished_at: new Date().toISOString(),
      }).eq('id', log.id)
    }
  }

  return NextResponse.json({ ok: true, ...results })
}
