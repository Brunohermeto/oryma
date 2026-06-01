/**
 * POST /api/debug/sync-ml-fees
 *
 * Busca detalhes de cada pedido ML individualmente (/orders/{id}) para preencher:
 *   - marketplace_commission   (comissão ml_fee)
 *   - marketplace_shipping_fee (frete cobrado ao vendedor)
 *   - rebate                   (descontos/cashback negativos em fee_details)
 *   - sale_taxes               (impostos retidos pelo ML: ICMS, ISS, income_tax, etc.)
 *
 * A API de busca em massa (/orders/search) não retorna fee_details nem impostos.
 * Este endpoint faz backfill chamando /orders/{id} para cada venda.
 *
 * Body: { batch: 25, offset: 0 }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { mlGet } from '@/lib/integrations/mercado-livre'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface MLFeeDetail {
  type: string
  amount?: number
  fee_amount?: number
}

interface MLPayment {
  marketplace_fee?: number
  shipping_cost?: number
  taxes_withheld?: number
  total_paid_amount?: number
  installment_amount?: number
  coupon_amount?: number
}

interface MLOrderDetail {
  id: number
  fee_details?: MLFeeDetail[]
  taxes?: { amount?: number; currency_id?: string; rates?: Array<{ name: string; value: number; rate?: number }> }
  order_items?: Array<{ sale_fee?: number; unit_price: number; quantity: number }>
  payments?: MLPayment[]
}

// Tipos de fee_details que representam impostos no ML Brasil
const TAX_FEE_TYPES = new Set([
  'taxes', 'tax', 'imposto', 'iva', 'vat',
  'income_tax', 'withholding_tax', 'retention_tax',
  'icms', 'iss', 'pis', 'cofins', 'csll', 'irpj', 'irrf',
])

function isTaxType(type: string): boolean {
  const t = type.toLowerCase()
  return TAX_FEE_TYPES.has(t) || t.includes('tax') || t.includes('imposto') || t.includes('icms')
}

function extractFromFeeDetails(feeDetails: MLFeeDetail[]) {
  let commission = 0
  let shipping   = 0
  let rebate     = 0
  let taxes      = 0  // impostos retidos pelo ML

  for (const fee of feeDetails) {
    const amount = Number(fee.amount ?? fee.fee_amount ?? 0)
    const type   = (fee.type ?? '').toLowerCase()

    if (type === 'ml_fee') {
      commission = Math.abs(amount)
    } else if (isTaxType(type)) {
      // Impostos retidos pelo ML
      taxes += Math.abs(amount)
    } else if (
      // Tipos de frete conhecidos no ML Brasil
      type === 'mercadoenvios'          ||   // ← tipo real do frete no ML BR
      type === 'mercadoenvios_ml'        ||
      type.includes('shipping')         ||
      type.includes('carrier')          ||
      type.includes('logistic')         ||
      type.includes('envios')           ||
      type.includes('frete')            ||
      type === 'fulfillment'
    ) {
      if (amount > 0) shipping += amount
    } else if (amount < 0) {
      // Valores negativos = rebates / descontos devolvidos ao vendedor
      rebate += Math.abs(amount)
    }
  }

  return { commission, shipping, rebate, taxes }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db   = createSupabaseServiceClient()
  const body = await request.json().catch(() => ({}))
  const batchSize = Math.min(Number(body.batch ?? 25), 40)
  const offset    = Number(body.offset ?? 0)

  // Vendas ML sem frete preenchido (ainda não processadas)
  const { data: sales, error: salesErr } = await db
    .from('sales')
    .select('id, external_order_id, sku, marketplace_commission, marketplace_shipping_fee, rebate')
    .eq('marketplace', 'mercado_livre')
    .eq('marketplace_shipping_fee', 0)
    .order('sale_date', { ascending: false })
    .range(offset, offset + batchSize - 1)

  if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })
  if (!sales?.length) {
    return NextResponse.json({
      ok: true, fixed: 0, total_processed: 0,
      message: 'Todas as vendas ML já têm frete preenchido.',
    })
  }

  let fixed  = 0
  let errors = 0
  let taxesSaved = 0
  const log: string[] = [`Processando ${sales.length} vendas (offset ${offset})`]

  for (const sale of sales) {
    const match = sale.external_order_id?.match(/^ml_(\d+)_/)
    if (!match) { log.push(`SKIP ${sale.id.slice(-8)}: external_order_id inválido`); continue }

    const orderId = match[1]

    try {
      await sleep(180)

      const order = await mlGet<MLOrderDetail>(`/orders/${orderId}`)

      let commission = Number(sale.marketplace_commission ?? 0)
      let shipping   = 0
      let rebate     = 0
      let mlTaxes    = 0  // impostos retidos pelo ML

      if (order.fee_details?.length) {
        const extracted = extractFromFeeDetails(order.fee_details)
        commission = extracted.commission || commission
        shipping   = extracted.shipping
        rebate     = extracted.rebate
        mlTaxes    = extracted.taxes
      } else {
        if (commission === 0 && order.order_items?.length) {
          commission = order.order_items.reduce((s, i) => s + Number(i.sale_fee ?? 0), 0)
        }
      }

      // Impostos do campo taxes (nível do pedido — BR específico)
      if (order.taxes?.amount && order.taxes.amount > 0) {
        mlTaxes = Math.max(mlTaxes, Number(order.taxes.amount))
      }

      // Impostos retidos nos pagamentos
      const taxesFromPayments = (order.payments ?? []).reduce((s, p) =>
        s + Math.abs(Number(p.taxes_withheld ?? 0)), 0)
      if (taxesFromPayments > 0) mlTaxes = Math.max(mlTaxes, taxesFromPayments)

      // Salva na tabela sales
      const salesUpdates: Record<string, number> = {}
      if (commission > 0) salesUpdates.marketplace_commission   = commission
      if (shipping   > 0) salesUpdates.marketplace_shipping_fee = shipping
      if (rebate     > 0) salesUpdates.rebate                   = rebate

      if (Object.keys(salesUpdates).length > 0) {
        const { error: updErr } = await db.from('sales').update(salesUpdates).eq('id', sale.id)
        if (updErr) {
          log.push(`ERRO sales ${sale.id.slice(-8)}: ${updErr.message}`)
          errors++
          continue
        }
        fixed++
      }

      // Salva impostos ML em sale_taxes (merge com impostos da NF-e se já existirem)
      if (mlTaxes > 0) {
        const { error: taxErr } = await db
          .from('sale_taxes')
          .upsert({
            sale_id:     sale.id,
            nfe_key:     null,           // sem NF-e — fonte é o ML
            pis:         0,
            cofins:      0,
            icms:        mlTaxes,        // agrega como ICMS (ML não discrimina por tipo)
            icms_difal:  0,
            ipi:         0,
          }, { onConflict: 'sale_id' })

        if (!taxErr) taxesSaved++
      }

      log.push(
        `✓ ${sale.sku?.slice(0, 8)} ${sale.id.slice(-8)}: ` +
        `com=${commission.toFixed(2)} frete=${shipping.toFixed(2)} ` +
        `rebate=${rebate.toFixed(2)} impostos=${mlTaxes.toFixed(2)}`
      )

    } catch (err) {
      log.push(`ERRO ${sale.id.slice(-8)}: ${String(err).slice(0, 80)}`)
      errors++
    }
  }

  return NextResponse.json({
    ok: errors === 0,
    fixed,
    taxes_saved: taxesSaved,
    errors,
    total_processed: sales.length,
    next_offset: offset + batchSize,
    has_more: sales.length === batchSize,
    message: `${fixed} vendas atualizadas, ${taxesSaved} com impostos ML`,
    log,
  })
}
