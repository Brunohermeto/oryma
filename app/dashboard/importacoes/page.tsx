import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { NFEUploadZone } from '@/components/importacoes/NFEUploadZone'
import { LandedCostForm } from '@/components/importacoes/LandedCostForm'
import { ManualCostForm } from '@/components/importacoes/ManualCostForm'
import { RelinkButton } from '@/components/importacoes/RelinkButton'
import { CmpEvolutionTable } from '@/components/importacoes/CmpEvolutionTable'
import { FilialCreditsPanel, type TransferOrder } from '@/components/importacoes/FilialCreditsPanel'

// CFOPs de transferência entre estabelecimentos próprios (matriz/filial)
const TRANSFER_CFOPS = new Set(['5151', '5152', '6151', '6152'])

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

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

  const [ordersData, productsData] = await Promise.all([
    db.from('import_orders').select('*, import_costs(amount)').order('issue_date', { ascending: false }).limit(30),
    db.from('products').select('id, name, sku').order('name'),
  ])

  const { data: orders } = ordersData

  const ordersWithTotals = (orders ?? []).map(o => ({
    ...o,
    additional_costs_total: (o.import_costs ?? []).reduce((s: number, c: any) => s + Number(c.amount), 0),
  }))

  const complete = ordersWithTotals.filter(o => o.costs_complete).length
  const pending  = ordersWithTotals.filter(o => !o.costs_complete).length

  // Transferências matriz/filial: crédito PIS/COFINS vem da NF de entrada da filial
  const transferOrders = ordersWithTotals.filter(o => TRANSFER_CFOPS.has(String(o.cfop ?? '')))
  let transfers: TransferOrder[] = []
  if (transferOrders.length) {
    const { data: tItems } = await db.from('import_items')
      .select('import_order_id, unit_pis_imp, unit_cofins_imp, unit_icms_gnre')
      .in('import_order_id', transferOrders.map(o => o.id))
    const credited = new Set(
      (tItems ?? [])
        .filter(i => Number(i.unit_pis_imp) > 0 || Number(i.unit_cofins_imp) > 0 || Number(i.unit_icms_gnre) > 0)
        .map(i => i.import_order_id)
    )
    transfers = transferOrders.map(o => ({
      id: o.id,
      nfe_number: String(o.nfe_number ?? ''),
      issue_date: String(o.issue_date ?? ''),
      hasCredits: credited.has(o.id),
    }))
  }

  return (
    <>
      <TopBar title="NF-e / Importações" subtitle="Landed cost de 14 componentes por lote de importação" />
      <div className="px-4 md:px-8 py-6 space-y-6">

        {/* Upload zone — recolhível */}
        <details className="bg-white rounded-xl" style={{ border: `1px solid ${B.border}` }}>
          <summary className="cursor-pointer select-none px-6 py-4 font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Importar NF-e XML <span className="font-normal text-xs" style={{ color: B.muted }}>— clique para abrir</span>
          </summary>
          <div className="px-6 pb-6">
            <NFEUploadZone />
          </div>
        </details>

        {/* NF-e list — recolhível (começa fechada: só o resumo à vista) */}
        <details className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }} open={pending > 0}>
          <summary className="cursor-pointer select-none px-5 py-4 flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
              NF-e de Entrada — Importações
              <span className="font-normal text-xs ml-2" style={{ color: B.muted }}>({ordersWithTotals.length} notas · clique para abrir/fechar)</span>
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
          </summary>

          <div className="overflow-x-auto" style={{ borderTop: `1px solid ${B.border}` }}>
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
                  className={`transition-colors hover:bg-[oklch(0.96_0.010_258)] ${!order.costs_complete ? 'bg-[oklch(0.98_0.04_70_/_0.4)]' : ''}`}
                  style={{ borderBottom: `1px solid ${B.bgSubtle}` }}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: B.text }}>
                    {order.nfe_number}
                    {TRANSFER_CFOPS.has(String(order.cfop ?? '')) && (
                      <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full align-middle"
                            style={{ background: 'oklch(0.94 0.06 258)', color: '#125BFF' }}>
                        transferência
                      </span>
                    )}
                  </td>
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
        </details>

        {/* Transferências matriz/filial — créditos da NF de entrada da filial */}
        <FilialCreditsPanel transfers={transfers} />

        {/* Re-vincular produtos e recalcular CMP */}
        <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
          <div className="font-semibold text-sm mb-1" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Recalcular CMP
          </div>
          <p className="text-xs mb-4" style={{ color: B.muted }}>
            Use após importar produtos do Bling. Vincula os itens das NF-e importadas aos SKUs e recalcula o Custo Médio Ponderado.
          </p>
          <RelinkButton />
        </div>

        {/* Evolução de CMP e margem por lote de importação */}
        <CmpEvolutionTable />

        {/* Entrada manual de custo */}
        <ManualCostForm products={productsData.data ?? []} />

        {/* Landed cost form — adiciona despesas extras a NF-e já importadas */}
        {ordersWithTotals.length > 0 && <LandedCostForm orders={ordersWithTotals} />}
      </div>
    </>
  )
}
