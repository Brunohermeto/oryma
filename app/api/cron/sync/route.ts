import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

// Retorna quantos dias atrás buscar, baseado no último sync bem-sucedido
// Se nunca sincronizou → 90 dias (carga inicial, pode ser lento)
// Se sincronizou recentemente → overlap de 2 dias (rápido, garante sem lacunas)
async function getDaysToSync(source: string): Promise<number> {
  const db = createSupabaseServiceClient()
  const { data: lastLog } = await db
    .from('sync_logs')
    .select('finished_at')
    .eq('source', source)
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(1)
    .single()

  if (!lastLog?.finished_at) return 90 // nunca sincronizou

  const hoursAgo = (Date.now() - new Date(lastLog.finished_at).getTime()) / (1000 * 60 * 60)

  if (hoursAgo < 6)   return 1   // sincronizou há menos de 6h: pega só hoje
  if (hoursAgo < 48)  return 2   // sincronizou nas últimas 48h: 2 dias de overlap
  if (hoursAgo < 168) return 7   // sincronizou na última semana: 7 dias
  return 30                       // mais de 1 semana: 30 dias
}

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const headers = {
    'Content-Type': 'application/json',
    'x-cron-secret': process.env.CRON_SECRET!,
  }

  // Calcula janela incremental por fonte
  const [blingDays, mpDays] = await Promise.all([
    getDaysToSync('bling'),
    getDaysToSync('marketplaces'),
  ])

  // Dispara os syncs com janela incremental
  const [blRes, mpRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/sync/bling?days=${blingDays}`, { method: 'POST', headers }),
    fetch(`${baseUrl}/api/sync/marketplaces?days=${mpDays}`, { method: 'POST', headers }),
  ])

  return NextResponse.json({
    ok: true,
    bling:       { status: blRes.status === 'fulfilled' ? 'triggered' : 'failed', days: blingDays },
    marketplaces: { status: mpRes.status === 'fulfilled' ? 'triggered' : 'failed', days: mpDays },
  })
}
