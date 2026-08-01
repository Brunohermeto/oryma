/**
 * POST /api/sync/amazon/service-fees — taxas de serviço por período (Finances).
 *
 * - MFNPostageFee: etiqueta comprada na Amazon para envio do galpão — vem COM
 *   AmazonOrderId, então é atribuída EXATA à venda (marketplace_shipping_fee).
 * - FBAStorageFee: hoje a Amazon isenta (R$ 0). Se começar a cobrar, o valor
 *   aparece na resposta como storage_fee_total — VIGIA para construirmos rateio.
 * - Subscription (mensalidade): despesa fixa do mês — não entra por venda (DRE).
 */
import { NextRequest, NextResponse } from 'next/server'
import { amazonGet } from '@/lib/integrations/amazon'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface FinancialEventsPeriod {
  payload?: {
    NextToken?: string
    FinancialEvents?: {
      ServiceFeeEventList?: Array<{
        AmazonOrderId?: string
        FeeList?: Array<{ FeeType?: string; FeeAmount?: { CurrencyAmount?: number } }>
      }>
    }
  }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Number(request.nextUrl.searchParams.get('days') ?? 14)
  const db = createSupabaseServiceClient()
  const after  = new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const before = new Date(Date.now() - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

  const postageByOrder = new Map<string, number>()
  let storageTotal = 0
  let subscriptionTotal = 0

  let next: string | null = null
  for (let page = 0; page < 12; page++) {
    const qs = new URLSearchParams({ PostedAfter: after, PostedBefore: before, MaxResultsPerPage: '100' })
    if (next) qs.set('NextToken', next)
    let ev: FinancialEventsPeriod
    try {
      ev = await amazonGet<FinancialEventsPeriod>(`/finances/v0/financialEvents?${qs}`)
    } catch { break }
    for (const s of ev.payload?.FinancialEvents?.ServiceFeeEventList ?? []) {
      for (const f of s.FeeList ?? []) {
        const v = Math.abs(f.FeeAmount?.CurrencyAmount ?? 0)
        if (v === 0) continue
        if (f.FeeType === 'MFNPostageFee' && s.AmazonOrderId) {
          postageByOrder.set(s.AmazonOrderId, (postageByOrder.get(s.AmazonOrderId) ?? 0) + v)
        } else if (f.FeeType === 'FBAStorageFee') {
          storageTotal += v
        } else if (f.FeeType === 'Subscription') {
          subscriptionTotal += v
        }
      }
    }
    next = ev.payload?.NextToken ?? null
    if (!next) break
    await sleep(2200)
  }

  // Atribui a postagem exata à(s) venda(s) do pedido (rateio por item se multi)
  let updated = 0
  for (const [orderId, postage] of postageByOrder) {
    const { data: rows } = await db.from('sales')
      .select('id, gross_price')
      .eq('marketplace', 'amazon')
      .like('external_order_id', `amz_${orderId}_%`)
    if (!rows?.length) continue
    const total = rows.reduce((a, r) => a + Number(r.gross_price ?? 0), 0)
    for (const r of rows) {
      const share = total > 0 ? Number(r.gross_price) / total : 1 / rows.length
      await db.from('sales').update({
        marketplace_shipping_fee: Math.round(postage * share * 100) / 100,
      }).eq('id', r.id)
      updated++
    }
  }

  return NextResponse.json({
    ok: true,
    postage_orders: postageByOrder.size,
    sales_updated: updated,
    storage_fee_total: storageTotal,      // >0 = Amazon começou a cobrar armazenagem!
    subscription_total: subscriptionTotal, // mensalidade — lançar como despesa no DRE
  })
}
