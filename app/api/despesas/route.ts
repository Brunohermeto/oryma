import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { dre_category, subcategory, description, supplier, amount, period } = await request.json()
  if (!dre_category || !amount || !period) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
  }

  const db = createSupabaseServiceClient()
  const { error } = await db.from('operational_expenses').insert({
    dre_category,
    subcategory: subcategory || null,
    description: description || null,
    supplier: supplier || null,
    amount: parseFloat(amount),
    period,
    payment_date: period,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
