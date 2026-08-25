/**
 * POST /api/sync/amazon/uf?limit=40
 *
 * UF de destino das vendas Amazon via getOrderAddress (StateOrRegion vem por
 * extenso → mapeia p/ sigla). A Amazon não manda o estado no pedido/nota que já
 * capturamos, e a API de endereço é limitada (~1/s), por isso vai em lote.
 */
import { NextRequest, NextResponse } from 'next/server'
import { amazonGet } from '@/lib/integrations/amazon'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const UF: Record<string, string> = { 'acre':'AC','alagoas':'AL','amapa':'AP','amazonas':'AM','bahia':'BA','ceara':'CE','distrito federal':'DF','espirito santo':'ES','goias':'GO','maranhao':'MA','mato grosso':'MT','mato grosso do sul':'MS','minas gerais':'MG','para':'PA','paraiba':'PB','parana':'PR','pernambuco':'PE','piaui':'PI','rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS','rondonia':'RO','roraima':'RR','santa catarina':'SC','sao paulo':'SP','sergipe':'SE','tocantins':'TO' }
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const toUF = (s?: string) => !s ? null : (s.length === 2 ? s.toUpperCase() : (UF[norm(s)] ?? null))

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 40)
  const db = createSupabaseServiceClient()

  const { data: rows } = await db.from('sales')
    .select('id, external_order_id')
    .eq('marketplace', 'amazon').is('uf_destino', null)
    .order('sale_date', { ascending: false }).limit(1500)

  const byOrder = new Map<string, string[]>()
  for (const r of rows ?? []) {
    const oid = r.external_order_id.replace(/^amz_/, '').split('_')[0]
    if (!byOrder.has(oid)) byOrder.set(oid, [])
    byOrder.get(oid)!.push(r.id)
  }

  let updated = 0, processed = 0
  for (const [oid, ids] of byOrder) {
    if (processed >= limit) break
    processed++
    let uf: string | null = null
    try {
      const r = await amazonGet<{ payload?: { ShippingAddress?: { StateOrRegion?: string } } }>(`/orders/v0/orders/${oid}/address`)
      uf = toUF(r.payload?.ShippingAddress?.StateOrRegion)
    } catch { /* rate-limit/erro: tenta na próxima rodada */ }
    if (uf) { for (const id of ids) await db.from('sales').update({ uf_destino: uf }).eq('id', id); updated++ }
    await sleep(700)
  }

  return NextResponse.json({ ok: true, processed, updated, remaining: byOrder.size - processed })
}
