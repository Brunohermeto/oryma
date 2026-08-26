import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ProductsTable, type ProductRow } from '@/components/produtos/ProductsTable'
import { PeriodoFilter } from '@/components/produtos/PeriodoFilter'
import { brazilDaysAgo, toBrazilDate } from '@/lib/utils/brazil-time'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const db = createSupabaseServiceClient()

  // Janela de análise (velocidade/cobertura) — período escolhido pelo usuário.
  // Padrão: últimos 12 meses.
  const params = await searchParams
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const dateTo   = iso.test(params.to ?? '')   ? params.to!   : toBrazilDate(new Date())
  const dateFrom = iso.test(params.from ?? '') ? params.from! : brazilDaysAgo(365)
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
  const periodLabel = `${br(dateFrom)} a ${br(dateTo)}`

  // Vendas do período escolhido (paginado — PostgREST devolve no máx. 1000/página)
  async function fetchAllSales() {
    const out: Array<{ product_id: string; quantity: number; sale_date: string }> = []
    for (let page = 0; page < 20; page++) {
      const { data } = await db.from('sales')
        .select('product_id, quantity, sale_date')
        .gte('sale_date', dateFrom).lte('sale_date', dateTo)
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
    db.from('products').select('id, name, sku, stock_quantity, stock_full, stock_fba, stock_fba_transito, stock_shopee, archived').order('name'),
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
  const fimJanela = new Date(dateTo).getTime()
  function activeDays(dates: string[]): number {
    if (!dates.length) return 0
    let days = 1
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000
      days += Math.min(gap, GAP_MAX)
    }
    const tail = (fimJanela - new Date(dates[dates.length - 1]).getTime()) / 86400000
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
      stockFull: Number((p as any).stock_full ?? 0) + Number((p as any).stock_fba ?? 0) + Number((p as any).stock_shopee ?? 0),
      stockFullMl: Number((p as any).stock_full ?? 0),
      stockFba:    Number((p as any).stock_fba ?? 0),
      stockFbaTransito: Number((p as any).stock_fba_transito ?? 0),
      stockShopee: Number((p as any).stock_shopee ?? 0),
      sold12m: sold,
      velocityPerDay: sold > 0 ? sold / dias : 0,
      cmp: cmpByProduct.get(p.id) ?? null,
      archived: !!(p as any).archived,
    }
  })

  return (
    <>
      <TopBar title="Produtos & Estoque" subtitle="Estoque, velocidade de venda e cobertura por produto" />
      <div className="px-4 md:px-8 pt-4 flex gap-2 flex-wrap items-center">
        <a href="/dashboard/velocidade" className="text-[12px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'oklch(0.96 0.010 258)', color: '#125BFF' }}>Giro e Velocidade →</a>
        <a href="/dashboard/precificacao" className="text-[12px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'oklch(0.96 0.010 258)', color: '#125BFF' }}>Simulador de Margem →</a>
      </div>
      <div className="px-4 md:px-8 pt-3">
        <PeriodoFilter from={dateFrom} to={dateTo} />
      </div>
      <div className="px-4 md:px-8 py-6">
        <ProductsTable rows={rows} periodLabel={periodLabel} />
      </div>
    </>
  )
}
