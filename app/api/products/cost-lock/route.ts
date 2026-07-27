/**
 * POST /api/products/cost-lock  body {product_id, locked}
 * Trava/destrava o custo de um SKU. Travado = recálculo por NF de entrada
 * pula o produto; só o custo manual vale (kits/conjuntos).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { product_id, locked } = await request.json().catch(() => ({}))
  if (!product_id || typeof locked !== 'boolean') {
    return NextResponse.json({ error: 'product_id e locked são obrigatórios' }, { status: 400 })
  }
  const db = createSupabaseServiceClient()
  const { error } = await db.from('products').update({ cost_locked: locked }).eq('id', product_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, product_id, locked })
}
