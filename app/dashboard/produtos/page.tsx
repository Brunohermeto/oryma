import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ProductsTable, type ProductRow } from '@/components/produtos/ProductsTable'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

export default async function ProdutosPage() {
  const db = createSupabaseServiceClient()

  // 3 consultas totais: produtos, CMP mais recente, vendas dos últimos 30 dias
  const [{ data: products }, { data: allCmps }, { data: recentSales }] = await Promise.all([
    db.from('products').select('id, name, sku, stock_quantity').order('name'),
    db.from('cmp_costs')
      .select('product_id, cmp_value, calculated_at')
      .order('calculated_at', { ascending: false })
      .limit(5000),
    db.from('sales')
      .select('product_id, quantity')
      .gte('sale_date', brazilDaysAgo(30))
      .not('product_id', 'is', null)
      .limit(5000),
  ])

  const cmpByProduct = new Map<string, number>()
  for (const c of allCmps ?? []) {
    if (!cmpByProduct.has(c.product_id)) cmpByProduct.set(c.product_id, Number(c.cmp_value))
  }

  const soldByProduct = new Map<string, number>()
  for (const s of recentSales ?? []) {
    soldByProduct.set(s.product_id, (soldByProduct.get(s.product_id) ?? 0) + Number(s.quantity ?? 1))
  }

  const rows: ProductRow[] = (products ?? []).map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    stock: Number(p.stock_quantity ?? 0),
    velocity30d: soldByProduct.get(p.id) ?? 0,
    cmp: cmpByProduct.get(p.id) ?? null,
  }))

  return (
    <>
      <TopBar title="Produtos & Estoque" subtitle="Estoque, velocidade de venda e cobertura por produto" />
      <div className="px-4 md:px-8 pt-4 flex gap-2">
        <a href="/dashboard/velocidade" className="text-[12px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'oklch(0.96 0.010 258)', color: '#125BFF' }}>Giro e Velocidade →</a>
        <a href="/dashboard/precificacao" className="text-[12px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'oklch(0.96 0.010 258)', color: '#125BFF' }}>Simulador de Margem →</a>
      </div>
      <div className="px-4 md:px-8 py-6">
        <ProductsTable rows={rows} />
      </div>
    </>
  )
}
