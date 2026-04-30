import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'

export const dynamic = 'force-dynamic'

function fmtR(v: number) {
  const abs = Math.abs(v)
  const formatted = `R$ ${abs.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  return v < 0 ? `(${formatted})` : formatted
}
function fmtPct(v: number) {
  return `${v.toFixed(2)}%`
}

interface BlockProps {
  title: string
  color: string
  rows: { label: string; value: number; indent?: boolean; bold?: boolean; highlight?: boolean }[]
}

function TaxBlock({ title, color, rows }: BlockProps) {
  const saldo = rows.find(r => r.highlight)
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className={`px-5 py-3 border-b border-gray-100 ${color}`}>
        <div className="font-bold text-white text-sm">{title}</div>
      </div>
      <div className="divide-y divide-gray-50">
        {rows.map((row, i) => (
          <div key={i} className={`flex items-center justify-between px-5 py-2.5 ${row.highlight ? 'bg-blue-50' : ''}`}>
            <span className={`text-sm ${row.indent ? 'pl-4 text-gray-500' : row.bold ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
              {row.label}
            </span>
            <span className={`text-sm font-semibold ${row.highlight ? 'text-blue-800 text-base' : row.value < 0 ? 'text-green-600' : row.value > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {row.value === 0 ? '—' : fmtR(row.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default async function TributarioPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  const period = params.month ? new Date(`${params.month}-01`) : new Date()
  const start = format(startOfMonth(period), 'yyyy-MM-dd')
  const end = format(endOfMonth(period), 'yyyy-MM-dd')
  const currentMonth = period.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const db = createSupabaseServiceClient()

  // ── NF-e saída taxes (débito PIS/COFINS/ICMS) ──
  const { data: saleTaxes } = await db
    .from('sale_taxes')
    .select('pis, cofins, icms, icms_difal, sale_id, sales!inner(sale_date, fulfillment_type)')
    .gte('sales.sale_date', start)
    .lte('sales.sale_date', end)

  const debitoPIS = (saleTaxes ?? []).reduce((s, t) => s + Number(t.pis), 0)
  const debitoCOFINS = (saleTaxes ?? []).reduce((s, t) => s + Number(t.cofins), 0)
  const debitoICMS = (saleTaxes ?? []).reduce((s, t) => s + Number(t.icms), 0)
  const totalDIFAL = (saleTaxes ?? []).reduce((s, t) => s + Number(t.icms_difal), 0)

  // ── Créditos PIS/COFINS/ICMS das importações ──
  const { data: importCredits } = await db
    .from('unit_costs')
    .select('pis_credit_unit, cofins_credit_unit, icms_credit_unit, quantity_in_batch')
    .gte('calculated_at', `${start}T00:00:00Z`)
    .lte('calculated_at', `${end}T23:59:59Z`)

  const creditoPISImp = (importCredits ?? []).reduce((s, c) => s + Number(c.pis_credit_unit) * Number(c.quantity_in_batch), 0)
  const creditoCOFINSImp = (importCredits ?? []).reduce((s, c) => s + Number(c.cofins_credit_unit) * Number(c.quantity_in_batch), 0)
  const creditoICMSImp = (importCredits ?? []).reduce((s, c) => s + Number(c.icms_credit_unit) * Number(c.quantity_in_batch), 0)

  // ── Créditos PIS/COFINS compras nacionais (from import_items with non-import NFs) ──
  // For simplicity, credit on national purchases uses same unit_costs approach
  // In a full implementation, national purchase credits would come from import_items of national suppliers
  const creditoPISCompras = 0 // TODO: implement when national NF-e sync is added
  const creditoCOFINSCompras = 0 // TODO: implement when national NF-e sync is added
  const creditoICMSEntradas = 0 // TODO: implement when national NF-e sync is added

  // ── PIS/COFINS saldo ──
  const totalCreditoPIS = creditoPISImp + creditoPISCompras
  const totalCreditoCOFINS = creditoCOFINSImp + creditoCOFINSCompras
  const saldoPIS = debitoPIS - totalCreditoPIS
  const saldoCOFINS = debitoCOFINS - totalCreditoCOFINS

  // ── ICMS saldo ──
  const totalCreditoICMS = creditoICMSImp + creditoICMSEntradas
  const saldoICMS = debitoICMS - totalCreditoICMS

  // ── IRPJ / CSLL — base = receita - custos - despesas ──
  const { data: sales } = await db
    .from('sales')
    .select('gross_price, marketplace_commission, marketplace_shipping_fee, ads_cost, cancellation, sale_costs(total_cost)')
    .gte('sale_date', start)
    .lte('sale_date', end)

  const { data: expenses } = await db
    .from('operational_expenses')
    .select('amount')
    .gte('period', start)
    .lte('period', end)

  const totalRevenue = (sales ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation), 0)
  const totalFees = (sales ?? []).reduce((s, r) => s + Number(r.marketplace_commission) + Number(r.marketplace_shipping_fee) + Number(r.ads_cost), 0)
  const totalCMV = (sales ?? []).reduce((s, r) => {
    const cost = (r.sale_costs as any)?.[0]?.total_cost ?? 0
    return s + Number(cost)
  }, 0)
  const totalExpenses = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const totalTaxesOnRevenue = debitoPIS + debitoCOFINS + debitoICMS + totalDIFAL

  const lucroBase = totalRevenue - totalTaxesOnRevenue - totalFees - totalCMV - totalExpenses
  const lucroPositivo = Math.max(0, lucroBase)

  const irpj = lucroPositivo * 0.15
  const irpjAdicional = Math.max(0, lucroBase - 20000) * 0.10
  const csll = lucroPositivo * 0.09
  const totalIRPJCSLL = irpj + irpjAdicional + csll

  const receitaLiquida = totalRevenue - totalTaxesOnRevenue
  const cargaTributaria = receitaLiquida > 0 ? ((saldoPIS + saldoCOFINS + saldoICMS + totalDIFAL + totalIRPJCSLL) / receitaLiquida) * 100 : 0

  function prevMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() - 1, 1) }
  function nextMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 1) }
  function fmtMonth(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

  return (
    <>
      <TopBar
        title="Painel Tributário"
        subtitle={`Apuração Lucro Real — ${currentMonth}`}
        actions={
          <div className="flex items-center gap-2">
            <a href={`/dashboard/tributario?month=${fmtMonth(prevMonth(period))}`}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">← Anterior</a>
            <a href={`/dashboard/tributario?month=${fmtMonth(nextMonth(period))}`}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Próximo →</a>
          </div>
        }
      />
      <div className="px-8 py-6 space-y-6">

        {/* Carga tributária KPI */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Carga Tributária Total</div>
            <div className={`text-2xl font-bold ${cargaTributaria > 20 ? 'text-amber-500' : 'text-gray-900'}`}>{fmtPct(cargaTributaria)}</div>
            <div className="text-xs text-gray-400 mt-1">{cargaTributaria > 20 ? '⚠ Acima de 20%' : 'Dentro do esperado'}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">PIS/COFINS a Recolher</div>
            <div className={`text-2xl font-bold ${saldoPIS + saldoCOFINS > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtR(saldoPIS + saldoCOFINS)}</div>
            <div className="text-xs text-gray-400 mt-1">{saldoPIS + saldoCOFINS <= 0 ? 'Saldo credor' : 'A recolher'}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">ICMS + DIFAL</div>
            <div className={`text-2xl font-bold ${saldoICMS + totalDIFAL > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtR(saldoICMS + totalDIFAL)}</div>
            <div className="text-xs text-gray-400 mt-1">DIFAL: {fmtR(totalDIFAL)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">IRPJ + CSLL</div>
            <div className={`text-2xl font-bold ${totalIRPJCSLL > 0 ? 'text-red-600' : 'text-gray-300'}`}>{totalIRPJCSLL > 0 ? fmtR(totalIRPJCSLL) : '—'}</div>
            <div className="text-xs text-gray-400 mt-1">Base: {fmtR(lucroBase)}</div>
          </div>
        </div>

        {/* Three tax blocks side by side */}
        <div className="grid grid-cols-3 gap-4">
          <TaxBlock
            title="PIS / COFINS — Não Cumulativo"
            color="bg-blue-600"
            rows={[
              { label: 'Débito PIS (1,65% NFs saída)', value: debitoPIS },
              { label: 'Débito COFINS (7,60% NFs saída)', value: debitoCOFINS },
              { label: 'Total Débito', value: debitoPIS + debitoCOFINS, bold: true },
              { label: 'Crédito PIS-Importação', value: -creditoPISImp, indent: true },
              { label: 'Crédito COFINS-Importação', value: -creditoCOFINSImp, indent: true },
              { label: 'Crédito compras nacionais', value: -(creditoPISCompras + creditoCOFINSCompras), indent: true },
              { label: 'Total Créditos', value: -(totalCreditoPIS + totalCreditoCOFINS), bold: true },
              { label: 'Saldo a Recolher', value: saldoPIS + saldoCOFINS, highlight: true },
            ]}
          />

          <TaxBlock
            title="ICMS Minas Gerais"
            color="bg-indigo-600"
            rows={[
              { label: 'Débito ICMS saídas', value: debitoICMS },
              { label: 'Crédito ICMS-GNRE (importação)', value: -creditoICMSImp, indent: true },
              { label: 'Crédito entradas nacionais (12%)', value: -creditoICMSEntradas, indent: true },
              { label: 'Total Créditos', value: -totalCreditoICMS, bold: true },
              { label: 'Saldo ICMS MG', value: saldoICMS, highlight: true },
              { label: 'ICMS DIFAL (recolher por UF)', value: totalDIFAL },
              { label: 'Total ICMS + DIFAL', value: saldoICMS + totalDIFAL, bold: true },
            ]}
          />

          <TaxBlock
            title="IRPJ / CSLL — Lucro Real"
            color="bg-slate-600"
            rows={[
              { label: 'Receita Líquida', value: totalRevenue },
              { label: '(-) Impostos faturamento', value: -totalTaxesOnRevenue, indent: true },
              { label: '(-) Custos canal + CMV', value: -(totalFees + totalCMV), indent: true },
              { label: '(-) Despesas operacionais', value: -totalExpenses, indent: true },
              { label: 'Base de Cálculo (Lucro Real)', value: lucroBase, bold: true },
              { label: 'IRPJ (15%)', value: irpj },
              { label: 'IRPJ Adicional (10% > R$20k)', value: irpjAdicional },
              { label: 'CSLL (9%)', value: csll },
              { label: 'Total IRPJ + CSLL', value: totalIRPJCSLL, highlight: true },
            ]}
          />
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-lg px-5 py-3 text-sm text-amber-800">
          ⚠ <strong>Créditos de compras nacionais</strong> (PIS/COFINS/ICMS sobre NFs de fornecedores nacionais) serão incluídos automaticamente quando a sincronização de NF-e de entrada de fornecedores nacionais for configurada no Bling.
        </div>
      </div>
    </>
  )
}