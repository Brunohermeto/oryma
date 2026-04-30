import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

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
  return NextResponse.json({ ok: true })
}
