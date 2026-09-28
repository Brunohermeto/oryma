import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { fetchAllParallel } from '@/lib/supabase/fetch-all'
import { brazilToday, brazilDaysAgo } from '@/lib/utils/brazil-time'
import { isReturned } from '@/lib/sales/returned'
import { aggBy } from '@/lib/sales/metrics'

const LIST_LIMIT = 200

// Vendas dos últimos N dias (fuso do Brasil: days=1 = só hoje), mais recentes
// primeiro. A lista vem cortada em 200 cards; os TOTAIS por canal (`totals`)
// somam o período inteiro, paginado, sem as devolvidas.
export async function GET(req: NextRequest) {
  const db = createSupabaseServiceClient()
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? '1') || 1, 1), 7)
  const since = brazilDaysAgo(days - 1)
  const today = brazilToday()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[]
  try {
    rows = await fetchAllParallel(() => db
      .from('sales')
      .select(`
        id, marketplace, fulfillment_type, sku, sale_date, quantity,
        gross_price, shipping_received, marketplace_commission, marketplace_shipping_fee,
        marketplace_fixed_fee, rebate, ads_cost, cancellation, discounts,
        products(name, sku),
        sale_costs(unit_cost_applied, total_cost, margin_pct, margin_value),
        sale_taxes(total_taxes)
      `, { count: 'exact' })
      .gte('sale_date', since)
      .lte('sale_date', today)
      .order('id', { ascending: true }))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  // relações podem vir como array (sem UNIQUE constraint) ou objeto — normaliza
  const one = (v: unknown) => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  const normalized = rows.map(s => ({
    ...s,
    sale_costs: one(s.sale_costs),
    products: one(s.products),
    sale_taxes: one(s.sale_taxes),
    returned: isReturned(s),
  }))
  normalized.sort((a, b) => a.sale_date === b.sale_date
    ? (a.id < b.id ? 1 : -1)
    : (a.sale_date < b.sale_date ? 1 : -1))

  const valid = normalized.filter(s => !s.returned)
  const totals = Object.fromEntries([...aggBy(
    valid.map(s => ({ ...s, margin_value: s.sale_costs?.margin_value ?? null })),
    s => s.marketplace,
  )].map(([mp, a]) => [mp, { faturamento: a.revenue, lucro: a.mv, count: a.orders }]))

  return NextResponse.json({ sales: normalized.slice(0, LIST_LIMIT), totals, since, today })
}
