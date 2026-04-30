import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { MARKETPLACE_LABELS } from '@/types'

export const dynamic = 'force-dynamic'

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}
function fmtPct(v: number) {
  return `${(Number(v) * 100).toFixed(1)}%`
}

const FULFILLMENT_LABELS: Record<string, string> = {
  galpao: 'Galpão',
  full_ml: 'Full ML',
  fba_amazon: 'FBA',
}

export default async function VendasPage() {
  const db = createSupabaseServiceClient()
  const { data: sales } = await db
    .from('sales')
    .select(`
      id, external_order_id, marketplace, fulfillment_type, sku, sale_date,
      quantity, gross_price, marketplace_commission, marketplace_shipping_fee,
      ads_cost, cancellation,
      products(name, sku),
      sale_taxes(pis, cofins, icms, icms_difal, total_taxes),
      sale_costs(unit_cost_applied, total_cost, margin_value, margin_pct)
    `)
    .order('sale_date', { ascending: false })
    .limit(100)

  return (
    <>
      <TopBar title="Feed de Vendas" subtitle="Custo e margem real por venda individual — últimas 100 vendas" />
      <div className="px-8 py-6">
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3">Data</th>
                <th className="text-left px-4 py-3">Produto</th>
                <th className="text-left px-4 py-3">Canal</th>
                <th className="text-right px-4 py-3">Preço</th>
                <th className="text-right px-4 py-3">Impostos</th>
                <th className="text-right px-4 py-3">Tarifa MP</th>
                <th className="text-right px-4 py-3">CMV</th>
                <th className="text-right px-5 py-3">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(sales ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-gray-400 text-sm">
                    Nenhuma venda sincronizada ainda. Sincronize os marketplaces em Configurações.
                  </td>
                </tr>
              )}
              {(sales ?? []).map(sale => {
                const taxes = (sale.sale_taxes as any)?.[0]
                const cost = (sale.sale_costs as any)?.[0]
                const totalTaxes = taxes?.total_taxes ?? 0
                const marginPct = cost?.margin_pct ?? null
                const product = sale.products as any

                return (
                  <tr key={sale.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-500 text-xs">{sale.sale_date}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 text-xs">{product?.name ?? sale.sku ?? '—'}</div>
                      <div className="text-gray-400 text-xs">{sale.sku} · {(FULFILLMENT_LABELS as any)[sale.fulfillment_type]}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{(MARKETPLACE_LABELS as any)[sale.marketplace] ?? sale.marketplace}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtR(Number(sale.gross_price))}</td>
                    <td className="px-4 py-3 text-right text-red-400 text-xs">
                      {totalTaxes ? `(${fmtR(Number(totalTaxes))})` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400 text-xs">
                      {Number(sale.marketplace_commission) ? `(${fmtR(Number(sale.marketplace_commission))})` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400 text-xs">
                      {cost?.total_cost ? `(${fmtR(Number(cost.total_cost))})` : '—'}
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold ${
                      marginPct === null ? 'text-gray-300' :
                      Number(marginPct) >= 0.35 ? 'text-green-600' :
                      Number(marginPct) >= 0.20 ? 'text-amber-500' : 'text-red-500'
                    }`}>
                      {marginPct !== null ? fmtPct(Number(marginPct)) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
