/**
 * POST /api/nfe/manual
 *
 * Cria um lote de importação manualmente (sem XML).
 * Útil quando o usuário não tem o arquivo XML da NF-e mas sabe os valores.
 *
 * Body JSON:
 *   product_id    UUID do produto
 *   batch_ref     Referência do lote (ex: "Lote China Mai/26")
 *   issue_date    YYYY-MM-DD
 *   quantity      Quantidade importada (unidades)
 *   fob_total     Valor FOB total em R$ (custo do produto + frete até o porto)
 *   taxes_total   Total de impostos da DI (II + IPI + PIS + COFINS + ICMS-GNRE) em R$
 *   extra_total   Outros custos (frete rodoviário + despachante + armazenagem + etc.) em R$
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { product_id, batch_ref, issue_date, quantity, fob_total, taxes_total, extra_total } = await request.json()

  if (!product_id || !quantity || !fob_total) {
    return NextResponse.json({ error: 'product_id, quantity e fob_total são obrigatórios' }, { status: 400 })
  }

  const db = createSupabaseServiceClient()

  const qty        = Number(quantity)
  const fob        = Number(fob_total)
  const taxes      = Number(taxes_total ?? 0)
  const extra      = Number(extra_total ?? 0)
  const unitFob    = fob / qty
  const totalNfe   = fob + taxes

  // 1. Cria import_order
  const { data: order, error: orderErr } = await db
    .from('import_orders')
    .insert({
      nfe_number:      batch_ref ?? `Manual-${Date.now()}`,
      nfe_key:         null,
      supplier:        'Entrada Manual',
      issue_date:      issue_date ?? new Date().toISOString().slice(0, 10),
      cfop:            '3102',
      total_nfe_value: totalNfe,
      total_fob_value: fob,
      source:          'manual_upload',
      costs_complete:  extra > 0,
    })
    .select('id')
    .single()

  if (orderErr || !order?.id) {
    return NextResponse.json({ error: orderErr?.message ?? 'Falha ao criar importação' }, { status: 500 })
  }

  // 2. Cria import_item (impostos rateados como unitários)
  const { error: itemErr } = await db
    .from('import_items')
    .insert({
      import_order_id: order.id,
      product_id,
      sku:             null,
      description:     batch_ref ?? 'Lote manual',
      quantity:        qty,
      unit_fob_value:  unitFob,
      total_fob_value: fob,
      unit_ii:         taxes / qty,   // simplificado: total dividido pela quantidade
      unit_ipi:        0,
      unit_pis_imp:    0,
      unit_cofins_imp: 0,
      unit_icms_gnre:  0,
    })

  if (itemErr) {
    return NextResponse.json({ error: itemErr.message }, { status: 500 })
  }

  // 3. Se há custos extras, cria import_cost
  if (extra > 0) {
    await db.from('import_costs').insert({
      import_order_id:     order.id,
      type:                'outro',
      description:         'Custos extras (frete + despachante + outros)',
      amount:              extra,
      distribution_method: 'fob_value',
    })
  }

  // 4. Calcula landed cost + CMP
  try {
    await recalculateLandedCost(order.id)
  } catch (err) {
    return NextResponse.json({ error: `CMP falhou: ${String(err)}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, order_id: order.id })
}
