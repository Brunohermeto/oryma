/**
 * Ferramentas da Oryma Intelligence — SÓ LEITURA. O agente consulta os mesmos
 * números das telas (fórmula de lib/sales/metrics: faturamento = bruto −
 * devolução − cupom; devolvidas fora; margem = Σ margin_value ÷ Σ líq das vendas
 * apuradas). Pedido do Bruno 22/10/2026: insights e tendência de faturamento.
 */
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { isReturned } from '@/lib/sales/returned'
import { aggBy, liq, newAgg, addSale, pctOf, type Agg } from '@/lib/sales/metrics'
import { buildDRE } from '@/lib/dre/engine'
import { brazilToday, brazilDaysAgo } from '@/lib/utils/brazil-time'

const CANAIS = ['mercado_livre', 'shopee', 'amazon', 'magalu']
type Venda = {
  id: string; external_order_id: string; marketplace: string; product_id: string | null; sku: string | null; sale_date: string
  quantity: number; gross_price: number; cancellation: number | null; discounts: number | null; ads_cost: number | null
  rebate: number | null; cupom_codigo?: string | null; cupom_vendedor?: number | null; margin_value?: number | null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const pedidoDe = (s: Venda) => s.external_order_id.replace(/^[a-z]+_/, '').split('_')[0]
const resumo = (a: Agg, pedidos?: number) => ({
  faturamento: r2(a.revenue), itens: a.orders, ...(pedidos != null ? { pedidos } : {}),
  margem_pct: pctOf(a) != null ? r2(pctOf(a)!) : null, lucro_apurado: r2(a.mv),
})
const iso = (v: unknown, padrao: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : padrao)

/** Vendas do período (sem devolvidas), mês a mês e canal a canal — o join com
 *  sale_costs num período longo estoura o statement timeout */
async function vendas(de: string, ate: string, canal?: string | null): Promise<Venda[]> {
  const db = createSupabaseServiceClient()
  const meses: Array<[string, string]> = []
  for (let d = new Date(`${de.slice(0, 7)}-01T12:00:00`); d.toISOString().slice(0, 10) <= ate; d.setMonth(d.getMonth() + 1)) {
    const ini = d.toISOString().slice(0, 7) + '-01'
    const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).toISOString().slice(0, 10)
    meses.push([ini < de ? de : ini, fim > ate ? ate : fim])
  }
  const canais = canal ? [canal] : CANAIS
  // um mês por vez (no máx. 4 consultas simultâneas — 1 por canal)
  const partes: Array<Venda & { sale_costs: unknown }> = []
  for (const [i, f] of meses) {
    const r = await Promise.all(canais.map(c => fetchAll<Venda & { sale_costs: unknown }>(() =>
      db.from('sales').select('id, external_order_id, marketplace, product_id, sku, sale_date, quantity, gross_price, cancellation, discounts, ads_cost, rebate, cupom_codigo, cupom_vendedor, sale_costs(margin_value)')
        .eq('marketplace', c).gte('sale_date', i).lte('sale_date', f).order('id')).catch(() => [])))
    partes.push(...r.flat())
  }
  return partes.filter(s => !isReturned(s)).map(s => {
    const sc = (s as { sale_costs: unknown }).sale_costs as { margin_value: number | null } | { margin_value: number | null }[] | null
    return { ...s, margin_value: (Array.isArray(sc) ? sc[0] : sc)?.margin_value ?? null }
  })
}

const semana = (d: string) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10) }

export const TOOLS = [
  {
    name: 'resumo_periodo',
    description: 'Faturamento, pedidos, ticket médio, margem e ads por canal num período. Use para "como foi o mês", comparar canais ou períodos.',
    input_schema: { type: 'object', properties: {
      de: { type: 'string', description: 'AAAA-MM-DD' }, ate: { type: 'string', description: 'AAAA-MM-DD' },
      canal: { type: 'string', enum: CANAIS } }, required: ['de', 'ate'] },
  },
  {
    name: 'tendencia_faturamento',
    description: 'Série de faturamento, pedidos e margem por dia, semana ou mês, com variação entre períodos e projeção do mês corrente. Use para tendência, sazonalidade, crescimento/queda.',
    input_schema: { type: 'object', properties: {
      de: { type: 'string' }, ate: { type: 'string' }, agrupar: { type: 'string', enum: ['dia', 'semana', 'mes'] },
      canal: { type: 'string', enum: CANAIS } }, required: ['de', 'ate', 'agrupar'] },
  },
  {
    name: 'produtos',
    description: 'Ranking de produtos (SKU) no período: quantidade, faturamento, margem, ads, e a variação contra o período anterior de mesmo tamanho.',
    input_schema: { type: 'object', properties: {
      de: { type: 'string' }, ate: { type: 'string' }, canal: { type: 'string', enum: CANAIS },
      ordenar: { type: 'string', enum: ['faturamento', 'quantidade', 'margem', 'queda'] }, limite: { type: 'number' } }, required: ['de', 'ate'] },
  },
  {
    name: 'estoque_cobertura',
    description: 'Estoque atual (galpão + Full/FBA/Shopee) e cobertura em dias pela velocidade dos últimos 30 dias. Use para reposição e risco de ruptura.',
    input_schema: { type: 'object', properties: { limite: { type: 'number' } } },
  },
  {
    name: 'dre_mes',
    description: 'DRE do mês (receita, impostos, tarifas, rebate, ads, CMV, lucro bruto, despesas, EBITDA, resultado). Valores totais.',
    input_schema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM' } }, required: ['mes'] },
  },
  {
    name: 'marketing_cupons',
    description: 'Investimento em ads por canal (ROAS, TACOS) e vendas por cupom/influenciador no período.',
    input_schema: { type: 'object', properties: { de: { type: 'string' }, ate: { type: 'string' } }, required: ['de', 'ate'] },
  },
  {
    name: 'pedido',
    description: 'Detalhe de um pedido pelo número (taxas, rebate, cupom, impostos, custo, margem).',
    input_schema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
  },
] as const

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const hoje = brazilToday()
  // período saneado: datas válidas, invertidas trocadas, até hoje e no máx. 24 meses
  let de = iso(input.de, brazilDaysAgo(30)), ate = iso(input.ate, hoje)
  if (de > ate) [de, ate] = [ate, de]
  if (ate > hoje) ate = hoje
  const minDe = new Date(new Date(`${ate}T12:00:00`).getTime() - 730 * 864e5).toISOString().slice(0, 10)
  if (de < minDe) de = minDe
  const canal = CANAIS.includes(String(input.canal)) ? String(input.canal) : null
  const db = createSupabaseServiceClient()

  if (name === 'resumo_periodo') {
    const vs = await vendas(de, ate, canal)
    const porCanal = aggBy(vs, s => s.marketplace)
    const out: Record<string, unknown> = {}
    for (const [c, a] of porCanal) {
      const peds = new Set(vs.filter(s => s.marketplace === c).map(pedidoDe)).size
      const ads = vs.filter(s => s.marketplace === c).reduce((t, s) => t + Number(s.ads_cost ?? 0), 0)
      out[c] = { ...resumo(a, peds), ticket_medio: peds ? r2(a.revenue / peds) : null, ads: r2(ads), tacos_pct: a.revenue ? r2(ads / a.revenue * 100) : null }
    }
    const tot = newAgg(); vs.forEach(s => addSale(tot, s))
    return { periodo: { de, ate }, total: { ...resumo(tot, new Set(vs.map(pedidoDe)).size) }, por_canal: out }
  }

  if (name === 'tendencia_faturamento') {
    const g = String(input.agrupar ?? 'mes')
    const vs = await vendas(de, ate, canal)
    const chave = (s: Venda) => g === 'dia' ? s.sale_date : g === 'semana' ? semana(s.sale_date) : s.sale_date.slice(0, 7)
    const serie = [...aggBy(vs, chave).entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, a], i, arr) => {
        const ant = i > 0 ? arr[i - 1][1].revenue : null
        return { periodo: k, ...resumo(a), variacao_pct: ant ? r2((a.revenue / ant - 1) * 100) : null }
      })
    // projeção do mês corrente pelo ritmo diário (se o período inclui o mês atual)
    const mesAtual = hoje.slice(0, 7)
    const doMes = vs.filter(s => s.sale_date.startsWith(mesAtual))
    let projecao = null
    if (doMes.length) {
      const dia = Number(hoje.slice(8, 10)), diasMes = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0).getDate()
      const fat = doMes.reduce((t, s) => t + liq(s), 0)
      projecao = { mes: mesAtual, faturado_ate_hoje: r2(fat), dias_corridos: dia, projecao_fim_do_mes: r2(fat / dia * diasMes), obs: 'ritmo médio diário × dias do mês; o dia de hoje está incompleto' }
    }
    // tendência linear simples (faturamento por período)
    const ys = serie.map(s => s.faturamento), n = ys.length
    const xm = (n - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / (n || 1)
    const incl = n > 1 ? ys.reduce((t, y, i) => t + (i - xm) * (y - ym), 0) / ys.reduce((t, _, i) => t + (i - xm) ** 2, 0) : 0
    return { agrupamento: g, canal: canal ?? 'todos', serie, tendencia: { variacao_media_por_periodo: r2(incl), em_pct_da_media: ym ? r2(incl / ym * 100) : null }, projecao }
  }

  if (name === 'produtos') {
    const dias = Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 864e5) + 1
    const antAte = new Date(new Date(de).getTime() - 864e5).toISOString().slice(0, 10)
    const antDe = new Date(new Date(de).getTime() - dias * 864e5).toISOString().slice(0, 10)
    const [vs, va, { data: prods }] = await Promise.all([vendas(de, ate, canal), vendas(antDe, antAte, canal),
      db.from('products').select('id, sku, name').range(0, 4999)])
    const nome = new Map((prods ?? []).map(p => [p.id, `${p.sku} · ${p.name}`]))
    const k = (s: Venda) => s.product_id ? nome.get(s.product_id) ?? s.sku ?? '?' : `${s.sku ?? '?'} (sem cadastro)`
    const ant = aggBy(va, k)
    const qtd = (rows: Venda[], key: string) => rows.filter(s => k(s) === key).reduce((t, s) => t + Number(s.quantity ?? 1), 0)
    let lista = [...aggBy(vs, k).entries()].map(([p, a]) => {
      const fa = ant.get(p)?.revenue ?? 0
      return { produto: p, quantidade: qtd(vs, p), ...resumo(a), ads: r2(vs.filter(s => k(s) === p).reduce((t, s) => t + Number(s.ads_cost ?? 0), 0)),
        faturamento_periodo_anterior: r2(fa), variacao_pct: fa ? r2((a.revenue / fa - 1) * 100) : null }
    })
    const ord = String(input.ordenar ?? 'faturamento')
    lista = lista.sort((a, b) => ord === 'quantidade' ? b.quantidade - a.quantidade : ord === 'margem' ? (b.margem_pct ?? -99) - (a.margem_pct ?? -99)
      : ord === 'queda' ? (a.variacao_pct ?? 0) - (b.variacao_pct ?? 0) : b.faturamento - a.faturamento)
    return { periodo: { de, ate }, comparado_com: { de: antDe, ate: antAte }, produtos: lista.slice(0, Math.min(Number(input.limite ?? 20), 60)) }
  }

  if (name === 'estoque_cobertura') {
    const [{ data: prods }, vs] = await Promise.all([
      db.from('products').select('id, sku, name, stock_quantity, stock_full, stock_fba, stock_shopee, archived').eq('archived', false).range(0, 4999),
      vendas(brazilDaysAgo(30), hoje)])
    const vend = new Map<string, number>()
    for (const s of vs) if (s.product_id) vend.set(s.product_id, (vend.get(s.product_id) ?? 0) + Number(s.quantity ?? 1))
    const lista = (prods ?? []).map(p => {
      const est = Number(p.stock_quantity ?? 0) + Number(p.stock_full ?? 0) + Number(p.stock_fba ?? 0) + Number(p.stock_shopee ?? 0)
      const vel = (vend.get(p.id) ?? 0) / 30
      return { produto: `${p.sku} · ${p.name}`, estoque_total: est, galpao: Number(p.stock_quantity ?? 0), vendas_30d: vend.get(p.id) ?? 0,
        velocidade_dia: r2(vel), cobertura_dias: vel > 0 ? Math.round(est / vel) : null }
    }).filter(p => p.vendas_30d > 0 || p.estoque_total > 0)
      .sort((a, b) => (a.cobertura_dias ?? 1e9) - (b.cobertura_dias ?? 1e9))
    return { obs: 'velocidade = vendas dos últimos 30 dias ÷ 30', produtos: lista.slice(0, Math.min(Number(input.limite ?? 30), 80)) }
  }

  if (name === 'dre_mes') {
    const mes = /^\d{4}-\d{2}$/.test(String(input.mes)) ? String(input.mes) : hoje.slice(0, 7)
    const rows = await buildDRE(new Date(`${mes}-01T12:00:00`))
    return { mes, linhas: rows.filter(r => !r.isHeader).map(r => ({ linha: r.label, total: r2(r.total) })) }
  }

  if (name === 'marketing_cupons') {
    const [vs, { data: ads }] = await Promise.all([vendas(de, ate),
      db.from('ads_metrics').select('marketplace, cost, ad_sales').gte('date_from', de).lte('date_from', ate).range(0, 9999)])
    const porCanal: Record<string, { investimento: number; vendas_via_ads: number }> = {}
    for (const a of ads ?? []) { const c = porCanal[a.marketplace] ??= { investimento: 0, vendas_via_ads: 0 }; c.investimento += Number(a.cost ?? 0); c.vendas_via_ads += Number(a.ad_sales ?? 0) }
    const fat = aggBy(vs, s => s.marketplace)
    const ads_canal = Object.fromEntries(Object.entries(porCanal).map(([c, v]) => [c, { investimento: r2(v.investimento), vendas_via_ads: r2(v.vendas_via_ads),
      roas: v.investimento ? r2(v.vendas_via_ads / v.investimento) : null, tacos_pct: fat.get(c)?.revenue ? r2(v.investimento / fat.get(c)!.revenue * 100) : null }]))
    const cup = new Map<string, { pedidos: Set<string>; a: Agg; custo: number }>()
    for (const s of vs) {
      if (s.cupom_codigo == null) continue
      const key = `${s.marketplace} · ${s.cupom_codigo || 'sem cupom'}`
      const c = cup.get(key) ?? { pedidos: new Set(), a: newAgg(), custo: 0 }
      c.pedidos.add(pedidoDe(s)); addSale(c.a, s); c.custo += Number(s.cupom_vendedor ?? 0); cup.set(key, c)
    }
    const cupons = [...cup.entries()].map(([k, c]) => ({ cupom: k, pedidos: c.pedidos.size, ...resumo(c.a), desconto_pago_por_nos: r2(c.custo) }))
      .sort((a, b) => b.faturamento - a.faturamento)
    return { periodo: { de, ate }, ads_por_canal: ads_canal, cupons }
  }

  if (name === 'pedido') {
    const num = String(input.numero ?? '').replace(/[^\w-]/g, '')
    if (!num) return { erro: 'informe o número do pedido' }
    const { data } = await db.from('sales')
      .select('external_order_id, marketplace, sale_date, sku, quantity, gross_price, cancellation, discounts, marketplace_commission, marketplace_fixed_fee, marketplace_shipping_fee, ads_cost, rebate, cupom_codigo, payout_actual, uf_destino, sale_taxes(total_taxes, icms, icms_difal, pis, cofins), sale_costs(total_cost, margin_value, margin_pct)')
      .ilike('external_order_id', `%${num}%`).limit(10)
    return data?.length ? { itens: data } : { erro: 'pedido não encontrado' }
  }

  return { erro: `ferramenta desconhecida: ${name}` }
}
