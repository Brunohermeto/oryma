import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'

export const dynamic = 'force-dynamic'

// Oryma brand colors
const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
  violeta:  '#7B61FF',
}

function fmtR(v: number) {
  const abs = Math.abs(v)
  const formatted = `R$ ${abs.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  return v < 0 ? `(${formatted})` : formatted
}
function fmtPct(v: number) { return `${v.toFixed(2)}%` }

interface BlockProps {
  title: string
  headerBg: string
  rows: { label: string; value: number; indent?: boolean; bold?: boolean; highlight?: boolean }[]
}

function TaxBlock({ title, headerBg, rows }: BlockProps) {
  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
      <div className="px-5 py-3" style={{ background: headerBg, borderBottom: `1px solid ${B.border}` }}>
        <div className="font-bold text-white text-sm">{title}</div>
      </div>
      <div>
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-5 py-2.5"
            style={{
              background: row.highlight ? 'oklch(0.94 0.06 258)' : '',
              borderBottom: `1px solid ${B.bgSubtle}`,
            }}
          >
            <span
              className="text-sm"
              style={{
                color: row.indent ? B.muted : row.bold ? B.text : 'oklch(0.40 0.020 258)',
                paddingLeft: row.indent ? '16px' : undefined,
                fontWeight: row.bold ? 600 : undefined,
              }}
            >
              {row.label}
            </span>
            <span
              className="text-sm font-semibold num"
              style={{
                color: row.highlight ? B.brand
                  : row.value < 0 ? '#16a34a'
                  : row.value > 0 ? '#dc2626'
                  : B.muted,
                fontSize: row.highlight ? '1rem' : undefined,
                fontFamily: 'var(--font-geist-mono)',
              }}
            >
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

  const { data: saleTaxes } = await db
    .from('sale_taxes')
    .select('pis, cofins, icms, icms_difal, sale_id, sales!inner(sale_date, fulfillment_type)')
    .gte('sales.sale_date', start)
    .lte('sales.sale_date', end)

  const debitoPIS    = (saleTaxes ?? []).reduce((s, t) => s + Number(t.pis), 0)
  const debitoCOFINS = (saleTaxes ?? []).reduce((s, t) => s + Number(t.cofins), 0)
  const debitoICMS   = (saleTaxes ?? []).reduce((s, t) => s + Number(t.icms), 0)
  const totalDIFAL   = (saleTaxes ?? []).reduce((s, t) => s + Number(t.icms_difal), 0)

  const { data: importCredits } = await db
    .from('unit_costs')
    .select('pis_credit_unit, cofins_credit_unit, icms_credit_unit, quantity_in_batch')
    .gte('calculated_at', `${start}T00:00:00Z`)
    .lte('calculated_at', `${end}T23:59:59Z`)

  const creditoPISImp    = (importCredits ?? []).reduce((s, c) => s + Number(c.pis_credit_unit) * Number(c.quantity_in_batch), 0)
  const creditoCOFINSImp = (importCredits ?? []).reduce((s, c) => s + Number(c.cofins_credit_unit) * Number(c.quantity_in_batch), 0)
  const creditoICMSImp   = (importCredits ?? []).reduce((s, c) => s + Number(c.icms_credit_unit) * Number(c.quantity_in_batch), 0)

  const creditoPISCompras = 0
  const creditoCOFINSCompras = 0
  const creditoICMSEntradas = 0

  const totalCreditoPIS    = creditoPISImp + creditoPISCompras
  const totalCreditoCOFINS = creditoCOFINSImp + creditoCOFINSCompras
  const saldoPIS    = debitoPIS - totalCreditoPIS
  const saldoCOFINS = debitoCOFINS - totalCreditoCOFINS
  const totalCreditoICMS = creditoICMSImp + creditoICMSEntradas
  const saldoICMS   = debitoICMS - totalCreditoICMS

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

  const totalRevenue  = (sales ?? []).reduce((s, r) => s + Number(r.gross_price) - Number(r.cancellation), 0)
  const totalFees     = (sales ?? []).reduce((s, r) => s + Number(r.marketplace_commission) + Number(r.marketplace_shipping_fee) + Number(r.ads_cost), 0)
  const totalCMV      = (sales ?? []).reduce((s, r) => s + Number((r.sale_costs as any)?.[0]?.total_cost ?? 0), 0)
  const totalExpenses = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const totalTaxesOnRevenue = debitoPIS + debitoCOFINS + debitoICMS + totalDIFAL

  const lucroBase      = totalRevenue - totalTaxesOnRevenue - totalFees - totalCMV - totalExpenses
  const lucroPositivo  = Math.max(0, lucroBase)
  const irpj           = lucroPositivo * 0.15
  const irpjAdicional  = Math.max(0, lucroBase - 20000) * 0.10
  const csll           = lucroPositivo * 0.09
  const totalIRPJCSLL  = irpj + irpjAdicional + csll

  const receitaLiquida  = totalRevenue - totalTaxesOnRevenue
  const cargaTributaria = receitaLiquida > 0
    ? ((saldoPIS + saldoCOFINS + saldoICMS + totalDIFAL + totalIRPJCSLL) / receitaLiquida) * 100
    : 0

  function prevMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() - 1, 1) }
  function nextMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 1) }
  function fmtMonth(d: Date)  { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

  const navBtn = (label: string, href: string) => (
    <a
      href={href}
      className="px-3 py-1.5 text-sm rounded-lg transition-colors"
      style={{ border: `1px solid ${B.border}`, color: B.muted }}
      onMouseEnter={() => {}}
    >
      {label}
    </a>
  )

  return (
    <>
      <TopBar
        title="Painel Tributário"
        subtitle={`Apuração Lucro Real — ${currentMonth}`}
        actions={
          <div className="flex items-center gap-2">
            <a href={`/dashboard/tributario?month=${fmtMonth(prevMonth(period))}`}
              className="px-3 py-1.5 text-sm rounded-lg"
              style={{ border: `1px solid ${B.border}`, color: B.muted }}>
              ← Anterior
            </a>
            <a href={`/dashboard/tributario?month=${fmtMonth(nextMonth(period))}`}
              className="px-3 py-1.5 text-sm rounded-lg"
              style={{ border: `1px solid ${B.border}`, color: B.muted }}>
              Próximo →
            </a>
          </div>
        }
      />
      <div className="px-8 py-6 space-y-6">

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              label: 'Carga Tributária Total',
              value: fmtPct(cargaTributaria),
              sub: cargaTributaria > 20 ? '⚠ Acima de 20%' : 'Dentro do esperado',
              color: cargaTributaria > 20 ? '#d97706' : B.text,
            },
            {
              label: 'PIS/COFINS a Recolher',
              value: fmtR(saldoPIS + saldoCOFINS),
              sub: saldoPIS + saldoCOFINS <= 0 ? 'Saldo credor' : 'A recolher',
              color: saldoPIS + saldoCOFINS > 0 ? '#dc2626' : '#16a34a',
            },
            {
              label: 'ICMS + DIFAL',
              value: fmtR(saldoICMS + totalDIFAL),
              sub: `DIFAL: ${fmtR(totalDIFAL)}`,
              color: saldoICMS + totalDIFAL > 0 ? '#dc2626' : '#16a34a',
            },
            {
              label: 'IRPJ + CSLL',
              value: totalIRPJCSLL > 0 ? fmtR(totalIRPJCSLL) : '—',
              sub: `Base: ${fmtR(lucroBase)}`,
              color: totalIRPJCSLL > 0 ? '#dc2626' : B.muted,
            },
          ].map((kpi, i) => (
            <div key={i} className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
              <div className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: B.muted }}>
                {kpi.label}
              </div>
              <div className="text-2xl font-bold num" style={{ color: kpi.color, fontFamily: 'var(--font-geist-mono)' }}>
                {kpi.value}
              </div>
              <div className="text-xs mt-1" style={{ color: B.muted }}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* Tax blocks */}
        <div className="grid grid-cols-3 gap-4">
          <TaxBlock
            title="PIS / COFINS — Não Cumulativo"
            headerBg={B.brand}
            rows={[
              { label: 'Débito PIS (1,65% NFs saída)',       value: debitoPIS },
              { label: 'Débito COFINS (7,60% NFs saída)',    value: debitoCOFINS },
              { label: 'Total Débito',                       value: debitoPIS + debitoCOFINS, bold: true },
              { label: 'Crédito PIS-Importação',             value: -creditoPISImp, indent: true },
              { label: 'Crédito COFINS-Importação',          value: -creditoCOFINSImp, indent: true },
              { label: 'Crédito compras nacionais',          value: -(creditoPISCompras + creditoCOFINSCompras), indent: true },
              { label: 'Total Créditos',                     value: -(totalCreditoPIS + totalCreditoCOFINS), bold: true },
              { label: 'Saldo a Recolher',                   value: saldoPIS + saldoCOFINS, highlight: true },
            ]}
          />

          <TaxBlock
            title="ICMS Minas Gerais"
            headerBg={B.violeta}
            rows={[
              { label: 'Débito ICMS saídas',                   value: debitoICMS },
              { label: 'Crédito ICMS-GNRE (importação)',        value: -creditoICMSImp, indent: true },
              { label: 'Crédito entradas nacionais (12%)',      value: -creditoICMSEntradas, indent: true },
              { label: 'Total Créditos',                        value: -totalCreditoICMS, bold: true },
              { label: 'Saldo ICMS MG',                         value: saldoICMS, highlight: true },
              { label: 'ICMS DIFAL (recolher por UF)',           value: totalDIFAL },
              { label: 'Total ICMS + DIFAL',                     value: saldoICMS + totalDIFAL, bold: true },
            ]}
          />

          <TaxBlock
            title="IRPJ / CSLL — Lucro Real"
            headerBg={B.text}
            rows={[
              { label: 'Receita Líquida',                       value: totalRevenue },
              { label: '(-) Impostos faturamento',              value: -totalTaxesOnRevenue, indent: true },
              { label: '(-) Custos canal + CMV',                value: -(totalFees + totalCMV), indent: true },
              { label: '(-) Despesas operacionais',             value: -totalExpenses, indent: true },
              { label: 'Base de Cálculo (Lucro Real)',           value: lucroBase, bold: true },
              { label: 'IRPJ (15%)',                            value: irpj },
              { label: 'IRPJ Adicional (10% > R$20k)',          value: irpjAdicional },
              { label: 'CSLL (9%)',                             value: csll },
              { label: 'Total IRPJ + CSLL',                     value: totalIRPJCSLL, highlight: true },
            ]}
          />
        </div>

        <div
          className="rounded-xl px-5 py-3 text-sm"
          style={{ background: 'oklch(0.97 0.06 70)', border: '1px solid oklch(0.88 0.10 70)', color: 'oklch(0.38 0.12 70)' }}
        >
          ⚠ <strong>Créditos de compras nacionais</strong> (PIS/COFINS/ICMS sobre NFs de fornecedores nacionais) serão incluídos automaticamente quando a sincronização de NF-e de entrada de fornecedores nacionais for configurada no Bling.
        </div>
      </div>
    </>
  )
}
