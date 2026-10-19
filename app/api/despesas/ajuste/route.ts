/**
 * POST /api/despesas/ajuste { id, valor: number | null, observacao }
 * Ajusta uma despesa lançada (valor 0 = excluir do DRE). Para as que vieram da
 * Conta Azul o ajuste fica salvo em despesa_ajustes e é reaplicado a cada reenvio.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, valor, observacao } = await request.json()
  const v = valor === null || valor === '' || valor === undefined ? null : Number(valor)
  if (!id || (v !== null && (!Number.isFinite(v) || v < 0)))
    return NextResponse.json({ error: 'Informe a despesa e um valor válido' }, { status: 400 })

  const db = createSupabaseServiceClient()
  const { data: e } = await db.from('operational_expenses')
    .select('id, period, subcategory, description, amount, valor_original, source').eq('id', id).maybeSingle()
  if (!e) return NextResponse.json({ error: 'Despesa não encontrada' }, { status: 404 })
  const original = Number(e.valor_original ?? e.amount)

  if (e.source === 'contaazul') {
    const { error } = await db.from('despesa_ajustes').upsert({
      period: e.period, categoria: e.subcategory ?? '', descricao: e.description ?? '', valor_original: original,
      valor: v, observacao: observacao || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'period,categoria,descricao,valor_original' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const { error } = await db.from('operational_expenses')
    .update({ amount: v ?? original, valor_original: original, observacao: observacao || null }).eq('id', id)
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
}
