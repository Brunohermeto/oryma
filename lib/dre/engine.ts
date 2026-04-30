import { createSupabaseServiceClient } from '@/lib/supabase/server'
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
    .select('marketplace, fulfillment_type, gross_price, cancellation, discounts, marketplace_commission, marketplace_shipping_fee, ads_cost, sale_taxes(*), sale_costs(total_cost)')
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
  const shippingFees = zero()
  const ads = zero()
  const cmv = zero()

  for (const sale of sales ?? []) {
    const mp = sale.marketplace as MP
    if (!MPs.includes(mp)) continue

    add(grossRevenue, mp, Number(sale.gross_price))
    add(cancellations, mp, Number(sale.cancellation))
    add(discounts, mp, Number(sale.discounts))
    add(commissions, mp, Number(sale.marketplace_commission))
    add(shippingFees, mp, Number(sale.marketplace_shipping_fee))
    add(ads, mp, Number(sale.ads_cost))

    // Taxes only for galpao sales (serie 2 NF-e)
    if (sale.fulfillment_type === 'galpao') {
      const tax = (sale.sale_taxes as { pis: number; cofins: number; icms: number; icms_difal: number }[] | null)?.[0]
      if (tax) {
        add(pis, mp, Number(tax.pis))
        add(cofins, mp, Number(tax.cofins))
        add(icms, mp, Number(tax.icms))
        add(icmsDifal, mp, Number(tax.icms_difal))
      }
    }

    const cost = (sale.sale_costs as { total_cost: number }[] | null)?.[0]
    if (cost) {
      add(cmv, mp, Number(cost.total_cost))
    }
  }

  // ── Computed subtotals ────────────────────────────────────────────────
  const netMarket: MPNumbers = {
    mercado_livre: grossRevenue.mercado_livre - cancellations.mercado_livre - discounts.mercado_livre,
    shopee: grossRevenue.shopee - cancellations.shopee - discounts.shopee,
    amazon: grossRevenue.amazon - cancellations.amazon - discounts.amazon,
    total: grossRevenue.total - cancellations.total - discounts.total,
  }

  const totalTaxes: MPNumbers = {
    mercado_livre: pis.mercado_livre + cofins.mercado_livre + icms.mercado_livre + icmsDifal.mercado_livre,
    shopee: pis.shopee + cofins.shopee + icms.shopee + icmsDifal.shopee,
    amazon: pis.amazon + cofins.amazon + icms.amazon + icmsDifal.amazon,
    total: pis.total + cofins.total + icms.total + icmsDifal.total,
  }

  const afterTaxes = subtract(netMarket, totalTaxes)

  const totalChannel: MPNumbers = {
    mercado_livre: commissions.mercado_livre + shippingFees.mercado_livre + ads.mercado_livre,
    shopee: commissions.shopee + shippingFees.shopee + ads.shopee,
    amazon: commissions.amazon + shippingFees.amazon + ads.amazon,
    total: commissions.total + shippingFees.total + ads.total,
  }

  const operationalRevenue = subtract(afterTaxes, totalChannel)
  const grossProfit = subtract(operationalRevenue, cmv)
  const grossMarginPct = operationalRevenue.total > 0 ? (grossProfit.total / operationalRevenue.total) * 100 : 0

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
  const ebitdaMarginPct = operationalRevenue.total > 0 ? (ebitda.total / operationalRevenue.total) * 100 : 0

  // ── IRPJ / CSLL (Lucro Real — applied to total only, shown in total column) ──
  const lucroBase = ebitda.total
  const irpjBase = Math.max(0, lucroBase)
  const irpj = irpjBase * 0.15
  const irpjAdicional = Math.max(0, lucroBase - 20000) * 0.10
  const csll = Math.max(0, lucroBase) * 0.09

  // PIS/COFINS credits from imports (from unit_costs table for the period)
  const { data: credits } = await db
    .from('unit_costs')
    .select('pis_credit_unit, cofins_credit_unit, quantity_in_batch')
    .gte('calculated_at', `${startDate}T00:00:00Z`)
    .lte('calculated_at', `${endDate}T23:59:59Z`)

  const totalPisCredit = (credits ?? []).reduce((s, c) => s + Number(c.pis_credit_unit) * Number(c.quantity_in_batch), 0)
  const totalCofinsCredit = (credits ?? []).reduce((s, c) => s + Number(c.cofins_credit_unit) * Number(c.quantity_in_batch), 0)
  const totalCredits = totalPisCredit + totalCofinsCredit

  const irpjCsllTotal = irpj + irpjAdicional + csll
  const resultadoLiquido: MPNumbers = {
    mercado_livre: ebitda.mercado_livre * (ebitda.total > 0 ? (ebitda.total - irpjCsllTotal + totalCredits) / ebitda.total : 1),
    shopee: ebitda.shopee * (ebitda.total > 0 ? (ebitda.total - irpjCsllTotal + totalCredits) / ebitda.total : 1),
    amazon: ebitda.amazon * (ebitda.total > 0 ? (ebitda.total - irpjCsllTotal + totalCredits) / ebitda.total : 1),
    total: ebitda.total - irpjCsllTotal + totalCredits,
  }
  const netMarginPct = operationalRevenue.total > 0 ? (resultadoLiquido.total / operationalRevenue.total) * 100 : 0

  // ── Build rows ────────────────────────────────────────────────────────
  return [
    headerRow('Receita'),
    toRow('(+) Receita Bruta de Vendas', grossRevenue),
    toRow('(-) Cancelamentos e Reembolsos', cancellations, { negate: true }),
    toRow('(-) Descontos e Bônus', discounts, { negate: true }),
    toRow('= Receita Líquida de Mercado', netMarket, { isTotal: true }),

    headerRow('Impostos sobre Vendas (NF-e série 2 — galpão)'),
    toRow('(-) PIS (1,65%)', pis, { negate: true }),
    toRow('(-) COFINS (7,60%)', cofins, { negate: true }),
    toRow('(-) ICMS', icms, { negate: true }),
    toRow('(-) ICMS DIFAL', icmsDifal, { negate: true }),
    toRow('= Receita após Impostos', afterTaxes, { isTotal: true }),

    headerRow('Custos do Canal de Venda'),
    toRow('(-) Comissões e Tarifas', commissions, { negate: true }),
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
    toRow('(+) Créditos PIS/COFINS-Importação', { mercado_livre: 0, shopee: 0, amazon: 0, total: totalCredits }),

    { ...toRow('= RESULTADO LÍQUIDO', resultadoLiquido, { isTotal: true, isHighlight: true }), label: `= RESULTADO LÍQUIDO  (${netMarginPct.toFixed(1)}% mg. líquida)` },
  ]
}
