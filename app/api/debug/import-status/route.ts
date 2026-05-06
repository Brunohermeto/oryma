import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  const [ordersRes, itemsRes, unitCostsRes, cmpRes, productsRes] = await Promise.all([
    db.from('import_orders').select('id, nfe_number, supplier, issue_date, costs_complete').order('issue_date', { ascending: false }),
    db.from('import_items').select('id, import_order_id, sku, product_id, quantity, total_fob_value'),
    db.from('unit_costs').select('id, product_id, total_unit_cost, quantity_in_batch'),
    db.from('cmp_costs').select('id, product_id, cmp_value'),
    db.from('products').select('id, sku, name'),
  ])

  return NextResponse.json({
    import_orders:  { count: ordersRes.data?.length ?? 0, data: ordersRes.data },
    import_items:   { count: itemsRes.data?.length ?? 0,  data: itemsRes.data },
    unit_costs:     { count: unitCostsRes.data?.length ?? 0 },
    cmp_costs:      { count: cmpRes.data?.length ?? 0, data: cmpRes.data },
    products:       { count: productsRes.data?.length ?? 0 },
  })
}
