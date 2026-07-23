/**
 * POST /api/sync/ml/tariffs
 *
 * Tarifas por PEDIDO via /billing/integration/group/ML/order/details?order_ids=…
 * Fonte definitiva: inclui cobranças "debited_from_operation" que NÃO aparecem
 * na listagem por período (motivo dos buracos de comissão).
 *
 * - comissão  = soma dos CHARGE CV* (líquida de desconto promocional)
 * - tarifas   = demais CHARGE (CXDE frete, CFFE custo fixo, CFONPN Full…)
 * - rebate    = BONUS
 *
 * Processa N pedidos por chamada; o chamador repete com `skip` até remaining=0.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

interface OrderDetailResult {
  order_id?: number | string
  details?: Array<{
    charge_info?: { detail_amount?: number; detail_type?: string; detail_sub_type?: string }
  }>
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body  = await request.json().catch(() => ({}))
  const days  = Number(body.days ?? 45)
  const limit = Number(body.limit ?? 30)
  const force = body.force === true  // reprocessa mesmo quem já tem tarifa (ex: re-split)
  const skip  = new Set<string>(Array.isArray(body.skip) ? body.skip : [])

  const db = createSupabaseServiceClient()

  // Vendas na janela — pedidos sem comissão OU sem tarifa são os alvos
  const { data: rows } = await db.from('sales')
    .select('id, external_order_id, gross_price, marketplace_commission, marketplace_shipping_fee')
    .eq('marketplace', 'mercado_livre')
    .gte('sale_date', brazilDaysAgo(days))
    .order('sale_date', { ascending: false })
    .limit(1000)

  const orders = new Map<string, Array<{ saleId: string; gross: number }>>()
  for (const r of rows ?? []) {
    const m = r.external_order_id?.match(/^ml_(\d+)_/)
    if (!m || skip.has(m[1])) continue
    const needs = force
      || Number(r.marketplace_commission ?? 0) === 0
      || Number(r.marketplace_shipping_fee ?? 0) === 0
    if (!needs) continue
    if (!orders.has(m[1])) orders.set(m[1], [])
    orders.get(m[1])!.push({ saleId: r.id, gross: Number(r.gross_price ?? 0) })
  }

  const batch = [...orders.keys()].slice(0, limit)
  let updated = 0
  const errors: string[] = []

  if (batch.length) {
    try {
      const res = await mlGet<{ results?: OrderDetailResult[] }>(
        `/billing/integration/group/ML/order/details?order_ids=${batch.join(',')}&limit=150`
      )
      for (const r of res.results ?? []) {
        const orderId = String(r.order_id)
        const items = orders.get(orderId)
        if (!items) continue

        // CV* = comissão | CXD* = frete Mercado Envios | resto = tarifa fixa/Full
        let commission = 0, shipping = 0, fixed = 0, rebate = 0
        for (const d of r.details ?? []) {
          const ci = d.charge_info ?? {}
          const amt = Number(ci.detail_amount ?? 0)
          const st  = ci.detail_sub_type ?? ''
          if (ci.detail_type === 'CHARGE') {
            if (st.startsWith('CV')) commission += amt
            else if (st.startsWith('CXD')) shipping += amt
            else fixed += amt
          } else if (ci.detail_type === 'BONUS') {
            rebate += amt
          }
        }
        if (commission === 0 && shipping === 0 && fixed === 0 && rebate === 0) continue

        const sum = items.reduce((s, x) => s + x.gross, 0)
        for (const x of items) {
          const share = sum > 0 ? x.gross / sum : 1 / items.length
          const { error } = await db.from('sales').update({
            marketplace_commission:   Math.round(commission * share * 100) / 100,
            marketplace_fixed_fee:    Math.round(fixed * share * 100) / 100,
            // Frete: só grava se o extrato TEM linha CXD* — em vendas Full o frete
            // não passa pelo extrato (vem de /shipments/costs) e zerar apagaria ele
            ...(shipping > 0 ? { marketplace_shipping_fee: Math.round(shipping * share * 100) / 100 } : {}),
            ...(rebate > 0 ? { rebate: Math.round(rebate * share * 100) / 100 } : {}),
          }).eq('id', x.saleId)
          if (error) throw new Error(error.message)
          updated++
        }
      }
    } catch (err) {
      errors.push(String(err).slice(0, 150))
    }
  }

  return NextResponse.json({
    ok: true,
    processed_orders: batch.length,
    processed_ids: batch,
    sales_updated: updated,
    remaining_orders: orders.size - batch.length,
    errors,
  })
}
