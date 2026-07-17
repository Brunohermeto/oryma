import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

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
  // Aceita chamadas do Vercel Cron (com CRON_SECRET) OU chamadas internas autenticadas
  // Se CRON_SECRET não está configurado, Vercel envia um token gerado automaticamente;
  // nesse caso, aceitamos qualquer Authorization que contenha "Bearer " para não bloquear o cron.
  const authHeader = request.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Se CRON_SECRET não está configurado, aceita a chamada do Vercel sem verificação extra

  // Detecta a base URL: usa a variável de ambiente ou constrói a partir do host
  const host = request.headers.get('host') ?? 'localhost:3000'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`

  const headers = {
    'Content-Type': 'application/json',
    'x-cron-secret': cronSecret ?? 'internal',
  }

  // Calcula janela incremental por fonte
  const [blingDays, mpDays] = await Promise.all([
    getDaysToSync('bling'),
    getDaysToSync('marketplaces'),
  ])

  // Dispara os syncs com janela incremental.
  // Sequencial de propósito: invoices/billing dependem das vendas recém-sincronizadas.
  const [blRes, mpRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/sync/bling?days=${blingDays}`, { method: 'POST', headers }),
    fetch(`${baseUrl}/api/sync/marketplaces?days=${mpDays}`, { method: 'POST', headers }),
  ])

  // Enriquecimento ML: NF-e emitidas via ML (impostos das vendas Full)
  // e extrato de tarifas (rebates + Product Ads por venda)
  const [invRes, bilRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/sync/ml/invoices`, {
      method: 'POST', headers, body: JSON.stringify({ days: 7, limit: 25 }),
    }),
    fetch(`${baseUrl}/api/sync/ml/billing?days=7`, { method: 'POST', headers }),
  ])

  // Recalcula CMP + margem de todas as vendas com os dados recém-enriquecidos
  const rlRes = await Promise.allSettled([
    fetch(`${baseUrl}/api/landed-cost/relink`, { method: 'POST', headers }),
  ]).then(r => r[0])

  return NextResponse.json({
    ok: true,
    bling:        { status: blRes.status === 'fulfilled' ? 'triggered' : 'failed', days: blingDays },
    marketplaces: { status: mpRes.status === 'fulfilled' ? 'triggered' : 'failed', days: mpDays },
    ml_invoices:  { status: invRes.status === 'fulfilled' ? 'triggered' : 'failed' },
    ml_billing:   { status: bilRes.status === 'fulfilled' ? 'triggered' : 'failed' },
    relink:       { status: rlRes.status === 'fulfilled' ? 'triggered' : 'failed' },
  })
}
