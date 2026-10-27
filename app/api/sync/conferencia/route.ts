/**
 * GET /api/sync/conferencia?canal=shopee&dia=AAAA-MM-DD
 * Conferência de completude (pedido do Bruno 27/10/2026): lista os pedidos
 * VÁLIDOS do dia direto no marketplace (mesmos filtros de status do sync) e diz
 * quais NÃO estão no Oryma. O ciclo diário re-sincroniza o dia enquanto faltar
 * pedido e acusa erro se continuar faltando. Origem: 10/10 (pico de 104 pedidos
 * na Shopee) ficou pela metade sem ninguém perceber.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { shopeeGet } from '@/lib/integrations/shopee'
import { amazonGet } from '@/lib/integrations/amazon'
import { magaluGet } from '@/lib/integrations/magalu'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { toBrazilDate } from '@/lib/utils/brazil-time'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const PREFIXO: Record<string, string> = { mercado_livre: 'ml', shopee: 'shopee', amazon: 'amz', magalu: 'magalu' }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function pedidosDoCanal(canal: string, dia: string): Promise<string[]> {
  const ini = new Date(`${dia}T00:00:00-03:00`), fim = new Date(ini.getTime() + 864e5 - 1000)
  const ids: string[] = []
  if (canal === 'mercado_livre') {
    const seller = await getMercadoLivreSellerId()
    for (let offset = 0; offset < 3000; offset += 50) {
      const r = await mlGet<{ results?: Array<{ id: number }> }>('/orders/search', {
        seller: String(seller), 'order.status': 'paid', limit: '50', offset: String(offset), sort: 'date_asc',
        'order.date_created.from': `${dia}T00:00:00.000-03:00`, 'order.date_created.to': `${dia}T23:59:59.000-03:00`,
      })
      ids.push(...(r.results ?? []).map(o => String(o.id)))
      if ((r.results ?? []).length < 50) break
    }
  } else if (canal === 'shopee') {
    let cursor = ''
    for (let i = 0; i < 40; i++) {
      const r = await shopeeGet<{ response?: { order_list?: Array<{ order_sn: string; order_status?: string }>; more?: boolean; next_cursor?: string } }>(
        '/order/get_order_list', { time_range_field: 'create_time', time_from: String(Math.floor(ini.getTime() / 1000)),
          time_to: String(Math.floor(fim.getTime() / 1000)), page_size: '100', response_optional_fields: 'order_status', ...(cursor ? { cursor } : {}) })
      for (const o of r.response?.order_list ?? [])
        if (!['CANCELLED', 'UNPAID', 'IN_CANCEL'].includes(o.order_status ?? '')) ids.push(o.order_sn)
      if (!r.response?.more) break
      cursor = r.response.next_cursor ?? ''
    }
  } else if (canal === 'amazon') {
    let next: string | undefined
    const antes = new Date(Math.min(fim.getTime(), Date.now() - 5 * 60_000)).toISOString().replace(/\.\d{3}Z$/, 'Z')
    for (let i = 0; i < 20; i++) {
      type Resp = { payload?: { Orders?: Array<{ AmazonOrderId: string; OrderStatus: string }>; NextToken?: string } }
      const params: Record<string, string> = next ? { MarketplaceIds: 'A2Q3Y263D00KWC', NextToken: next }
        : { MarketplaceIds: 'A2Q3Y263D00KWC', CreatedAfter: ini.toISOString().replace(/\.\d{3}Z$/, 'Z'), CreatedBefore: antes, MaxResultsPerPage: '100' }
      // getOrders aceita ~1 chamada/min em rajada: 429 → espera e tenta de novo
      let r: Resp | undefined
      for (let t = 0; t < 4 && !r; t++) {
        try { r = await amazonGet<Resp>('/orders/v0/orders', params) }
        catch (e) { if (!String(e).includes('429') || t === 3) throw e; await sleep(8000 * (t + 1)) }
      }
      if (!r) break
      for (const o of r.payload?.Orders ?? []) if (!['Canceled', 'Pending'].includes(o.OrderStatus)) ids.push(o.AmazonOrderId)
      next = r.payload?.NextToken
      if (!next) break
      await sleep(1000)
    }
  } else if (canal === 'magalu') {
    outer: for (let offset = 0; offset < 4000; offset += 50) {
      const r = await magaluGet<{ results?: Array<{ code: string; status: string; purchased_at: string }> }>('/seller/v1/orders',
        { _limit: '50', _offset: String(offset), _sort: 'purchased_at:desc' })
      const lista = r.results ?? []
      if (!lista.length) break
      for (const o of lista) {
        const d = toBrazilDate(o.purchased_at)
        if (d > dia) continue
        if (d < dia) break outer
        if (!['cancelled', 'new', 'pending_payment'].includes(o.status)) ids.push(o.code)
      }
    }
  }
  return [...new Set(ids)]
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const canal = request.nextUrl.searchParams.get('canal') ?? ''
  const dia = request.nextUrl.searchParams.get('dia') ?? ''
  if (!PREFIXO[canal] || !/^\d{4}-\d{2}-\d{2}$/.test(dia))
    return NextResponse.json({ error: 'canal e dia (AAAA-MM-DD) obrigatórios' }, { status: 400 })

  let noCanal: string[]
  try { noCanal = await pedidosDoCanal(canal, dia) }
  catch (e) { return NextResponse.json({ error: `não consegui listar os pedidos do canal: ${String(e).slice(0, 160)}` }, { status: 502 }) }

  // pedidos do Oryma no dia ±1 (sale_date pode cair no dia vizinho por fuso)
  const viz = (n: number) => new Date(new Date(`${dia}T12:00:00`).getTime() + n * 864e5).toISOString().slice(0, 10)
  const db = createSupabaseServiceClient()
  const rows = await fetchAll<{ external_order_id: string }>(() => db.from('sales').select('external_order_id')
    .eq('marketplace', canal).gte('sale_date', viz(-1)).lte('sale_date', viz(1)).order('id'))
  const p = PREFIXO[canal] + '_'
  const noOryma = new Set(rows.map(r => r.external_order_id.slice(p.length).split('_')[0]))
  const faltando = noCanal.filter(id => !noOryma.has(id))
  return NextResponse.json({ canal, dia, no_canal: noCanal.length, faltando: faltando.length, pedidos_faltando: faltando.slice(0, 50) })
}
