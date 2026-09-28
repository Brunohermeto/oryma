/**
 * POST /api/cmp/manual
 * Insere CMV manual para produtos sem NF-e de entrada importada.
 * Aceita array de { product_id, cmp_value, effective_date }.
 * Após inserir, dispara relink para recalcular margens de todas as vendas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { callRelink } from '@/lib/landed-cost/call-relink'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

// Apaga lançamentos MANUAIS (total_stock_qty = 1) do produto naquela vigência.
// As vendas já recalculadas apontam para o registro (sale_costs.cmp_cost_id):
// sem soltar esse vínculo antes, o delete falhava calado e o valor duplicava.
async function apagarManuais(db: ReturnType<typeof createSupabaseServiceClient>, productIds: string[], data: string) {
  const { data: rows } = await db.from('cmp_costs').select('id')
    .in('product_id', productIds).eq('effective_date', data).eq('total_stock_qty', 1)
  const ids = (rows ?? []).map(r => r.id)
  if (!ids.length) return 0
  await db.from('sale_costs').update({ cmp_cost_id: null }).in('cmp_cost_id', ids)
  const { error } = await db.from('cmp_costs').delete().in('id', ids)
  if (error) throw new Error(error.message)
  return ids.length
}

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
  const body = await request.json()

  // Voltar ao custo da NF: remove TODOS os lançamentos manuais do produto
  // (marcador: total_stock_qty = 1), destrava e recalcula
  if (body.remove_manual_product_id) {
    const pid = String(body.remove_manual_product_id)
    const { data: manuais } = await db.from('cmp_costs')
      .select('id').eq('product_id', pid).eq('total_stock_qty', 1)
    for (const m of manuais ?? []) {
      await db.from('sale_costs').update({ cmp_cost_id: null }).eq('cmp_cost_id', m.id)
      await db.from('cmp_costs').delete().eq('id', m.id)
    }
    await db.from('products').update({ cost_locked: false }).eq('id', pid)
    await callRelink({ productIds: [pid] }).catch(() => null)  // só as vendas dele (completo passa de 60s)
    return NextResponse.json({ ok: true, removidos: (manuais ?? []).length, message: 'Custo manual removido — o custo da NF reassumiu e as margens foram recalculadas.' })
  }

  // Apaga UMA vigência manual (ex.: valor lançado com a data errada) e recalcula
  // as vendas do produto só a partir daquela data
  if (body.remove_entry?.product_id && body.remove_entry?.effective_date) {
    const pid = String(body.remove_entry.product_id)
    const data = String(body.remove_entry.effective_date)
    const n = await apagarManuais(db, [pid], data)
    await callRelink({ productIds: [pid], from: data }).catch(() => null)
    return NextResponse.json({ ok: true, removidos: n })
  }

  const { entries } = body as { entries: CmpEntry[] }

  if (!entries?.length) {
    return NextResponse.json({ error: 'Nenhum valor enviado' }, { status: 400 })
  }

  const valid = entries.filter(e =>
    e.product_id && e.cmp_value > 0 && e.effective_date
  )

  if (!valid.length) {
    return NextResponse.json({ error: 'Nenhum valor válido (CMV deve ser > 0)' }, { status: 400 })
  }

  // Substitui (não duplica) o valor manual do mesmo produto na mesma data
  const productIds = valid.map(e => e.product_id)
  for (const e of valid) await apagarManuais(db, [e.product_id], e.effective_date)

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
  // só as vendas dos produtos alterados (o completo passa dos 60s) e só a partir
  // da vigência informada: vendas anteriores não são tocadas
  const relinkResult = await callRelink({ productIds, from: valid.map(e => e.effective_date).sort()[0] }).catch(() => null)

  return NextResponse.json({
    ok: true,
    saved: valid.length,
    message: `CMV salvo para ${valid.length} produto(s). Margens recalculadas.`,
    relink: relinkResult?.message ?? null,
  })
}
