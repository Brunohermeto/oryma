/**
 * POST /api/sync/ml/billing
 *
 * Rebates e custo de Ads a partir do extrato de tarifas do ML
 * (/billing/integration/periods/key/{key}/group/ML/details).
 *
 * - BONUS com order_id  → sales.rebate por pedido (rateado por item)
 * - CHARGE/PADS por dia → sales.ads_cost rateado entre as vendas ML do dia
 *
 * Processa o período ABERTO; ads limitado aos últimos `days` dias
 * (o cron roda 2x/dia, então a janela curta cobre tudo).
 * Rate limit do billing: 5 req/min — esta rota faz no máx. ~6 chamadas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo, brazilToday } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

interface BillingDetail {
  charge_info?: {
    detail_id?: number
    detail_amount?: number
    detail_type?: string
    detail_sub_type?: string
    creation_date_time?: string
  }
  sales_info?: Array<{ order_id?: number | string }>
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days   = Number(request.nextUrl.searchParams.get('days') ?? '7')
  const cutoff = brazilDaysAgo(days)
  const db     = createSupabaseServiceClient()

  // 1. Período: ?period=YYYY-MM-01 (backfill) ou o período aberto (default)
  let key = request.nextUrl.searchParams.get('period')
  if (!key) {
    const periods = await mlGet<{ results?: Array<{ key?: string }> }>(
      '/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=1'
    )
    key = periods.results?.[0]?.key ?? null
  }
  if (!key) return NextResponse.json({ ok: false, error: 'Nenhum período de billing encontrado' }, { status: 500 })

  // 2. Detalhes do período (paginação por from_id)
  const rebateByOrder = new Map<string, number>()
  const padsByDay     = new Map<string, number>()
  // Tarifas por pedido: CV* = comissão | CXD* = frete | resto = tarifa fixa/Full
  const chargesByOrder = new Map<string, { commission: number; shipping: number; fixed: number }>()
  const seen = new Set<number>()
  let offset = 0

  for (let page = 0; page < 8; page++) {
    // Paginação por offset — o last_id do ML volta 0 e quebraria o cursor
    const body = await mlGet<{ results?: BillingDetail[] }>(
      `/billing/integration/periods/key/${key}/group/ML/details?document_type=BILL&limit=1000&sort_by=ID&order_by=ASC&offset=${offset}`
    )
    const results = body.results ?? []
    if (!results.length) break

    for (const r of results) {
      const ci = r.charge_info ?? {}
      if (ci.detail_id == null || seen.has(ci.detail_id)) continue
      seen.add(ci.detail_id)
      const amount = Number(ci.detail_amount ?? 0)
      const order  = r.sales_info?.[0]?.order_id

      if (ci.detail_type === 'BONUS' && order) {
        const k = String(order)
        rebateByOrder.set(k, (rebateByOrder.get(k) ?? 0) + amount)
      } else if (ci.detail_sub_type === 'PADS') {
        const day = (ci.creation_date_time ?? '').slice(0, 10)
        // Só rateia dias FECHADOS — o dia corrente concentraria o custo
        // inteiro nas poucas vendas que já entraram
        if (day >= cutoff && day < brazilToday()) {
          padsByDay.set(day, (padsByDay.get(day) ?? 0) + amount)
        }
      } else if (ci.detail_type === 'CHARGE' && order) {
        const k = String(order)
        const cur = chargesByOrder.get(k) ?? { commission: 0, shipping: 0, fixed: 0 }
        const st = ci.detail_sub_type ?? ''
        if (st.startsWith('CV')) cur.commission += amount
        else if (st.startsWith('CXD')) cur.shipping += amount
        else cur.fixed += amount
        chargesByOrder.set(k, cur)
      }
    }
    if (results.length < 1000) break
    offset += results.length
  }

  // 3. Atualizações por pedido: comissão real + tarifas de envio/canal + rebate
  //    (rateado por item pelo gross). SET, não soma — extrato é a fonte da verdade.
  let tariffSales = 0
  let rebateSales = 0
  const allOrders = new Set([...chargesByOrder.keys(), ...rebateByOrder.keys()])
  for (const order of allOrders) {
    const { data: rows } = await db.from('sales')
      .select('id, gross_price').like('external_order_id', `ml_${order}_%`)
    if (!rows?.length) continue
    const sum = rows.reduce((s, x) => s + Number(x.gross_price ?? 0), 0)
    const charges = chargesByOrder.get(order)
    const rebate  = rebateByOrder.get(order)
    for (const x of rows) {
      const share = sum > 0 ? Number(x.gross_price ?? 0) / sum : 1 / rows.length
      const fields: Record<string, number> = {}
      if (charges) {
        fields.marketplace_commission   = Math.round(charges.commission * share * 100) / 100
        fields.marketplace_shipping_fee = Math.round(charges.shipping * share * 100) / 100
        fields.marketplace_fixed_fee    = Math.round(charges.fixed * share * 100) / 100
        tariffSales++
      }
      if (rebate) {
        fields.rebate = Math.round(rebate * share * 100) / 100
        rebateSales++
      }
      await db.from('sales').update(fields).eq('id', x.id)
    }
  }

  // 4. Ads: custo do dia rateado entre as vendas ML do dia
  let adsSales = 0
  for (const [day, total] of padsByDay) {
    const { data: rows } = await db.from('sales')
      .select('id, gross_price').eq('marketplace', 'mercado_livre').eq('sale_date', day)
    if (!rows?.length) continue
    const sum = rows.reduce((s, x) => s + Number(x.gross_price ?? 0), 0)
    for (const x of rows) {
      const share = sum > 0 ? Number(x.gross_price ?? 0) / sum : 1 / rows.length
      await db.from('sales').update({ ads_cost: Math.round(total * share * 100) / 100 }).eq('id', x.id)
      adsSales++
    }
  }

  return NextResponse.json({
    ok: true, period: key,
    tariff_orders: chargesByOrder.size, tariff_sales_updated: tariffSales,
    rebate_orders: rebateByOrder.size, rebate_sales_updated: rebateSales,
    ads_days: padsByDay.size, ads_sales_updated: adsSales,
  })
}
