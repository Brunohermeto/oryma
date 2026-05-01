import { NextRequest, NextResponse } from 'next/server'
import { syncMercadoLivre } from '@/lib/marketplace/sync-ml'
import { syncShopee } from '@/lib/marketplace/sync-shopee'
import { syncAmazon } from '@/lib/marketplace/sync-amazon'
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
  const endDate   = format(now, 'yyyy-MM-dd')
  const startDate = format(subDays(now, 90), 'yyyy-MM-dd')

  // Body pode especificar quais marketplaces sincronizar
  let channels: string[] = ['mercado_livre', 'shopee', 'amazon']
  try {
    const body = await request.json()
    if (Array.isArray(body.channels)) channels = body.channels
  } catch {}

  // Cria log de sync
  const { data: log } = await db.from('sync_logs').insert({
    source: 'marketplaces',
    sync_type: 'sales',
    status: 'running',
    started_at: now.toISOString(),
    error_message: JSON.stringify({ channels }),
  }).select().single()

  const syncId = log?.id

  // Mapa de funções por canal
  const syncFns: Record<string, (s: string, e: string) => Promise<number>> = {
    mercado_livre: syncMercadoLivre,
    shopee: syncShopee,
    amazon: syncAmazon,
  }

  // Roda em background — não bloqueia a resposta
  const syncWork = async () => {
    const results: Record<string, number | string> = {}
    let totalSynced = 0

    for (const channel of channels) {
      const fn = syncFns[channel]
      if (!fn) continue
      try {
        const count = await fn(startDate, endDate)
        results[channel] = count
        totalSynced += count
      } catch (err) {
        results[channel] = `error: ${String(err)}`
      }
    }

    const hasError = Object.values(results).some(v => typeof v === 'string' && v.startsWith('error:'))

    await db.from('sync_logs').update({
      status: hasError && totalSynced === 0 ? 'error' : 'success',
      records_synced: totalSynced,
      error_message: JSON.stringify(results),
      finished_at: new Date().toISOString(),
    }).eq('id', syncId)
  }

  // Fire-and-forget: responde imediatamente
  syncWork()

  return NextResponse.json({ ok: true, sync_id: syncId, message: 'Sincronização iniciada em background' })
}
