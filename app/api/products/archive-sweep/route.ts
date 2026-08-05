/**
 * POST /api/products/archive-sweep
 *
 * Arquiva SKUs mortos: sem venda nos últimos 180 dias E sem estoque
 * (galpão + Full). Desarquiva automaticamente quem voltou a vender ou
 * ganhou estoque. Roda no ciclo diário; nunca apaga nada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseServiceClient()
  const corte = brazilDaysAgo(180)

  const [{ data: products }, { data: recentSales }] = await Promise.all([
    db.from('products').select('id, archived, stock_quantity, stock_full, stock_fba').limit(3000),
    db.from('sales').select('product_id').gte('sale_date', corte).not('product_id', 'is', null).limit(20000),
  ])
  const ativos = new Set((recentSales ?? []).map(s => s.product_id))

  const toArchive: string[] = []
  const toRestore: string[] = []
  for (const p of products ?? []) {
    const temEstoque = Number(p.stock_quantity ?? 0) + Number(p.stock_full ?? 0) + Number((p as any).stock_fba ?? 0) > 0
    const vivo = ativos.has(p.id) || temEstoque
    if (!p.archived && !vivo) toArchive.push(p.id)
    if (p.archived && vivo) toRestore.push(p.id)
  }

  for (let i = 0; i < toArchive.length; i += 200) {
    await db.from('products').update({ archived: true }).in('id', toArchive.slice(i, i + 200))
  }
  for (let i = 0; i < toRestore.length; i += 200) {
    await db.from('products').update({ archived: false }).in('id', toRestore.slice(i, i + 200))
  }

  return NextResponse.json({ ok: true, arquivados: toArchive.length, desarquivados: toRestore.length })
}
