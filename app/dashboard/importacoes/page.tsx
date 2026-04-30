import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { NFEUploadZone } from '@/components/importacoes/NFEUploadZone'
import { LandedCostForm } from '@/components/importacoes/LandedCostForm'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

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

  return (
    <>
      <TopBar title="NF-e / Importações" subtitle="Landed cost de 14 componentes por lote de importação" />
      <div className="px-8 py-6 space-y-6">

        {/* Upload zone */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 text-sm mb-4">Importar NF-e XML</h2>
          <NFEUploadZone />
        </div>

        {/* NF-e list */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="font-semibold text-gray-800 text-sm">NF-e de Entrada — Importações</div>
            <div className="flex gap-2 text-xs">
              <span className="bg-green-100 text-green-700 font-semibold px-2.5 py-1 rounded-full">
                {ordersWithTotals.filter(o => o.costs_complete).length} completas
              </span>
              <span className="bg-yellow-100 text-yellow-700 font-semibold px-2.5 py-1 rounded-full">
                {ordersWithTotals.filter(o => !o.costs_complete).length} com custos pendentes
              </span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3">NF-e</th>
                <th className="text-left px-4 py-3">Fornecedor</th>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-right px-4 py-3">Valor NF</th>
                <th className="text-right px-4 py-3">Despesas Adicionais</th>
                <th className="text-right px-4 py-3">Custo Total</th>
                <th className="text-center px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ordersWithTotals.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-400 text-sm">
                    Nenhuma NF-e importada ainda. Faça upload de XMLs ou sincronize com o Bling.
                  </td>
                </tr>
              )}
              {ordersWithTotals.map(order => (
                <tr key={order.id} className={`hover:bg-gray-50 ${!order.costs_complete ? 'bg-yellow-50/20' : ''}`}>
                  <td className="px-5 py-3 font-medium text-gray-800">{order.nfe_number}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{order.supplier}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{order.issue_date}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtR(Number(order.total_nfe_value))}</td>
                  <td className={`px-4 py-3 text-right text-xs ${!order.costs_complete ? 'text-yellow-600 font-medium' : 'text-gray-500'}`}>
                    {order.additional_costs_total > 0 ? fmtR(order.additional_costs_total) : '—'}
                    {!order.costs_complete && ' ⚠'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {fmtR(Number(order.total_nfe_value) + order.additional_costs_total)}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <Badge variant={order.costs_complete ? 'default' : 'secondary'}>
                      {order.costs_complete ? 'Completa' : 'Pendente'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Landed cost form */}
        <LandedCostForm orders={ordersWithTotals} />
      </div>
    </>
  )
}
