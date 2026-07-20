import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ProductsTable, type ProductRow } from '@/components/produtos/ProductsTable'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

export default async function ProdutosPage() {
  const db = createSupabaseServiceClient()

  // Vendas dos últimos 12 meses (paginado — PostgREST devolve no máx. 1000/página)
  async function fetchAllSales() {
    const out: Array<{ product_id: string; quantity: number; sale_date: string }> = []
    for (let page = 0; page < 12; page++) {
      const { data } = await db.from('sales')
        .select('product_id, quantity, sale_date')
        .gte('sale_date', brazilDaysAgo(365))
        .not('product_id', 'is', null)
        .order('sale_date', { ascending: true })
        .range(page * 1000, page * 1000 + 999)
      if (!data?.length) break
      out.push(...data)
      if (data.length < 1000) break
    }
    return out
  }

  const [{ data: products }, { data: allCmps }, yearSales] = await Promise.all([
    db.from('products').select('id, name, sku, stock_quantity, stock_full').order('name'),
    db.from('cmp_costs')
      .select('product_id, cmp_value, calculated_at')
      .order('calculated_at', { ascending: false })
      .limit(5000),
    fetchAllSales(),
  ])

  const cmpByProduct = new Map<string, number>()
  for (const c of allCmps ?? []) {
    if (!cmpByProduct.has(c.product_id)) cmpByProduct.set(c.product_id, Number(c.cmp_value))
  }

  // Velocidade com desconto de ruptura: janela de 12m, mas intervalos sem
  // NENHUMA venda acima de 14 dias contam como falta de estoque e saem do
  // denominador (sem histórico diário de estoque, o gap é o melhor termômetro).
  // ponytail: heurística de gap; trocar por snapshots de estoque se um dia existirem
  const GAP_MAX = 14
  const datesByProduct = new Map<string, string[]>()
  const soldByProduct = new Map<string, number>()
  for (const s of yearSales) {
    soldByProduct.set(s.product_id, (soldByProduct.get(s.product_id) ?? 0) + Number(s.quantity ?? 1))
    if (!datesByProduct.has(s.product_id)) datesByProduct.set(s.product_id, [])
    datesByProduct.get(s.product_id)!.push(s.sale_date)
  }
  const today = new Date()
  function activeDays(dates: string[]): number {
    if (!dates.length) return 0
    let days = 1
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000
      days += Math.min(gap, GAP_MAX)
    }
    const tail = (today.getTime() - new Date(dates[dates.length - 1]).getTime()) / 86400000
    days += Math.min(Math.max(tail, 0), GAP_MAX)
    return Math.max(days, 1)
  }

  const rows: ProductRow[] = (products ?? []).map(p => {
    const sold = soldByProduct.get(p.id) ?? 0
    const dias = activeDays(datesByProduct.get(p.id) ?? [])
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock: Number(p.stock_quantity ?? 0),
      stockFull: Number((p as any).stock_full ?? 0),
      sold12m: sold,
      velocityPerDay: sold > 0 ? sold / dias : 0,
      cmp: cmpByProduct.get(p.id) ?? null,
    }
  })

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
