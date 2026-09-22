import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { isReturned } from '@/lib/sales/returned'
import type { DRERow } from '@/types'
import { startOfMonth, endOfMonth, format } from 'date-fns'

// Auditoria 22/09/2026: a Magalu ficava FORA do DRE inteiro (canal virou
// marketplace depois do DRE nascer). Canal novo = entra aqui e no DRETable.
const MPs = ['mercado_livre', 'shopee', 'amazon', 'magalu'] as const
type MP = typeof MPs[number]
type Key = MP | 'total'
type MPNumbers = Record<Key, number>
const KEYS: readonly Key[] = [...MPs, 'total']

const zero = (): MPNumbers => ({ mercado_livre: 0, shopee: 0, amazon: 0, magalu: 0, total: 0 })

function add(a: MPNumbers, mp: MP, value: number): void {
  a[mp] += value
  a.total += value
}

/** Monta um MPNumbers aplicando fn a cada canal (e ao total). */
function calc(fn: (k: Key) => number): MPNumbers {
  const r = zero()
  for (const k of KEYS) r[k] = fn(k)
  return r
}

const subtract = (a: MPNumbers, b: MPNumbers): MPNumbers => calc(k => a[k] - b[k])

function toRow(label: string, data: MPNumbers, opts?: { isHeader?: boolean; isTotal?: boolean; isHighlight?: boolean; negate?: boolean }): DRERow {
  const m = opts?.negate ? -1 : 1
  return {
    label,
    isHeader: opts?.isHeader,
    isTotal: opts?.isTotal,
    isHighlight: opts?.isHighlight,
    ...(calc(k => data[k] * m)),
  }
}

const headerRow = (label: string): DRERow => ({ label, isHeader: true, ...zero() })

export async function buildDRE(period: Date): Promise<DRERow[]> {
  const db = createSupabaseServiceClient()
  const startDate = format(startOfMonth(period), 'yyyy-MM-dd')
  const endDate = format(endOfMonth(period), 'yyyy-MM-dd')

  // Paginado: o PostgREST corta em 1000 linhas e o mês ficava incompleto sem aviso
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sales = await fetchAll<any>(() => db
    .from('sales')
    .select('marketplace, fulfillment_type, gross_price, cancellation, discounts, marketplace_commission, marketplace_fixed_fee, rebate, marketplace_shipping_fee, ads_cost, sale_taxes(*), sale_costs(total_cost)')
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)
    .order('id', { ascending: true }))

  const { data: expenses, error: expErr } = await db
    .from('operational_expenses')
    .select('*')
    .gte('period', startDate)
    .lte('period', endDate)
  if (expErr) throw new Error(`Falha ao consultar o banco: ${expErr.message}`)

  // ── Aggregate sales data by marketplace ──────────────────────────────
  const grossRevenue = zero()
  const cancellations = zero()
  const discounts = zero()
  const pis = zero()
  const cofins = zero()
  const icms = zero()
  const icmsDifal = zero()
  const commissions = zero()
  const fixedFees = zero()
  const rebates = zero()
  const shippingFees = zero()
  const ads = zero()
  const ipi = zero()
  const cmv = zero()

  for (const sale of sales) {
    const mp = sale.marketplace as MP
    if (!MPs.includes(mp)) continue

    add(grossRevenue, mp, Number(sale.gross_price))
    add(cancellations, mp, Number(sale.cancellation))
    // Devolvida: bruto e cancelamento se anulam na receita líquida (a linha de
    // cancelamentos continua mostrando o volume). Tarifas, impostos e CMV NÃO
    // entram — o marketplace estornou as tarifas e a mercadoria voltou ao estoque.
    if (isReturned(sale)) continue

    add(discounts, mp, Number(sale.discounts))
    add(commissions, mp, Number(sale.marketplace_commission))
    add(fixedFees, mp, Number(sale.marketplace_fixed_fee ?? 0))
    add(rebates, mp, Number(sale.rebate ?? 0))
    add(shippingFees, mp, Number(sale.marketplace_shipping_fee))
    add(ads, mp, Number(sale.ads_cost))

    // Impostos de TODAS as vendas: galpão (NF Bling) E Full (NF emitida pelo ML)
    const taxRaw = sale.sale_taxes as unknown
    const tax = taxRaw ? (Array.isArray(taxRaw) ? (taxRaw as any[])[0] : taxRaw) as { pis: number; cofins: number; icms: number; icms_difal: number; ipi: number } : null
    if (tax) {
      add(pis, mp, Number(tax.pis))
      add(cofins, mp, Number(tax.cofins))
      add(icms, mp, Number(tax.icms))
      add(icmsDifal, mp, Number(tax.icms_difal))
      add(ipi, mp, Number(tax.ipi ?? 0))
    }

    const costRaw = sale.sale_costs as unknown
    const cost = costRaw ? (Array.isArray(costRaw) ? (costRaw as any[])[0] : costRaw) as { total_cost: number } : null
    if (cost) add(cmv, mp, Number(cost.total_cost))
  }

  // ── Computed subtotals ────────────────────────────────────────────────
  const netMarket = calc(k => grossRevenue[k] - cancellations[k] - discounts[k])

  // Impostos = débitos da saída. SEM crédito de importação: as NF-e de compra
  // que formam o CMV já entram LÍQUIDAS de crédito (regra 5 do AGENTS.md,
  // 2026-09-15) — somar aqui contava em dobro e inflava lucro bruto/EBITDA/IRPJ.
  const totalTaxes = calc(k => pis[k] + cofins[k] + icms[k] + icmsDifal[k] + ipi[k])

  const afterTaxes = subtract(netMarket, totalTaxes)

  // Canal = comissão bruta + tarifa fixa + frete + ads − estorno (crédito do ML)
  const totalChannel = calc(k => commissions[k] + fixedFees[k] + shippingFees[k] + ads[k] - rebates[k])

  const operationalRevenue = subtract(afterTaxes, totalChannel)
  const grossProfit = subtract(operationalRevenue, cmv)
  // Margens % sobre o faturamento LÍQUIDO (bruto − devolução − cupom), mesma
  // base da margem por venda (regra 5)
  const grossBase = netMarket.total || 1
  const grossMarginPct = (grossProfit.total / grossBase) * 100

  // ── Expenses: distribute by revenue share ────────────────────────────
  const expensesByCategory: Record<string, MPNumbers> = {}
  const revTotal = grossRevenue.total || 1

  for (const exp of expenses ?? []) {
    const cat = exp.dre_category as string
    if (!expensesByCategory[cat]) expensesByCategory[cat] = zero()
    const amount = Number(exp.amount)
    for (const mp of MPs) expensesByCategory[cat][mp] += amount * (grossRevenue[mp] / revTotal)
    expensesByCategory[cat].total += amount
  }

  // Group expenses for DRE
  const pessoalCats = ['salarios', 'inss_patronal', 'fgts', 'vale_transporte', 'vale_alimentacao', 'plano_saude', 'ferias_13', 'prolabore']
  const opCats = ['energia', 'agua', 'escritorio', 'aluguel', 'frete_operacional', 'publicidade_marketing', 'sistemas_software', 'contabilidade_consultoria', 'outras_despesas']

  const sumCats = (cats: string[]) => calc(k => cats.reduce((s, c) => s + (expensesByCategory[c]?.[k] ?? 0), 0))
  const totalPessoal = sumCats(pessoalCats)
  const totalOp = sumCats(opCats)
  const totalExpenses = calc(k => totalPessoal[k] + totalOp[k])

  const ebitda = subtract(grossProfit, totalExpenses)
  const ebitdaMarginPct = (ebitda.total / grossBase) * 100

  // ── IRPJ / CSLL (Lucro Real — applied to total only, shown in total column) ──
  const lucroBase = ebitda.total
  const irpjBase = Math.max(0, lucroBase)
  const irpj = irpjBase * 0.15
  const irpjAdicional = Math.max(0, lucroBase - 20000) * 0.10
  const csll = Math.max(0, lucroBase) * 0.09

  const irpjCsllTotal = irpj + irpjAdicional + csll
  const resultadoLiquido = calc(k => k === 'total'
    ? ebitda.total - irpjCsllTotal
    : ebitda[k] - (ebitda.total > 0 ? irpjCsllTotal * (ebitda[k] / ebitda.total) : 0))
  const netMarginPct = (resultadoLiquido.total / grossBase) * 100

  // ── Build rows ────────────────────────────────────────────────────────
  return [
    headerRow('Receita'),
    toRow('(+) Receita Bruta de Vendas', grossRevenue),
    toRow('(-) Cancelamentos e Reembolsos', cancellations, { negate: true }),
    toRow('(-) Descontos e Bônus', discounts, { negate: true }),
    toRow('= Receita Líquida de Mercado', netMarket, { isTotal: true }),

    headerRow('Impostos sobre Vendas'),
    toRow('(-) PIS s/ vendas', pis, { negate: true }),
    toRow('(-) COFINS s/ vendas', cofins, { negate: true }),
    toRow('(-) ICMS', icms, { negate: true }),
    toRow('(-) ICMS DIFAL', icmsDifal, { negate: true }),
    ...(ipi.total > 0 ? [toRow('(-) IPI', ipi, { negate: true })] : []),
    toRow('= Receita após Impostos', afterTaxes, { isTotal: true }),

    headerRow('Custos do Canal de Venda'),
    toRow('(-) Comissões (brutas)', commissions, { negate: true }),
    toRow('(-) Tarifa fixa / Full', fixedFees, { negate: true }),
    toRow('(+) Estornos e bônus do canal', rebates),
    toRow('(-) Frete cobrado pelo Marketplace', shippingFees, { negate: true }),
    toRow('(-) ADS / Publicidade Marketplace', ads, { negate: true }),
    toRow('= Receita Operacional', operationalRevenue, { isTotal: true }),

    headerRow('Custo dos Produtos Vendidos'),
    toRow('(-) CMV — Custo Landed Real (CMP)', cmv, { negate: true }),
    { ...toRow('= LUCRO BRUTO', grossProfit, { isTotal: true, isHighlight: true }), label: `= LUCRO BRUTO  (${grossMarginPct.toFixed(1)}% mg. bruta)` },

    headerRow('Despesas com Pessoal'),
    ...pessoalCats.filter(c => expensesByCategory[c]?.total).map(c =>
      toRow(`(-) ${c.replace(/_/g, ' ')}`, expensesByCategory[c], { negate: true })
    ),

    headerRow('Despesas Operacionais'),
    ...opCats.filter(c => expensesByCategory[c]?.total).map(c =>
      toRow(`(-) ${c.replace(/_/g, ' ')}`, expensesByCategory[c], { negate: true })
    ),

    { ...toRow('= EBITDA', ebitda, { isTotal: true, isHighlight: true }), label: `= EBITDA  (${ebitdaMarginPct.toFixed(1)}% mg. EBITDA)` },

    headerRow('Apuração Tributária (Lucro Real)'),
    toRow('(-) IRPJ (15% + adicional 10%)', { ...zero(), total: irpj + irpjAdicional }, { negate: true }),
    toRow('(-) CSLL (9%)', { ...zero(), total: csll }, { negate: true }),

    { ...toRow('= RESULTADO LÍQUIDO', resultadoLiquido, { isTotal: true, isHighlight: true }), label: `= RESULTADO LÍQUIDO  (${netMarginPct.toFixed(1)}% mg. líquida)` },
  ]
}
