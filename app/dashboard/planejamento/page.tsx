export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { PlanejamentoView, type RupturaRow, type ProductOption, type ProjecaoMes } from '@/components/planejamento/PlanejamentoView'
import { resolvePlanDates, type ImportPlan, type ImportProfile } from '@/lib/import-planning/engine'
import { format, subDays } from 'date-fns'

export default async function PlanejamentoPage() {
  const db = createSupabaseServiceClient()
  const hoje = format(new Date(), 'yyyy-MM-dd')

  const [{ data: profiles }, { data: plans }, { data: items }, { data: products }] = await Promise.all([
    db.from('import_profiles').select('*').order('root_sku'),
    db.from('import_plans').select('*').order('order_date', { ascending: false }),
    db.from('import_plan_items').select('*'),
    db.from('products').select('id, sku, name, stock_quantity, stock_full, archived').eq('archived', false).order('sku'),
  ])

  // Só produtos das famílias com perfil de importação cadastrado (planilha do
  // Bruno). Para incluir outro produto: criar o perfil dele na aba Perfis.
  const roots = (profiles ?? []).map(p => String(p.root_sku).toUpperCase())
  const daFamilia = (sku: string) => roots.some(r => sku.toUpperCase().startsWith(r))
  const familyProducts = (products ?? []).filter(p => daFamilia(p.sku))

  // Velocidade real: 12 meses descontando rupturas (gaps > 14d sem venda)
  const yearAgo = format(subDays(new Date(), 365), 'yyyy-MM-dd')
  const PAGE = 1000
  const yearSales: Array<{ product_id: string; sale_date: string; quantity: number }> = []
  for (let off = 0; ; off += PAGE) {
    const { data } = await db.from('sales')
      .select('product_id, sale_date, quantity')
      .gte('sale_date', yearAgo).not('product_id', 'is', null)
      .order('sale_date', { ascending: true })
      .range(off, off + PAGE - 1)
    if (!data?.length) break
    yearSales.push(...(data as any))
    if (data.length < PAGE) break
  }
  const GAP_MAX = 14
  const datesBy = new Map<string, string[]>()
  const soldBy  = new Map<string, number>()
  for (const s of yearSales) {
    soldBy.set(s.product_id, (soldBy.get(s.product_id) ?? 0) + Number(s.quantity ?? 1))
    if (!datesBy.has(s.product_id)) datesBy.set(s.product_id, [])
    datesBy.get(s.product_id)!.push(s.sale_date)
  }
  function activeDays(dates: string[]): number {
    if (!dates.length) return 0
    let days = 1
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000
      days += Math.min(gap, GAP_MAX)
    }
    const tail = (Date.now() - new Date(dates[dates.length - 1]).getTime()) / 86400000
    days += Math.min(Math.max(tail, 0), GAP_MAX)
    return Math.max(days, 1)
  }

  // Chegadas futuras por produto (itens de pedidos não concluídos, DG >= hoje)
  const profById = new Map((profiles ?? []).map(p => [p.id, p as ImportProfile]))
  const arrivalsByProduct = new Map<string, Array<{ date: string; qty: number; invoice: string }>>()
  for (const pl of (plans ?? []) as ImportPlan[]) {
    const prof = profById.get(pl.profile_id ?? '')
    if (!prof || pl.done) continue
    const dates = resolvePlanDates(pl, prof, hoje)
    if (dates.dg < hoje) continue
    for (const it of (items ?? []).filter(i => i.plan_id === (pl as any).id)) {
      const key = it.product_id ?? `sku:${it.sku}`
      if (!arrivalsByProduct.has(key)) arrivalsByProduct.set(key, [])
      arrivalsByProduct.get(key)!.push({ date: dates.dg, qty: Number(it.quantity), invoice: pl.invoice })
    }
  }

  // Pedidos em curso SEM itens preenchidos, por família (primeira chegada)
  const plansSemItens = new Map<string, { invoice: string; date: string }>()
  const planIdsComItens = new Set((items ?? []).map(i => i.plan_id))
  for (const pl of (plans ?? []) as (ImportPlan & { id: string })[]) {
    const prof = profById.get(pl.profile_id ?? '')
    if (!prof || pl.done || planIdsComItens.has(pl.id)) continue
    const dates = resolvePlanDates(pl, prof, hoje)
    if (dates.dg < hoje) continue
    const root = String(prof.root_sku).toUpperCase()
    const cur = plansSemItens.get(root)
    if (!cur || dates.dg < cur.date) plansSemItens.set(root, { invoice: pl.invoice, date: dates.dg })
  }

  // Painel de ruptura: produtos com giro (só famílias importadas)
  const ruptura: RupturaRow[] = []
  for (const p of familyProducts) {
    const sold = soldBy.get(p.id) ?? 0
    if (sold <= 0) continue
    const vel = sold / activeDays(datesBy.get(p.id) ?? [])
    if (vel <= 0) continue
    const stock = Number(p.stock_quantity ?? 0) + Number((p as any).stock_full ?? 0)
    const diasAteRuptura = Math.floor(stock / vel)
    const dataRuptura = format(subDays(new Date(), -diasAteRuptura), 'yyyy-MM-dd')
    const chegadas = (arrivalsByProduct.get(p.id) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1))
    const proxima = chegadas[0] ?? null
    const rootDoSku = roots.find(r => p.sku.toUpperCase().startsWith(r))
    ruptura.push({
      sku: p.sku, name: p.name, stock, velocityDay: Math.round(vel * 100) / 100,
      diasAteRuptura, dataRuptura,
      proximaChegada: proxima ? { date: proxima.date, qty: proxima.qty, invoice: proxima.invoice } : null,
      gapDias: proxima ? Math.round((new Date(proxima.date).getTime() - new Date(dataRuptura).getTime()) / 86400000) : null,
      pedidoSemItens: !proxima && rootDoSku ? (plansSemItens.get(rootDoSku) ?? null) : null,
    })
  }
  ruptura.sort((a, b) => a.diasAteRuptura - b.diasAteRuptura)

  const productOptions: ProductOption[] = familyProducts.map(p => ({ id: p.id, sku: p.sku, name: p.name }))

  // ── Etapa 3: receita projetada (12 meses) das famílias importadas ──
  // Preço médio e margem % dos últimos 60 dias, por produto
  const d60 = format(subDays(new Date(), 60), 'yyyy-MM-dd')
  const { data: recentSales } = await db.from('sales')
    .select('product_id, gross_price, quantity, sale_costs(margin_value)')
    .gte('sale_date', d60).not('product_id', 'is', null).limit(5000)
  const priceAgg = new Map<string, { gross: number; qty: number; mv: number; mvGross: number }>()
  for (const s of recentSales ?? []) {
    if (!priceAgg.has(s.product_id)) priceAgg.set(s.product_id, { gross: 0, qty: 0, mv: 0, mvGross: 0 })
    const a = priceAgg.get(s.product_id)!
    a.gross += Number(s.gross_price)
    a.qty   += Number(s.quantity ?? 1)
    const c = s.sale_costs as any
    const mv = (Array.isArray(c) ? c[0] : c)?.margin_value
    if (mv !== null && mv !== undefined) { a.mv += Number(mv); a.mvGross += Number(s.gross_price) }
  }

  // Simulação diária por produto: vende à velocidade real enquanto houver
  // estoque; chegada de pedido (com itens) repõe; sem estoque = sem receita.
  const receitaMes = new Map<string, { receita: number; lucro: number }>()
  const addD = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return format(d, 'yyyy-MM-dd') }
  for (const p of familyProducts) {
    const sold = soldBy.get(p.id) ?? 0
    if (sold <= 0) continue
    const vel = sold / activeDays(datesBy.get(p.id) ?? [])
    const agg = priceAgg.get(p.id)
    const avgPrice  = agg && agg.qty > 0 ? agg.gross / agg.qty : 0
    const marginPct = agg && agg.mvGross > 0 ? agg.mv / agg.mvGross : 0
    if (vel <= 0 || avgPrice <= 0) continue
    const chegadas = new Map<string, number>()
    for (const a of arrivalsByProduct.get(p.id) ?? []) {
      chegadas.set(a.date, (chegadas.get(a.date) ?? 0) + a.qty)
    }
    let avail = Number(p.stock_quantity ?? 0) + Number((p as any).stock_full ?? 0)
    for (let d = 0; d < 365; d++) {
      const dia = addD(d)
      avail += chegadas.get(dia) ?? 0
      const vendeu = Math.min(vel, avail)
      if (vendeu <= 0) continue
      avail -= vendeu
      const mes = dia.slice(0, 7)
      if (!receitaMes.has(mes)) receitaMes.set(mes, { receita: 0, lucro: 0 })
      const r = receitaMes.get(mes)!
      r.receita += vendeu * avgPrice
      r.lucro   += vendeu * avgPrice * marginPct
    }
  }
  const projecao: ProjecaoMes[] = [...receitaMes.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 12)
    .map(([mes, v]) => ({ mes, receita: Math.round(v.receita), lucro: Math.round(v.lucro) }))

  return (
    <>
      <TopBar
        title="Planejamento de Importação"
        subtitle="Pedidos, linha do tempo viva, pagamentos e projeção de ruptura — mude uma data e tudo recalcula"
      />
      <div className="px-4 md:px-8 py-6">
        <PlanejamentoView
          profiles={(profiles ?? []) as ImportProfile[]}
          plans={(plans ?? []) as (ImportPlan & { id: string })[]}
          items={(items ?? []) as any[]}
          ruptura={ruptura}
          products={productOptions}
          projecao={projecao}
          hoje={hoje}
        />
      </div>
    </>
  )
}
