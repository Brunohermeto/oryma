/**
 * POST /api/sync/shopee/returns?days=30
 *
 * Devoluções/reembolsos da Shopee → sales.cancellation.
 * Regra canônica: estorno separado (comissão segue BRUTA); devolução integral
 * (cancellation ≥ gross) sai de faturamento/margem/pedidos via isReturned.
 * Reembolso é do PEDIDO: rateia pelos itens proporcional ao gross.
 */
import { NextRequest, NextResponse } from 'next/server'
import { shopeeGet } from '@/lib/integrations/shopee'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

interface ReturnItem {
  return_sn: string
  order_sn: string
  status: string           // REQUESTED | ACCEPTED | CANCELLED | JUDGING | REFUND_PAID | CLOSED | PROCESSING | SELLER_DISPUTE
  refund_amount: number
  update_time: number
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Number(request.nextUrl.searchParams.get('days') ?? 30)
  const db = createSupabaseServiceClient()
  const now = Math.floor(Date.now() / 1000)

  // devoluções no período — API limita a janelas de 15 dias
  const returns: ReturnItem[] = []
  for (let from = now - days * 86400; from < now; from += 15 * 86400) {
    const to = Math.min(from + 15 * 86400 - 1, now)
    for (let pageNo = 1; pageNo < 20; pageNo++) {
      const res = await shopeeGet<{ response?: { return: ReturnItem[]; more: boolean } }>('/returns/get_return_list', {
        page_no: String(pageNo), page_size: '50',
        create_time_from: String(from), create_time_to: String(to),
      })
      const list = res.response?.return ?? []
      returns.push(...list)
      if (!res.response?.more) break
    }
  }

  let updated = 0
  const semVenda: string[] = []
  for (const r of returns) {
    // só reembolso efetivado conta como estorno
    if (!['REFUND_PAID', 'ACCEPTED', 'CLOSED'].includes(r.status) || !(Number(r.refund_amount) > 0)) continue
    const { data: sales } = await db.from('sales')
      .select('id, gross_price, cancellation')
      .like('external_order_id', `shopee_${r.order_sn}_%`)
    if (!sales?.length) { semVenda.push(r.order_sn); continue }
    const total = sales.reduce((s, x) => s + Number(x.gross_price), 0)
    for (const s of sales) {
      const share = total > 0 ? Number(s.gross_price) / total : 1 / sales.length
      const cancel = Math.round(Number(r.refund_amount) * share * 100) / 100
      if (Math.abs(Number(s.cancellation ?? 0) - cancel) < 0.01) continue
      const { error } = await db.from('sales').update({ cancellation: cancel }).eq('id', s.id)
      if (!error) updated++
    }
  }

  return NextResponse.json({
    ok: true,
    devolucoes_listadas: returns.length,
    vendas_atualizadas: updated,
    pedidos_sem_venda: semVenda.slice(0, 10),
  })
}
