export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { SkuCostTable, type SkuCostRow } from '@/components/configuracoes/SkuCostTable'

export default async function CustosPorSkuPage() {
  const db = createSupabaseServiceClient()

  const [{ data: products }, { data: cmps }, { data: salesRaw }] = await Promise.all([
    db.from('products').select('id, sku, name, cost_locked, archived').order('sku'),
    db.from('cmp_costs')
      .select('product_id, cmp_value, effective_date, calculated_at, total_stock_qty')
      .order('effective_date', { ascending: false })
      .order('calculated_at', { ascending: false }),
    db.from('sales').select('product_id').not('product_id', 'is', null).limit(10000),
  ])

  // Custo VIGENTE = primeiro registro por produto (já ordenado por vigência+recálculo)
  const current = new Map<string, { cmp_value: number; effective_date: string; total_stock_qty: number }>()
  for (const c of (cmps ?? []) as any[]) {
    if (!current.has(c.product_id)) current.set(c.product_id, c)
  }

  const salesCount: Record<string, number> = {}
  for (const s of (salesRaw ?? []) as { product_id: string }[]) {
    salesCount[s.product_id] = (salesCount[s.product_id] ?? 0) + 1
  }

  const rows: SkuCostRow[] = ((products ?? []) as any[]).map(p => {
    const c = current.get(p.id)
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      cost: c ? Number(c.cmp_value) : null,
      effectiveDate: c?.effective_date ?? null,
      // Entrada manual grava total_stock_qty=1 (placeholder); NF grava a qtde do lote
      source: c ? (Number(c.total_stock_qty) === 1 ? 'manual' as const : 'nf' as const) : null,
      locked: !!p.cost_locked,
      archived: !!p.archived,
      salesCount: salesCount[p.id] ?? 0,
    }
  }).sort((a, b) => b.salesCount - a.salesCount)

  return (
    <>
      <TopBar
        title="Custos por SKU"
        subtitle="Custo vigente de cada produto — edite manualmente informando desde quando vale; trave SKUs de kits para NFs não alterarem"
      />
      <div className="px-4 md:px-8 py-6">
        <SkuCostTable rows={rows} />
      </div>
    </>
  )
}
