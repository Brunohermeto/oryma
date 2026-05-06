import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // 1. Contagem de vendas por marketplace
  const { data: salesByMarketplace } = await db
    .from('sales')
    .select('marketplace, sale_date, nfe_saida_key')
    .order('sale_date', { ascending: false })
    .limit(500)

  const summary: Record<string, { total: number; com_nfe: number; mais_recente: string | null; mais_antiga: string | null }> = {}
  for (const s of (salesByMarketplace ?? [])) {
    const mp = s.marketplace ?? 'unknown'
    if (!summary[mp]) summary[mp] = { total: 0, com_nfe: 0, mais_recente: null, mais_antiga: null }
    summary[mp].total++
    if (s.nfe_saida_key) summary[mp].com_nfe++
    if (!summary[mp].mais_recente || s.sale_date > summary[mp].mais_recente!) summary[mp].mais_recente = s.sale_date
    if (!summary[mp].mais_antiga || s.sale_date < summary[mp].mais_antiga!) summary[mp].mais_antiga = s.sale_date
  }

  // 2. Últimas 5 vendas do ML para ver o formato do external_order_id
  const { data: mlSamples } = await db
    .from('sales')
    .select('id, external_order_id, sale_date, gross_price, nfe_saida_key')
    .eq('marketplace', 'mercado_livre')
    .order('sale_date', { ascending: false })
    .limit(5)

  // 3. Total geral
  const { count: totalSales } = await db
    .from('sales')
    .select('*', { count: 'exact', head: true })

  // 4. Vendas sem NF-e (candidatas para matching)
  const { count: semNfe } = await db
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .is('nfe_saida_key', null)

  // 5. Sync logs recentes
  const { data: recentLogs } = await db
    .from('sync_logs')
    .select('source, status, records_synced, error_message, started_at, finished_at')
    .order('started_at', { ascending: false })
    .limit(10)

  return NextResponse.json({
    total_sales: totalSales,
    sem_nfe: semNfe,
    por_marketplace: summary,
    ml_amostras: mlSamples ?? [],
    sync_logs_recentes: recentLogs ?? [],
  })
}
