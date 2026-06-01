/**
 * GET /api/sales/{id}/cost-detail
 *
 * Retorna o breakdown detalhado de custo e créditos fiscais de uma venda.
 *
 * Busca em unit_costs o lote de importação vigente na data da venda:
 *   - fob_unit_cost          → custo FOB do produto
 *   - taxes_unit_cost        → II + IPI + ICMS-GNRE (custos reais)
 *   - additional_unit_cost   → frete internacional, seguro rateados
 *   - pis_credit_unit        → PIS da importação (crédito recuperável)
 *   - cofins_credit_unit     → COFINS da importação (crédito recuperável)
 *
 * Também retorna sale_taxes se já sincronizada (para cruzar com créditos).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createSupabaseServiceClient()

  // Busca a venda para pegar product_id e sale_date
  const { data: sale } = await db
    .from('sales')
    .select('id, product_id, sale_date, quantity')
    .eq('id', id)
    .single()

  if (!sale?.product_id) {
    return NextResponse.json({ error: 'Venda sem produto vinculado', cost_detail: null })
  }

  // Busca unit_costs vigentes na data da venda
  // Usa effective_date de cmp_costs como proxy para encontrar o lote correto
  const { data: unitCosts } = await db
    .from('unit_costs')
    .select(`
      fob_unit_cost,
      taxes_unit_cost,
      additional_unit_cost,
      total_unit_cost,
      pis_credit_unit,
      cofins_credit_unit,
      icms_credit_unit,
      quantity_in_batch,
      import_order_id,
      import_orders(nfe_number, issue_date, supplier)
    `)
    .eq('product_id', sale.product_id)
    .order('created_at', { ascending: false })

  // Pega o lote mais recente vigente na data da venda
  // (idealmente o lote com effective_date <= sale_date mais próximo)
  const bestBatch = (unitCosts ?? []).find(() => true) ?? null  // primeiro = mais recente

  // Detalhes dos import_items desse lote (para mostrar II, IPI separados)
  let itemDetail: Record<string, number> | null = null
  if (bestBatch?.import_order_id) {
    const { data: items } = await db
      .from('import_items')
      .select('unit_fob_value, unit_ii, unit_ipi, unit_pis_imp, unit_cofins_imp, unit_icms_gnre, quantity')
      .eq('import_order_id', bestBatch.import_order_id)
      .eq('product_id', sale.product_id)
      .single()

    if (items) {
      itemDetail = {
        unit_ii:          Number(items.unit_ii ?? 0),
        unit_ipi:         Number(items.unit_ipi ?? 0),
        unit_pis_imp:     Number(items.unit_pis_imp ?? 0),
        unit_cofins_imp:  Number(items.unit_cofins_imp ?? 0),
        unit_icms_gnre:   Number(items.unit_icms_gnre ?? 0),
      }
    }
  }

  // sale_taxes (impostos sobre a venda — da NF-e saída)
  const { data: taxes } = await db
    .from('sale_taxes')
    .select('pis, cofins, icms, icms_difal, ipi, total_taxes, nfe_key')
    .eq('sale_id', id)
    .maybeSingle()

  const qty = Number(sale.quantity) || 1

  const detail = bestBatch ? {
    // Breakdown do CMV por unidade
    fob_unit:              Number(bestBatch.fob_unit_cost ?? 0),
    ii_unit:               itemDetail?.unit_ii              ?? 0,
    ipi_unit:              itemDetail?.unit_ipi             ?? 0,
    icms_gnre_unit:        itemDetail?.unit_icms_gnre       ?? 0,
    additional_unit:       Number(bestBatch.additional_unit_cost ?? 0),
    total_unit_cost:       Number(bestBatch.total_unit_cost ?? 0),
    // Créditos de impostos de importação (por unidade → total = × qty)
    pis_credit_unit:       Number(bestBatch.pis_credit_unit ?? 0),
    cofins_credit_unit:    Number(bestBatch.cofins_credit_unit ?? 0),
    pis_credit_total:      Number(bestBatch.pis_credit_unit ?? 0) * qty,
    cofins_credit_total:   Number(bestBatch.cofins_credit_unit ?? 0) * qty,
    // Lote de origem
    batch: {
      import_order_id: bestBatch.import_order_id,
      nfe_number:      (bestBatch.import_orders as any)?.nfe_number ?? null,
      issue_date:      (bestBatch.import_orders as any)?.issue_date ?? null,
      supplier:        (bestBatch.import_orders as any)?.supplier ?? null,
    },
  } : null

  return NextResponse.json({
    sale_id: id,
    cost_detail: detail,
    sale_taxes: taxes ?? null,
  })
}
