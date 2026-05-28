/**
 * GET /api/debug/ml-test
 * Testa a conexão com o ML: seller ID, token, e busca os últimos 3 pedidos pagos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCredential } from '@/lib/integrations/credentials'
import { getMercadoLivreSellerId, mlGet } from '@/lib/integrations/mercado-livre'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const log: string[] = []

  // 1. Credencial raw
  const cred = await getCredential('mercado_livre')
  log.push(`credencial encontrada: ${cred ? 'sim' : 'NÃO'}`)
  if (cred) {
    const extra = cred.extra as Record<string, unknown> | null
    log.push(`seller_id em extra: ${extra?.seller_id ?? 'AUSENTE ⚠️'}`)
    log.push(`access_token presente: ${!!cred.access_token}`)
    log.push(`expires_at: ${cred.expires_at}`)
    log.push(`token expirado: ${cred.expires_at ? new Date(cred.expires_at) < new Date() : 'sem data'}`)
  }

  // 2. Seller ID via função
  const sellerId = await getMercadoLivreSellerId()
  log.push(`getMercadoLivreSellerId(): ${sellerId ?? 'NULL ⚠️'}`)

  if (!sellerId) {
    return NextResponse.json({ ok: false, log, error: 'Seller ID ausente — reconecte o ML' })
  }

  // 3. Busca últimos 3 pedidos pagos (últimos 7 dias)
  const today = new Date().toISOString().slice(0, 10)
  const week  = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)

  let ordersRaw: unknown = null
  let ordersErr: string | null = null
  try {
    ordersRaw = await mlGet('/orders/search', {
      seller: sellerId,
      'order.status': 'paid',
      'order.date_created.from': `${week}T00:00:00.000-03:00`,
      'order.date_created.to': `${today}T23:59:59.000-03:00`,
      limit: '3',
      offset: '0',
      sort: 'date_desc',
    })
    const r = ordersRaw as { results?: unknown[]; paging?: unknown; error?: string; message?: string }
    log.push(`orders API: ${r.error ? `ERRO: ${r.error} — ${r.message}` : `ok — ${r.results?.length ?? 0} pedidos (total: ${(r.paging as any)?.total})` }`)
  } catch (e) {
    ordersErr = String(e)
    log.push(`orders API EXCEPTION: ${ordersErr}`)
  }

  return NextResponse.json({
    ok: !ordersErr,
    seller_id: sellerId,
    log,
    orders_sample: ordersRaw,
    error: ordersErr,
  })
}
