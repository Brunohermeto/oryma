import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { syncMercadoLivre } from '@/lib/marketplace/sync-ml'
import { syncShopee } from '@/lib/marketplace/sync-shopee'
import { syncAmazon } from '@/lib/marketplace/sync-amazon'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilToday, brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const authCookie  = request.cookies.get('mi_auth')?.value
  const cronSecret  = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD || cronSecret === process.env.CRON_SECRET
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db    = createSupabaseServiceClient()
  const isCron    = !!cronSecret
  const queryDays = request.nextUrl.searchParams.get('days')
  const days      = queryDays ? Number(queryDays) : 7  // manual = 7 dias para não perder pedidos criados antes mas pagos hoje
  // Usa fuso Brasil (UTC-3) para que o período reflita dias corretos para o usuário
  const endDate   = brazilToday()
  const startDate = brazilDaysAgo(days)

  // Cria log de sync — sem error_message inicial para evitar conflito
  const { data: log, error: logError } = await db.from('sync_logs').insert({
    source: 'marketplaces',
    sync_type: 'sales',
    status: 'running',
    started_at: now.toISOString(),
  }).select('id').single()

  if (logError || !log?.id) {
    return NextResponse.json({ error: `Falha ao criar log de sync: ${logError?.message ?? 'id nulo'}` }, { status: 500 })
  }

  const syncId = log.id

  // Frete agora vem da NF-e saída (campo vFrete no XML) — não precisa chamar API de shipments
  // fetchShipmentCosts: false poupa tempo e evita timeout
  const mlSync = (s: string, e: string) =>
    syncMercadoLivre(s, e, { fetchShipmentCosts: false })

  const syncFns: Record<string, (s: string, e: string) => Promise<number>> = {
    mercado_livre: mlSync,
    shopee:        syncShopee,
    amazon:        syncAmazon,
  }

  const syncWork = async () => {
    const results: Record<string, number | string> = {}
    let totalSynced = 0

    for (const [channel, fn] of Object.entries(syncFns)) {
      try {
        const count = await fn(startDate, endDate)
        results[channel] = count
        totalSynced += count
      } catch (err) {
        results[channel] = `error: ${String(err)}`
      }
    }

    // hasError = true se ALGUM canal configurado falhou (não só se todos falharam)
    const hasError = Object.values(results).some(v => typeof v === 'string' && v.startsWith('error:'))

    await db.from('sync_logs').update({
      status: hasError ? 'error' : 'success',
      records_synced: totalSynced,
      error_message: JSON.stringify(results),
      finished_at: new Date().toISOString(),
    }).eq('id', syncId)
  }

  waitUntil(syncWork())

  return NextResponse.json({ ok: true, sync_id: syncId, message: 'Sincronização iniciada em background' })
}
