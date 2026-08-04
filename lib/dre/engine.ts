import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { isReturned } from '@/lib/sales/returned'
import type { DRERow } from '@/types'
import { startOfMonth, endOfMonth, format } from 'date-fns'

type MP = 'mercado_livre' | 'shopee' | 'amazon'
const MPs: MP[] = ['mercado_livre', 'shopee', 'amazon']

interface MPNumbers {
  mercado_livre: number
  shopee: number
  amazon: number
  total: number
}

function zero(): MPNumbers {
  return { mercado_livre: 0, shopee: 0, amazon: 0, total: 0 }
}

function add(a: MPNumbers, mp: MP, value: number): void {
  a[mp] += value
  a.total += value
}

function subtract(a: MPNumbers, b: MPNumbers): MPNumbers {
  return {
    mercado_livre: a.mercado_livre - b.mercado_livre,
    shopee: a.shopee - b.shopee,
    amazon: a.amazon - b.amazon,
    total: a.total - b.total,
  }
}

function toRow(label: string, data: MPNumbers, opts?: { isHeader?: boolean; isTotal?: boolean; isHighlight?: boolean; negate?: boolean }): DRERow {
  const m = opts?.negate ? -1 : 1
  return {
    label,
    isHeader: opts?.isHeader,
    isTotal: opts?.isTotal,
    isHighlight: opts?.isHighlight,
    mercado_livre: data.mercado_livre * m,
    shopee: data.shopee * m,
    amazon: data.amazon * m,
    total: data.total * m,
  }
}

function headerRow(label: string): DRERow {
  return { label, isHeader: true, mercado_livre: 0, shopee: 0, amazon: 0, total: 0 }
}

export async function buildDRE(period: Date): Promise<DRERow[]> {
  const db = createSupabaseServiceClient()
  const startDate = format(startOfMonth(period), 'yyyy-MM-dd')
  const endDate = format(endOfMonth(period), 'yyyy-MM-dd')

  // Load sales with taxes and costs
  const { data: sales } = await db
    .from('sales')
    .select('marketplace, fulfillment_type, gross_price, cancellation, discounts, marketplace_commission, marketplace_fixed_fee, rebate, marketplace_shipping_fee, ads_cost, sale_taxes(*), sale_costs(total_cost, import_credit)')
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)

  // Load operational expenses
  const { data: expenses } = await db
    .from('operational_expenses')
    .select('*')
    .gte('period', startDate)
    .lte('period', endDate)

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
  const importCredit = zero()

  for (const sale of sales ?? []) {
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
    add(fixedFees, mp, Number((sale as any).marketplace_fixed_fee ?? 0))
    add(rebates, mp, Number((sale as any).rebate ?? 0))
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
    const cost = costRaw ? (Array.isArray(costRaw) ? (costRaw as any[])[0] : costRaw) as { total_cost: number; import_credit?: number } : null
    if (cost) {
      add(cmv, mp, Number(cost.total_cost))
      // Crédito de importação das UNIDADES VENDIDAS — mesma régua da margem
      // por venda (PIS+COFINS+ICMS por produto, lote vigente)
      add(importCredit, mp, Number(cost.import_credit ?? 0))
    }
  }

  // ── Computed subtotals ────────────────────────────────────────────────
  const netMarket: MPNumbers = {
    mercado_livre: grossRevenue.mercado_livre - cancellations.mercado_livre - discounts.mercado_livre,
    shopee: grossRevenue.shopee - cancellations.shopee - discounts.shopee,
    amazon: grossRevenue.amazon - cancellations.amazon - discounts.amazon,
    total: grossRevenue.total - cancellations.total - discounts.total,
  }

  // Impostos líquidos = débitos da saída − crédito de importação das vendas
  const totalTaxes: MPNumbers = {
    mercado_livre: pis.mercado_livre + cofins.mercado_livre + icms.mercado_livre + icmsDifal.mercado_livre + ipi.mercado_livre - importCredit.mercado_livre,
    shopee:        pis.shopee        + cofins.shopee        + icms.shopee        + icmsDifal.shopee        + ipi.shopee        - importCredit.shopee,
    amazon:        pis.amazon        + cofins.amazon        + icms.amazon        + icmsDifal.amazon        + ipi.amazon        - importCredit.amazon,
    total:         pis.total         + cofins.total         + icms.total         + icmsDifal.total         + ipi.total         - importCredit.total,
  }

  const afterTaxes = subtract(netMarket, totalTaxes)

  // Canal = comissão bruta + tarifa fixa + frete + ads − estorno (crédito do ML)
  const totalChannel: MPNumbers = {
    mercado_livre: commissions.mercado_livre + fixedFees.mercado_livre + shippingFees.mercado_livre + ads.mercado_livre - rebates.mercado_livre,
    shopee: commissions.shopee + fixedFees.shopee + shippingFees.shopee + ads.shopee - rebates.shopee,
    amazon: commissions.amazon + fixedFees.amazon + shippingFees.amazon + ads.amazon - rebates.amazon,
    total: commissions.total + fixedFees.total + shippingFees.total + ads.total - rebates.total,
  }

  const operationalRevenue = subtract(afterTaxes, totalChannel)
  const grossProfit = subtract(operationalRevenue, cmv)
  // Margens % sobre o FATURAMENTO BRUTO (regra do Bruno), não sobre receita operacional
  const grossBase = grossRevenue.total || 1
  const grossMarginPct = (grossProfit.total / grossBase) * 100

  // ── Expenses: distribute by revenue share ────────────────────────────
  const expensesByCategory: Record<string, MPNumbers> = {}
  const revTotal = grossRevenue.total || 1
  const revShare = {
    mercado_livre: grossRevenue.mercado_livre / revTotal,
    shopee: grossRevenue.shopee / revTotal,
    amazon: grossRevenue.amazon / revTotal,
  }

  for (const exp of expenses ?? []) {
    const cat = exp.dre_category as string
    if (!expensesByCategory[cat]) expensesByCategory[cat] = zero()
    const amount = Number(exp.amount)
    expensesByCategory[cat].mercado_livre += amount * revShare.mercado_livre
    expensesByCategory[cat].shopee += amount * revShare.shopee
    expensesByCategory[cat].amazon += amount * revShare.amazon
    expensesByCategory[cat].total += amount
  }

  // Group expenses for DRE
  const pessoalCats = ['salarios', 'inss_patronal', 'fgts', 'vale_transporte', 'vale_alimentacao', 'plano_saude', 'ferias_13', 'prolabore']
  const opCats = ['energia', 'agua', 'escritorio', 'aluguel', 'frete_operacional', 'publicidade_marketing', 'sistemas_software', 'contabilidade_consultoria', 'outras_despesas']

  const totalPessoal = zero()
  const totalOp = zero()

  for (const cat of pessoalCats) {
    const d = expensesByCategory[cat]
    if (d) {
      totalPessoal.mercado_livre += d.mercado_livre
      totalPessoal.shopee += d.shopee
      totalPessoal.amazon += d.amazon
      totalPessoal.total += d.total
    }
  }
  for (const cat of opCats) {
    const d = expensesByCategory[cat]
    if (d) {
      totalOp.mercado_livre += d.mercado_livre
      totalOp.shopee += d.shopee
      totalOp.amazon += d.amazon
      totalOp.total += d.total
    }
  }

  const totalExpenses: MPNumbers = {
    mercado_livre: totalPessoal.mercado_livre + totalOp.mercado_livre,
    shopee: totalPessoal.shopee + totalOp.shopee,
    amazon: totalPessoal.amazon + totalOp.amazon,
    total: totalPessoal.total + totalOp.total,
  }

  const ebitda = subtract(grossProfit, totalExpenses)
  const ebitdaMarginPct = (ebitda.total / grossBase) * 100

  // ── IRPJ / CSLL (Lucro Real — applied to total only, shown in total column) ──
  const lucroBase = ebitda.total
  const irpjBase = Math.max(0, lucroBase)
  const irpj = irpjBase * 0.15
  const irpjAdicional = Math.max(0, lucroBase - 20000) * 0.10
  const csll = Math.max(0, lucroBase) * 0.09

  const irpjCsllTotal = irpj + irpjAdicional + csll
  const resultadoLiquido: MPNumbers = {
    mercado_livre: ebitda.mercado_livre - (ebitda.total > 0 ? irpjCsllTotal * (ebitda.mercado_livre / ebitda.total) : 0),
    shopee:        ebitda.shopee        - (ebitda.total > 0 ? irpjCsllTotal * (ebitda.shopee        / ebitda.total) : 0),
    amazon:        ebitda.amazon        - (ebitda.total > 0 ? irpjCsllTotal * (ebitda.amazon        / ebitda.total) : 0),
    total:         ebitda.total - irpjCsllTotal,
  }
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
    ...(importCredit.total > 0 ? [toRow('(+) Créditos de importação (PIS/COFINS/ICMS das vendas)', importCredit)] : []),
    toRow('= Receita após Impostos Líquidos', afterTaxes, { isTotal: true }),

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
    toRow('(-) IRPJ (15% + adicional 10%)', { mercado_livre: 0, shopee: 0, amazon: 0, total: irpj + irpjAdicional }, { negate: true }),
    toRow('(-) CSLL (9%)', { mercado_livre: 0, shopee: 0, amazon: 0, total: csll }, { negate: true }),

    { ...toRow('= RESULTADO LÍQUIDO', resultadoLiquido, { isTotal: true, isHighlight: true }), label: `= RESULTADO LÍQUIDO  (${netMarginPct.toFixed(1)}% mg. líquida)` },
  ]
}
