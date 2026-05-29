/**
 * POST /api/cmp/manual
 * Insere CMV manual para produtos sem NF-e de entrada importada.
 * Aceita array de { product_id, cmp_value, effective_date }.
 * Após inserir, dispara relink para recalcular margens de todas as vendas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

interface CmpEntry {
  product_id: string
  cmp_value: number
  effective_date: string  // YYYY-MM-DD
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const { entries } = await request.json() as { entries: CmpEntry[] }

  if (!entries?.length) {
    return NextResponse.json({ error: 'Nenhum valor enviado' }, { status: 400 })
  }

  const valid = entries.filter(e =>
    e.product_id && e.cmp_value > 0 && e.effective_date
  )

  if (!valid.length) {
    return NextResponse.json({ error: 'Nenhum valor válido (CMV deve ser > 0)' }, { status: 400 })
  }

  // Remove entradas existentes para os mesmos produtos na mesma data, depois insere
  const productIds = valid.map(e => e.product_id)
  await db
    .from('cmp_costs')
    .delete()
    .in('product_id', productIds)
    .eq('effective_date', valid[0].effective_date)

  const { error: insertErr } = await db
    .from('cmp_costs')
    .insert(
      valid.map(e => ({
        product_id:        e.product_id,
        cmp_value:         e.cmp_value,
        effective_date:    e.effective_date,
        total_stock_qty:   1,              // placeholder para entrada manual
        total_stock_value: e.cmp_value,   // qty=1, então valor total = cmp_value
      }))
    )

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Dispara relink para atualizar as margens
  let relinkResult = null
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/landed-cost/relink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `mi_auth=${process.env.APP_PASSWORD}` },
      }
    )
    relinkResult = await res.json()
  } catch { /* não bloqueia */ }

  return NextResponse.json({
    ok: true,
    saved: valid.length,
    message: `CMV salvo para ${valid.length} produto(s). Margens recalculadas.`,
    relink: relinkResult?.message ?? null,
  })
}
