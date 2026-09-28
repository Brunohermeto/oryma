import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'
import { callRelink } from '@/lib/landed-cost/call-relink'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { import_order_id, type, description, amount } = await request.json()
  if (!import_order_id || !type || !amount) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
  }

  const db = createSupabaseServiceClient()
  const { error } = await db.from('import_costs').insert({
    import_order_id,
    type,
    description: description || null,
    amount: parseFloat(amount),
    distribution_method: 'fob_value',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Recalculate landed cost and CMP for all products in this order
  try {
    await recalculateLandedCost(import_order_id)
  } catch (calcErr) {
    // Non-fatal: cost was saved, recalculation failed
    return NextResponse.json({ ok: true, warning: `Cost saved but recalculation failed: ${calcErr}` })
  }

  // Custo do lote mudou → recalcula a margem das vendas desses produtos (antes
  // não recalculava: o extra entrava no lote mas a margem só mudava no próximo relink)
  const { data: itens } = await db.from('import_items').select('product_id').eq('import_order_id', import_order_id)
  const productIds = [...new Set((itens ?? []).map(i => i.product_id).filter(Boolean))]
  if (productIds.length) {
    await callRelink({ productIds }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
