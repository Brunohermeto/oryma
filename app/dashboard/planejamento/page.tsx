export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { PlanejamentoView, type RupturaRow, type ProductOption, type ProjecaoMes } from '@/components/planejamento/PlanejamentoView'
import type { FluxoGeralData } from '@/components/planejamento/FluxoGeralMatriz'
import { resolvePlanDates, type ImportPlan, type ImportProfile } from '@/lib/import-planning/engine'
import { format, subDays } from 'date-fns'

export default async function PlanejamentoPage() {
  const db = createSupabaseServiceClient()
  const hoje = format(new Date(), 'yyyy-MM-dd')

  const [{ data: profiles }, { data: plans }, { data: items }, { data: products }] = await Promise.all([
    db.from('import_profiles').select('*').order('root_sku'),
    db.from('import_plans').select('*').order('order_date', { ascending: false }),
    db.from('import_plan_items').select('*'),
    db.from('products').select('id, sku, name, stock_quantity, stock_full, stock_fba, stock_shopee, archived').eq('archived', false).order('sku'),
  ])

  // Produtos das famílias com perfil cadastrado + qualquer produto que apareça
  // em item de pedido (pedido novo com SKU novo entra nas planilhas sozinho).
  const roots = (profiles ?? []).map(p => String(p.root_sku).toUpperCase())
  const daFamilia = (sku: string) => roots.some(r => sku.toUpperCase().startsWith(r))
  const idsEmPedidos = new Set((items ?? []).map(i => i.product_id).filter(Boolean))
  const familyProducts = (products ?? []).filter(p => daFamilia(p.sku) || idsEmPedidos.has(p.id))

  // Velocidade real: 12 meses descontando rupturas (gaps > 14d sem venda)
  const yearAgo = format(subDays(new Date(), 365), 'yyyy-MM-dd')
  const PAGE = 1000
  const yearSales: Array<{ product_id: string; sale_date: string; quantity: number; gross_price?: number }> = []
  for (let off = 0; ; off += PAGE) {
    const { data } = await db.from('sales')
      .select('product_id, sale_date, quantity, gross_price')
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
  // Realizado por produto/mês (unidades e faturamento) para os meses passados
  const realBy = new Map<string, Record<string, { qty: number; gross: number }>>()
  for (const s of yearSales) {
    soldBy.set(s.product_id, (soldBy.get(s.product_id) ?? 0) + Number(s.quantity ?? 1))
    if (!datesBy.has(s.product_id)) datesBy.set(s.product_id, [])
    datesBy.get(s.product_id)!.push(s.sale_date)
    const m = s.sale_date.slice(0, 7)
    if (!realBy.has(s.product_id)) realBy.set(s.product_id, {})
    const rm = realBy.get(s.product_id)!
    if (!rm[m]) rm[m] = { qty: 0, gross: 0 }
    rm[m].qty   += Number(s.quantity ?? 1)
    rm[m].gross += Number(s.gross_price ?? 0)
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
  const arrivalsByProduct = new Map<string, Array<{ date: string; qty: number; invoice: string; compromissado: boolean }>>()
  // Custo de planejamento por produto: custo unitário do item de pedido mais recente com custo informado
  const custoPlanBy = new Map<string, number>()
  for (const pl of (plans ?? []) as ImportPlan[]) {
    const prof = profById.get(pl.profile_id ?? '')
    if (!prof) continue
    for (const it of (items ?? []).filter(i => i.plan_id === (pl as any).id)) {
      if (it.product_id && !custoPlanBy.has(it.product_id) && Number(it.custo_total) > 0 && Number(it.quantity) > 0) {
        custoPlanBy.set(it.product_id, Number(it.custo_total) / Number(it.quantity))
      }
    }
    const dates = resolvePlanDates(pl, prof, hoje)
    // chegadas passadas (realizado) entram na matriz; futuras só de pedidos não concluídos
    if (pl.done && dates.dg >= hoje) continue
    for (const it of (items ?? []).filter(i => i.plan_id === (pl as any).id)) {
      const key = it.product_id ?? `sku:${it.sku}`
      if (!arrivalsByProduct.has(key)) arrivalsByProduct.set(key, [])
      arrivalsByProduct.get(key)!.push({ date: dates.dg, qty: Number(it.quantity), invoice: pl.invoice, compromissado: pl.compromissado !== false })
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
    const stock = Number(p.stock_quantity ?? 0) + Number((p as any).stock_full ?? 0) + Number((p as any).stock_fba ?? 0) + Number((p as any).stock_shopee ?? 0)
    const diasAteRuptura = Math.floor(stock / vel)
    const dataRuptura = format(subDays(new Date(), -diasAteRuptura), 'yyyy-MM-dd')
    const chegadas = (arrivalsByProduct.get(p.id) ?? []).filter(a => a.date >= hoje).sort((a, b) => (a.date < b.date ? -1 : 1))
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
  // Também captura o SALDO de estoque no fim de cada mês (matriz por tempo).
  const receitaMes = new Map<string, { receita: number; lucro: number }>()
  const estoqueTempo: Array<{ sku: string; name: string; vel: number; meses: Record<string, number> }> = []
  const addD = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return format(d, 'yyyy-MM-dd') }
  for (const p of familyProducts) {
    const sold = soldBy.get(p.id) ?? 0
    if (sold <= 0) continue
    const vel = sold / activeDays(datesBy.get(p.id) ?? [])
    if (vel <= 0) continue
    const agg = priceAgg.get(p.id)
    const avgPrice  = agg && agg.qty > 0 ? agg.gross / agg.qty : 0
    const marginPct = agg && agg.mvGross > 0 ? agg.mv / agg.mvGross : 0
    const chegadas = new Map<string, number>()
    for (const a of arrivalsByProduct.get(p.id) ?? []) {
      if (a.date < hoje) continue
      chegadas.set(a.date, (chegadas.get(a.date) ?? 0) + a.qty)
    }
    let avail = Number(p.stock_quantity ?? 0) + Number((p as any).stock_full ?? 0) + Number((p as any).stock_fba ?? 0) + Number((p as any).stock_shopee ?? 0)
    const meses: Record<string, number> = {}
    for (let d = 0; d < 365; d++) {
      const dia = addD(d)
      avail += chegadas.get(dia) ?? 0
      const vendeu = Math.min(vel, avail)
      avail -= vendeu
      const mes = dia.slice(0, 7)
      // fim de mês (ou último dia simulado) → registra o saldo
      if (d === 364 || addD(d + 1).slice(0, 7) !== mes) meses[mes] = Math.round(avail)
      if (vendeu > 0 && avgPrice > 0) {
        if (!receitaMes.has(mes)) receitaMes.set(mes, { receita: 0, lucro: 0 })
        const r = receitaMes.get(mes)!
        r.receita += vendeu * avgPrice
        r.lucro   += vendeu * avgPrice * marginPct
      }
    }
    estoqueTempo.push({ sku: p.sku, name: p.name, vel: Math.round(vel * 100) / 100, meses })
  }
  estoqueTempo.sort((a, b) => (a.sku < b.sku ? -1 : 1))
  const projecao: ProjecaoMes[] = [...receitaMes.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 12)
    .map(([mes, v]) => ({ mes, receita: Math.round(v.receita), lucro: Math.round(v.lucro) }))

  // ── Fluxo Geral (formato da planilha): 24 meses, blocos empilhados ──
  const [{ data: salesPlan }, { data: prodParams }, { data: cashCfgRows }, { data: cashMonths }, { data: cmpAll }] = await Promise.all([
    db.from('import_sales_plan').select('product_id, mes, qty').limit(5000),
    db.from('import_product_params').select('product_id, preco_venda, vel_projetada, margem_projetada, estoque_manual, estoque_manual_mes'),
    db.from('import_cash_config').select('*').eq('id', 1),
    db.from('import_cash_months').select('*'),
    db.from('cmp_costs').select('product_id, cmp_value, effective_date, calculated_at')
      .order('effective_date', { ascending: false }).order('calculated_at', { ascending: false }).limit(3000),
  ])
  const cmpVigente = new Map<string, number>()
  for (const c of cmpAll ?? []) if (!cmpVigente.has(c.product_id)) cmpVigente.set(c.product_id, Number(c.cmp_value))
  const planoBy = new Map<string, Record<string, number>>()
  for (const sp of salesPlan ?? []) {
    if (!planoBy.has(sp.product_id)) planoBy.set(sp.product_id, {})
    planoBy.get(sp.product_id)![sp.mes] = Number(sp.qty)
  }
  const paramBy = new Map((prodParams ?? []).map(p => [p.product_id, p.preco_venda ? Number(p.preco_venda) : null]))
  const paramFullBy = new Map((prodParams ?? []).map(p => [p.product_id, p]))

  // Linha do tempo: de janeiro do ano corrente (realizado) até 24 meses à frente
  const mesAtual = format(new Date(), 'yyyy-MM')
  const mesesFG: string[] = []
  {
    const d = new Date(); d.setDate(1); d.setMonth(0)
    const fim = new Date(); fim.setDate(1); fim.setMonth(fim.getMonth() + 23)
    while (d <= fim) {
      mesesFG.push(format(d, 'yyyy-MM'))
      d.setMonth(d.getMonth() + 1)
    }
  }
  const fgRows: FluxoGeralData['rows'] = []
  for (const p of familyProducts) {
    const sold = soldBy.get(p.id) ?? 0
    const vel = sold > 0 ? sold / activeDays(datesBy.get(p.id) ?? []) : 0
    const agg = priceAgg.get(p.id)
    const entradas: Record<string, number> = {}
    for (const a of arrivalsByProduct.get(p.id) ?? []) {
      if (!a.compromissado) continue
      const m = a.date.slice(0, 7)
      entradas[m] = (entradas[m] ?? 0) + a.qty
    }
    const entradasPrev: Record<string, number> = {}
    for (const a of arrivalsByProduct.get(p.id) ?? []) {
      if (a.compromissado) continue
      const m = a.date.slice(0, 7)
      entradasPrev[m] = (entradasPrev[m] ?? 0) + a.qty
    }
    const plano = planoBy.get(p.id) ?? {}
    // SKU que é exatamente a raiz de um perfil (produto novo em planejamento) sempre aparece
    const ehRaizDePerfil = roots.includes(p.sku.toUpperCase())
    if (!ehRaizDePerfil && vel <= 0 && !Object.keys(entradas).length && !Object.keys(entradasPrev).length && !Object.keys(plano).length) continue
    const par = paramFullBy.get(p.id) as any
    fgRows.push({
      productId: p.id, sku: p.sku, name: p.name,
      estoqueAtual: Number(p.stock_quantity ?? 0) + Number((p as any).stock_full ?? 0) + Number((p as any).stock_fba ?? 0) + Number((p as any).stock_shopee ?? 0),
      velReal: Math.round(vel * 100) / 100,
      velProj: par?.vel_projetada != null ? Number(par.vel_projetada) : null,
      marginProj: par?.margem_projetada != null ? Number(par.margem_projetada) : null,
      estoqueManual: par?.estoque_manual != null ? Number(par.estoque_manual) : null,
      estoqueManualMes: par?.estoque_manual_mes ?? null,
      cmp: cmpVigente.get(p.id) ?? 0,
      custoPlan: custoPlanBy.get(p.id) ?? null,
      precoReal: agg && agg.qty > 0 ? Math.round((agg.gross / agg.qty) * 100) / 100 : 0,
      precoParam: paramBy.get(p.id) ?? null,
      marginPct: agg && agg.mvGross > 0 ? Math.round((agg.mv / agg.mvGross) * 1000) / 10 : 0,
      entradas, entradasPrev, plano,
      realizado: realBy.get(p.id) ?? {},
    })
  }
  fgRows.sort((a, b) => (a.sku < b.sku ? -1 : 1))
  const cashCfg = (cashCfgRows ?? [])[0] ?? { saldo_inicial: 0, difal_pct: 0, difal_saldo_inicial: 0 }
  const fluxoGeral: FluxoGeralData = {
    meses: mesesFG,
    mesAtual,
    rows: fgRows,
    roots,
    saldoInicial: Number(cashCfg.saldo_inicial ?? 0),
    difalPct: Number(cashCfg.difal_pct ?? 0),
    difalSaldoInicial: Number((cashCfg as any).difal_saldo_inicial ?? 0),
    cashMonths: Object.fromEntries((cashMonths ?? []).map(m => [m.mes, { divida: Number(m.divida), retirada: Number(m.retirada) }])),
  }

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
          estoqueTempo={estoqueTempo}
          fluxoGeral={fluxoGeral}
          hoje={hoje}
        />
      </div>
    </>
  )
}
