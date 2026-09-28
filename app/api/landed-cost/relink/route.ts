/**
 * POST /api/landed-cost/relink
 *
 * Re-vincula import_items e sales aos produtos por SKU, recalcula CMP
 * e aplica o CMP correto para a data de cada venda (CMP histórico).
 *
 * Fluxo:
 *   1. import_items com product_id NULL → vincula por SKU
 *   2. Recalcula landed cost / CMP para todas as NF-e (com effective_date)
 *   3. sales com product_id NULL → vincula por SKU
 *   4. Para cada venda, aplica o CMP vigente NA DATA DA VENDA
 */
import { NextRequest, NextResponse } from 'next/server'
import { runRelink } from '@/lib/landed-cost/relink'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  return NextResponse.json(await runRelink(body))
}
