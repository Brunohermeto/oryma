/**
 * POST /api/sync/cancellations?days=30
 *
 * Cancelamentos do Mercado Livre e da Magalu → sales.cancellation.
 * Auditoria 22/09/2026: só Shopee (returns) e Amazon (fees) gravavam devolução;
 * uma venda ML/Magalu paga e depois cancelada ficava com o bruto cheio no
 * faturamento e na margem. Cancelamento INTEGRAL: cancellation = gross_price
 * (isReturned → sai de faturamento/margem; relink deixa a margem NULL).
 * Devolução pós-entrega do ML (claim "returns" concluída) também cai aqui: o ML
 * muda o pedido para status "cancelled" e estorna o pagamento (verificado 28/09).
 * Como isso acontece semanas depois da compra, o ciclo diário olha 90 dias.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { magaluGet } from '@/lib/integrations/magalu'
import { shopeeGet } from '@/lib/integrations/shopee'
import { getCredential } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilToday, brazilDaysAgo, toBrazilDate } from '@/lib/utils/brazil-time'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ?days=N (relativo) ou ?from=YYYY-MM-DD&to=YYYY-MM-DD (backfill por mês —
  // 9 meses numa chamada só estoura os 60s)
  const days = Number(request.nextUrl.searchParams.get('days') ?? 30)
  const startDate = request.nextUrl.searchParams.get('from') ?? brazilDaysAgo(days)
  const endDate = request.nextUrl.searchParams.get('to') ?? brazilToday()
  const db = createSupabaseServiceClient()

  // Marca todos os itens do pedido como cancelados (integral); idempotente
  const cancelar = async (prefixo: string, pedido: string) => {
    const { data: sales } = await db.from('sales').select('id, gross_price, cancellation')
      .like('external_order_id', `${prefixo}_${pedido}_%`)
    let n = 0
    for (const s of sales ?? []) {
      const gross = Number(s.gross_price)
      if (gross <= 0 || Number(s.cancellation ?? 0) >= gross - 0.01) continue
      const { error } = await db.from('sales').update({ cancellation: gross }).eq('id', s.id)
      if (!error) n++
    }
    return n
  }

  const out: Record<string, number | string> = {}

  // ── Mercado Livre: pedidos com status cancelled criados na janela ──
  try {
    const sellerId = await getMercadoLivreSellerId()
    if (!sellerId) throw new Error('sem seller_id')
    let listados = 0, marcados = 0
    for (let offset = 0; offset < 5000; offset += 50) {
      const res = await mlGet<{ results?: Array<{ id: number }> }>('/orders/search', {
        seller: sellerId,
        'order.status': 'cancelled',
        'order.date_created.from': `${startDate}T00:00:00.000-03:00`,
        'order.date_created.to': `${endDate}T23:59:59.000-03:00`,
        limit: '50', offset: String(offset), sort: 'date_desc',
      })
      const orders = res.results ?? []
      if (!orders.length) break
      listados += orders.length
      for (const o of orders) marcados += await cancelar('ml', String(o.id))
      if (orders.length < 50) break
    }
    out.ml_cancelados_listados = listados
    out.ml_vendas_marcadas = marcados
  } catch (e) {
    out.ml = `error: ${String(e).slice(0, 120)}`
  }

  // ── Magalu: lista do mais recente para trás até sair da janela ──
  try {
    const cred = await getCredential('magalu')
    if (!cred?.access_token) throw new Error('Magalu não conectada')
    let listados = 0, marcados = 0
    outer: for (let offset = 0; offset < 4000; offset += 50) {
      const res = await magaluGet<{ results?: Array<{ code: string; status: string; purchased_at: string }> }>(
        '/seller/v1/orders', { _limit: '50', _offset: String(offset), _sort: 'purchased_at:desc' })
      const orders = res.results ?? []
      if (!orders.length) break
      for (const o of orders) {
        const day = toBrazilDate(o.purchased_at)
        if (day < startDate) break outer
        if (!/cancel/i.test(o.status ?? '')) continue
        listados++
        marcados += await cancelar('magalu', o.code)
      }
    }
    out.magalu_cancelados_listados = listados
    out.magalu_vendas_marcadas = marcados
  } catch (e) {
    out.magalu = `error: ${String(e).slice(0, 120)}`
  }

  // ── Shopee: CANCELLED (cancelado depois de pago) e TO_RETURN (devolução) ──
  // Faltava (02/10/2026): o relatório da Shopee de set tinha 5 pedidos assim que
  // seguiam contando como venda. A API aceita janelas de até 15 dias.
  try {
    const cred = await getCredential('shopee')
    if (!cred?.access_token) throw new Error('Shopee não conectada')
    let listados = 0, marcados = 0
    const ts = (d: string, fimDia: boolean) => Math.floor(new Date(`${d}T${fimDia ? '23:59:59' : '00:00:00'}-03:00`).getTime() / 1000)
    for (let ini = new Date(`${startDate}T12:00:00`); ini <= new Date(`${endDate}T12:00:00`); ini.setDate(ini.getDate() + 15)) {
      const fimJ = new Date(Math.min(ini.getTime() + 14 * 864e5, new Date(`${endDate}T12:00:00`).getTime()))
      let cursor = ''
      for (let i = 0; i < 40; i++) {
        const r = await shopeeGet<{ response?: { order_list?: Array<{ order_sn: string; order_status: string }>; more?: boolean; next_cursor?: string } }>(
          '/order/get_order_list', {
            time_range_field: 'create_time', time_from: String(ts(ini.toISOString().slice(0, 10), false)),
            time_to: String(ts(fimJ.toISOString().slice(0, 10), true)), page_size: '50',
            response_optional_fields: 'order_status', ...(cursor ? { cursor } : {}),
          })
        for (const o of r.response?.order_list ?? []) {
          if (!['CANCELLED', 'TO_RETURN'].includes(o.order_status)) continue
          listados++
          marcados += await cancelar('shopee', o.order_sn)
        }
        if (!r.response?.more) break
        cursor = r.response.next_cursor ?? ''
      }
    }
    out.shopee_cancelados_listados = listados
    out.shopee_vendas_marcadas = marcados
  } catch (e) {
    out.shopee = `error: ${String(e).slice(0, 120)}`
  }

  return NextResponse.json({ ok: true, from: startDate, to: endDate, ...out })
}
