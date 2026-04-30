import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { MARKETPLACE_LABELS } from '@/types'
import { subDays, format } from 'date-fns'

export const dynamic = 'force-dynamic'

export default async function VelocidadePage() {
  const db = createSupabaseServiceClient()
  const today = new Date()
  const d30 = format(subDays(today, 30), 'yyyy-MM-dd')
  const d60 = format(subDays(today, 60), 'yyyy-MM-dd')

  const { data: products } = await db.from('products').select('id, name, sku, stock_quantity')

  const rows = await Promise.all(
    (products ?? []).map(async product => {
      const { data: recent } = await db
        .from('sales')
        .select('marketplace, quantity')
        .eq('product_id', product.id)
        .gte('sale_date', d30)

      const { data: prev } = await db
        .from('sales')
        .select('marketplace, quantity')
        .eq('product_id', product.id)
        .gte('sale_date', d60)
        .lt('sale_date', d30)

      const byMP: Record<string, { recent: number; prev: number }> = {}
      for (const s of recent ?? []) {
        byMP[s.marketplace] = byMP[s.marketplace] ?? { recent: 0, prev: 0 }
        byMP[s.marketplace].recent += Number(s.quantity)
      }
      for (const s of prev ?? []) {
        byMP[s.marketplace] = byMP[s.marketplace] ?? { recent: 0, prev: 0 }
        byMP[s.marketplace].prev += Number(s.quantity)
      }

      return Object.entries(byMP).map(([mp, data]) => {
        const unitsPerDay = data.recent / 30
        const daysOfStock = unitsPerDay > 0 ? Math.floor(Number(product.stock_quantity) / unitsPerDay) : null
        const trend = data.recent > data.prev * 1.1 ? 'up' : data.recent < data.prev * 0.9 ? 'down' : 'stable'
        return { product, marketplace: mp, ...data, unitsPerDay, daysOfStock, trend }
      })
    })
  )

  const flatRows = rows.flat().sort((a, b) => b.recent - a.recent)

  return (
    <>
      <TopBar title="Velocidade de Venda" subtitle="Unidades por dia por produto e canal — últimos 30 dias" />
      <div className="px-8 py-6">
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3">Produto</th>
                <th className="text-left px-4 py-3">Canal</th>
                <th className="text-right px-4 py-3">Últimos 30d</th>
                <th className="text-right px-4 py-3">Un./dia</th>
                <th className="text-center px-4 py-3">Tendência</th>
                <th className="text-right px-4 py-3">Estoque</th>
                <th className="text-right px-5 py-3">Dias restantes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {flatRows.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400 text-sm">Sem dados de venda ainda.</td></tr>
              )}
              {flatRows.map((row, i) => (
                <tr key={i} className={`hover:bg-gray-50 ${row.daysOfStock !== null && row.daysOfStock < 30 ? 'bg-red-50/20' : ''}`}>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800 text-xs">{row.product.name}</div>
                    <div className="text-gray-400 text-xs">{row.product.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{(MARKETPLACE_LABELS as any)[row.marketplace] ?? row.marketplace}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{row.recent.toFixed(0)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{row.unitsPerDay.toFixed(1)}</td>
                  <td className={`px-4 py-3 text-center font-bold ${row.trend === 'up' ? 'text-green-600' : row.trend === 'down' ? 'text-red-500' : 'text-gray-400'}`}>
                    {row.trend === 'up' ? '▲' : row.trend === 'down' ? '▼' : '→'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{Number(row.product.stock_quantity).toFixed(0)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${
                    row.daysOfStock === null ? 'text-gray-300' :
                    row.daysOfStock < 30 ? 'text-red-600' :
                    row.daysOfStock < 60 ? 'text-amber-500' : 'text-green-600'
                  }`}>
                    {row.daysOfStock === null ? '—' : `${row.daysOfStock}d`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
