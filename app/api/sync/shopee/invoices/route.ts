/**
 * POST /api/sync/shopee/invoices?days=14
 *
 * Chave da NF-e direto da API da Shopee (invoice_data.access_key) →
 * sales.nfe_saida_key. Independe do emissor (Bling série 002 ou emissor
 * próprio série 005). Os impostos vêm depois: série 002 via /api/sync/nfe-taxes
 * (XML do Bling); série 005 via pacote de XMLs do emissor.
 */
import { NextRequest, NextResponse } from 'next/server'
import { shopeeGet } from '@/lib/integrations/shopee'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Number(request.nextUrl.searchParams.get('days') ?? 14)
  const db = createSupabaseServiceClient()
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

  const { data: sales } = await db.from('sales')
    .select('id, external_order_id')
    .eq('marketplace', 'shopee')
    .is('nfe_saida_key', null)
    .gte('sale_date', since)

  const byOrder = new Map<string, string[]>()
  for (const s of sales ?? []) {
    const sn = s.external_order_id.replace(/^shopee_/, '').split('_')[0]
    if (!byOrder.has(sn)) byOrder.set(sn, [])
    byOrder.get(sn)!.push(s.id)
  }
  const sns = [...byOrder.keys()]

  let comChave = 0
  for (let i = 0; i < sns.length; i += 50) {
    const det = await shopeeGet<{ response?: { order_list: Array<{ order_sn: string; invoice_data?: { access_key?: string } }> } }>(
      '/order/get_order_detail',
      { order_sn_list: sns.slice(i, i + 50).join(','), response_optional_fields: 'invoice_data' }
    )
    for (const od of det.response?.order_list ?? []) {
      const chave = od.invoice_data?.access_key
      if (!chave || chave.length !== 44) continue
      // série 005 = faturador do Shopee Full (não passa pelo Bling)
      const patch: Record<string, string> = { nfe_saida_key: chave }
      if (chave.slice(22, 25) === '005') patch.fulfillment_type = 'full_shopee'
      for (const id of byOrder.get(od.order_sn) ?? []) {
        await db.from('sales').update(patch).eq('id', id)
      }
      comChave++
    }
  }

  return NextResponse.json({ ok: true, pedidos_sem_nf: sns.length, chaves_gravadas: comChave })
}
