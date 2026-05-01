import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

// Returns sales from today + yesterday, grouped by marketplace
export async function GET(req: NextRequest) {
  const db = createSupabaseServiceClient()
  const url = new URL(req.url)
  const days = Number(url.searchParams.get('days') ?? '1')
  const since = format(subDays(new Date(), Math.min(days, 7)), 'yyyy-MM-dd')
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: sales, error } = await db
    .from('sales')
    .select(`
      id, marketplace, fulfillment_type, sku, sale_date, quantity,
      gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation,
      products(name, sku),
      sale_costs(unit_cost_applied, total_cost, margin_pct)
    `)
    .gte('sale_date', since)
    .lte('sale_date', today)
    .order('sale_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sales: sales ?? [], since, today })
}
