import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { NFEUploadZone } from '@/components/importacoes/NFEUploadZone'
import { LandedCostForm } from '@/components/importacoes/LandedCostForm'

export const dynamic = 'force-dynamic'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  subtle:   'oklch(0.40 0.020 258)',
  brand:    '#125BFF',
}

function fmtR(v: number) {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

export default async function ImportacoesPage() {
  const db = createSupabaseServiceClient()

  const { data: orders } = await db
    .from('import_orders')
    .select('*, import_costs(amount)')
    .order('issue_date', { ascending: false })
    .limit(30)

  const ordersWithTotals = (orders ?? []).map(o => ({
    ...o,
    additional_costs_total: (o.import_costs ?? []).reduce((s: number, c: any) => s + Number(c.amount), 0),
  }))

  const complete = ordersWithTotals.filter(o => o.costs_complete).length
  const pending  = ordersWithTotals.filter(o => !o.costs_complete).length

  return (
    <>
      <TopBar title="NF-e / Importações" subtitle="Landed cost de 14 componentes por lote de importação" />
      <div className="px-4 md:px-8 py-6 space-y-6">

        {/* Upload zone */}
        <div className="bg-white rounded-xl p-6" style={{ border: `1px solid ${B.border}` }}>
          <h2 className="font-semibold text-sm mb-4" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Importar NF-e XML
          </h2>
          <NFEUploadZone />
        </div>

        {/* NF-e list */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${B.border}` }}>
            <div className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
              NF-e de Entrada — Importações
            </div>
            <div className="flex gap-2 text-xs">
              <span className="font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'oklch(0.94 0.10 145)', color: '#15803d' }}>
                {complete} completas
              </span>
              <span className="font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'oklch(0.96 0.08 70)', color: '#92400e' }}>
                {pending} com custos pendentes
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}>
                {['NF-e','Fornecedor','Data','Valor NF','Despesas Adicionais','Custo Total','Status'].map((h, i) => (
                  <th
                    key={h}
                    className={`py-3 text-[11px] font-semibold uppercase tracking-wide ${i < 3 ? 'text-left px-5' : i === 6 ? 'text-center px-5' : 'text-right px-4'}`}
                    style={{ color: B.muted }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordersWithTotals.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm" style={{ color: B.muted }}>
                    Nenhuma NF-e importada ainda. Faça upload de XMLs ou sincronize com o Bling.
                  </td>
                </tr>
              )}
              {ordersWithTotals.map(order => (
                <tr
                  key={order.id}
                  className="transition-colors"
                  style={{
                    borderBottom: `1px solid ${B.bgSubtle}`,
                    background: !order.costs_complete ? 'oklch(0.98 0.04 70 / 0.4)' : '',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = B.bgSubtle }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = !order.costs_complete ? 'oklch(0.98 0.04 70 / 0.4)' : '' }}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: B.text }}>{order.nfe_number}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: B.subtle }}>{order.supplier}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: B.muted }}>{order.issue_date}</td>
                  <td className="px-4 py-3 text-right num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                    {fmtR(Number(order.total_nfe_value))}
                  </td>
                  <td className="px-4 py-3 text-right text-xs num" style={{
                    color: !order.costs_complete ? '#d97706' : B.muted,
                    fontWeight: !order.costs_complete ? 600 : undefined,
                    fontFamily: 'var(--font-geist-mono)',
                  }}>
                    {order.additional_costs_total > 0 ? fmtR(order.additional_costs_total) : '—'}
                    {!order.costs_complete && ' ⚠'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold num" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                    {fmtR(Number(order.total_nfe_value) + order.additional_costs_total)}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={order.costs_complete
                        ? { background: 'oklch(0.94 0.10 145)', color: '#15803d' }
                        : { background: 'oklch(0.96 0.08 70)', color: '#92400e' }}
                    >
                      {order.costs_complete ? 'Completa' : 'Pendente'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* Landed cost form */}
        <LandedCostForm orders={ordersWithTotals} />
      </div>
    </>
  )
}
