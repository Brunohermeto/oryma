/**
 * GET /api/debug/products-without-cmp
 * Lista todos os produtos que têm vendas mas não têm CMP.
 * Útil para identificar quais SKUs do ML precisam ser mapeados
 * para o produto correto no Bling (que tem NF-e de entrada).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'gru1'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // Produtos que têm CMP
  const { data: cmps } = await db
    .from('cmp_costs')
    .select('product_id, cmp_value, effective_date')
    .order('effective_date', { ascending: false })

  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))

  // Último CMP por produto
  const cmpByProduct: Record<string, { cmp_value: number; effective_date: string }> = {}
  for (const c of (cmps ?? []) as { product_id: string; cmp_value: number; effective_date: string }[]) {
    if (!cmpByProduct[c.product_id]) {
      cmpByProduct[c.product_id] = { cmp_value: c.cmp_value, effective_date: c.effective_date }
    }
  }

  // Todos os produtos
  const { data: products } = await db
    .from('products')
    .select('id, sku, name')

  const prodMap: Record<string, { id: string; sku: string; name: string }> = {}
  for (const p of (products ?? []) as { id: string; sku: string; name: string }[]) {
    prodMap[p.id] = p
  }

  // Vendas agrupadas por product_id (só as que têm product_id)
  // Usa paginação para contornar limite 1000 do PostgREST
  const PAGE = 1000
  const allSales: { product_id: string; sku: string; marketplace: string }[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('sales')
      .select('product_id, sku, marketplace')
      .not('product_id', 'is', null)
      .range(offset, offset + PAGE - 1)
    if (error || !data?.length) break
    allSales.push(...data)
    if (data.length < PAGE) break
  }

  // Agrupa por product_id
  const salesByProduct: Record<string, { count: number; skus: Set<string>; marketplaces: Set<string> }> = {}
  for (const s of allSales) {
    if (!s.product_id) continue
    if (!salesByProduct[s.product_id]) {
      salesByProduct[s.product_id] = { count: 0, skus: new Set(), marketplaces: new Set() }
    }
    salesByProduct[s.product_id].count++
    salesByProduct[s.product_id].skus.add(s.sku ?? '')
    salesByProduct[s.product_id].marketplaces.add(s.marketplace ?? '')
  }

  // Produtos COM vendas mas SEM CMP (são os problemáticos)
  const withoutCmp = Object.entries(salesByProduct)
    .filter(([productId]) => !prodWithCmp.has(productId))
    .map(([productId, info]) => ({
      product_id: productId,
      sku: prodMap[productId]?.sku ?? '???',
      name: prodMap[productId]?.name ?? '???',
      sales_count: info.count,
      ml_skus_used: Array.from(info.skus).filter(Boolean),
      marketplaces: Array.from(info.marketplaces).filter(Boolean),
    }))
    .sort((a, b) => b.sales_count - a.sales_count)

  // Produtos COM CMP (para referência — possíveis destinos do mapeamento)
  const withCmp = Object.entries(cmpByProduct)
    .map(([productId, cmp]) => ({
      product_id: productId,
      sku: prodMap[productId]?.sku ?? '???',
      name: prodMap[productId]?.name ?? '???',
      cmp_value: cmp.cmp_value,
      effective_date: cmp.effective_date,
      has_sales: !!salesByProduct[productId],
      sales_count: salesByProduct[productId]?.count ?? 0,
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku))

  return NextResponse.json({
    summary: {
      total_products_with_sales: Object.keys(salesByProduct).length,
      products_with_cmp: prodWithCmp.size,
      products_WITHOUT_cmp: withoutCmp.length,
    },
    products_without_cmp: withoutCmp,
    products_with_cmp: withCmp,
  })
}
