/**
 * POST /api/debug/fix-costs
 * Diagnóstico + correção direta: insere sale_costs um a um com log detalhado.
 * Confirma se o insert funciona e qual erro ocorre se não funcionar.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const log: string[] = []

  // 1. Conta registros atuais
  const { count: beforeCount, error: countErr } = await db
    .from('sale_costs').select('*', { count: 'exact', head: true })
  log.push(`sale_costs atual: ${beforeCount ?? 0} registros (erro count: ${countErr?.message ?? 'nenhum'})`)

  // 2. Busca RAGA001-C CMP
  const { data: cmps, error: cmpErr } = await db
    .from('cmp_costs')
    .select('id, product_id, cmp_value')
    .order('calculated_at', { ascending: false })
    .limit(5)
  log.push(`cmp_costs: ${cmps?.length ?? 0} registros (erro: ${cmpErr?.message ?? 'nenhum'})`)
  if (cmps?.length) log.push(`primeiro CMP: ${JSON.stringify(cmps[0])}`)

  // 3. Busca uma venda com product_id = produto do CMP
  const firstCmp = cmps?.[0]
  if (!firstCmp) {
    return NextResponse.json({ ok: false, log, error: 'Sem CMP disponível' })
  }

  const { data: sales, error: salesErr } = await db
    .from('sales')
    .select('id, product_id, gross_price, quantity')
    .eq('product_id', firstCmp.product_id)
    .limit(1)
  log.push(`vendas para produto ${firstCmp.product_id.slice(-8)}: ${sales?.length ?? 0} (erro: ${salesErr?.message ?? 'nenhum'})`)

  const sale = sales?.[0]
  if (!sale) {
    return NextResponse.json({ ok: false, log, error: 'Sem venda para o produto com CMP' })
  }
  log.push(`venda encontrada: ${sale.id.slice(-8)}, gross_price: ${sale.gross_price}`)

  // 4. Deleta possível registro anterior
  const { error: delErr } = await db
    .from('sale_costs').delete().eq('sale_id', sale.id)
  log.push(`delete sale_costs para ${sale.id.slice(-8)}: ${delErr?.message ?? 'ok'}`)

  // 5. Tenta inserir
  const row = {
    sale_id:           sale.id,
    cmp_cost_id:       firstCmp.id,
    unit_cost_applied: Number(firstCmp.cmp_value),
    total_cost:        Number(firstCmp.cmp_value) * (Number(sale.quantity) || 1),
    margin_value:      Number(sale.gross_price) - Number(firstCmp.cmp_value),
    margin_pct:        Number(sale.gross_price) > 0
      ? (Number(sale.gross_price) - Number(firstCmp.cmp_value)) / Number(sale.gross_price)
      : 0,
  }
  log.push(`tentando inserir: ${JSON.stringify(row)}`)

  const { error: insErr, data: insData } = await db
    .from('sale_costs').insert(row).select()
  log.push(`insert resultado: error=${insErr?.message ?? 'nenhum'}, data=${insData ? JSON.stringify(insData) : 'null'}`)

  // 6. Confirma com SELECT
  const { data: confirmData } = await db
    .from('sale_costs').select('*').eq('sale_id', sale.id)
  log.push(`confirmação SELECT: ${JSON.stringify(confirmData)}`)

  return NextResponse.json({
    ok: !insErr,
    inserted: !insErr,
    insert_error: insErr?.message ?? null,
    confirmed_in_db: (confirmData?.length ?? 0) > 0,
    log,
  })
}
