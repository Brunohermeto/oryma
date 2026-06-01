/**
 * GET /api/debug/ml-fee-types
 * Busca os fee_details de uma amostra de pedidos ML para ver
 * quais tipos (type) existem. Ajuda a diagnosticar por que
 * frete, rebate ou comissão não são extraídos corretamente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { mlGet } from '@/lib/integrations/mercado-livre'

export const dynamic     = 'force-dynamic'
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // Pega 5 vendas ML recentes
  const { data: sales } = await db
    .from('sales')
    .select('id, external_order_id, sku, gross_price, marketplace_commission, marketplace_shipping_fee, rebate')
    .eq('marketplace', 'mercado_livre')
    .order('sale_date', { ascending: false })
    .limit(5)

  const results = []

  for (const sale of sales ?? []) {
    const match = sale.external_order_id?.match(/^ml_(\d+)_/)
    if (!match) continue

    await sleep(200)
    try {
      const order = await mlGet<{ id: number; fee_details?: Array<{ type: string; amount?: number; fee_amount?: number }> }>(`/orders/${match[1]}`)
      results.push({
        sale_id: sale.id.slice(-8),
        sku: sale.sku,
        gross_price: sale.gross_price,
        stored: {
          commission: sale.marketplace_commission,
          shipping: sale.marketplace_shipping_fee,
          rebate: sale.rebate,
        },
        fee_details: order.fee_details ?? [],
      })
    } catch (e) {
      results.push({ sale_id: sale.id.slice(-8), error: String(e) })
    }
  }

  // Agrega todos os tipos encontrados
  const allTypes = new Set<string>()
  for (const r of results) {
    if ('fee_details' in r) {
      for (const f of r.fee_details as Array<{ type: string; amount?: number }>) {
        allTypes.add(`${f.type} (amount=${f.amount ?? 0 > 0 ? '+' : ''}${f.amount ?? 0})`)
      }
    }
  }

  return NextResponse.json({
    all_fee_types_found: Array.from(allTypes).sort(),
    samples: results,
  })
}
