import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentCmp } from '@/lib/landed-cost/calculator'
import { MARKETPLACE_LABELS } from '@/types'
import { subDays, format } from 'date-fns'

export const dynamic = 'force-dynamic'

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

export default async function PrecificacaoPage() {
  const db = createSupabaseServiceClient()
  const since = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const targetMargin = 0.40 // 40% target

  const { data: products } = await db.from('products').select('id, name, sku')
  const rows = await Promise.all(
    (products ?? []).map(async product => {
      const cmp = await getCurrentCmp(product.id)
      if (!cmp) return null

      const { data: sales } = await db
        .from('sales')
        .select('marketplace, gross_price, marketplace_commission')
        .eq('product_id', product.id)
        .gte('sale_date', since)

      const byMP: Record<string, { prices: number[]; commissions: number[] }> = {}
      for (const s of sales ?? []) {
        byMP[s.marketplace] = byMP[s.marketplace] ?? { prices: [], commissions: [] }
        byMP[s.marketplace].prices.push(Number(s.gross_price))
        byMP[s.marketplace].commissions.push(Number(s.marketplace_commission))
      }

      return Object.entries(byMP).map(([mp, data]) => {
        const avgPrice = data.prices.reduce((s, p) => s + p, 0) / data.prices.length
        const avgCommission = data.commissions.reduce((s, c) => s + c, 0) / data.commissions.length
        const commissionPct = avgPrice > 0 ? avgCommission / avgPrice : 0
        // min_price = cmp / (1 - commissionPct - targetMargin)
        const denominator = 1 - commissionPct - targetMargin
        const minPrice = denominator > 0 ? cmp / denominator : 0
        const priceGap = avgPrice - minPrice
        const costSlack = avgPrice * (1 - commissionPct) * (1 - targetMargin) - cmp

        return { product, marketplace: mp, cmp, avgPrice, commissionPct, minPrice, priceGap, costSlack }
      })
    })
  )

  const flatRows = rows.flat().filter(Boolean) as NonNullable<typeof rows[0]>[0][]

  return (
    <>
      <TopBar title="Simulador de Preço" subtitle="Preço mínimo para 40% de margem — baseado no CMP atual" />
      <div className="px-8 py-6">
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3">Produto</th>
                <th className="text-left px-4 py-3">Canal</th>
                <th className="text-right px-4 py-3">CMP Atual</th>
                <th className="text-right px-4 py-3">Preço Médio (30d)</th>
                <th className="text-right px-4 py-3">Preço Mín. (40%)</th>
                <th className="text-right px-5 py-3">Folga</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {flatRows.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400 text-sm">Sem dados suficientes. Importe NF-e e sincronize vendas primeiro.</td></tr>
              )}
              {flatRows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800 text-xs">{row.product.name}</div>
                    <div className="text-gray-400 text-xs">{row.product.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{(MARKETPLACE_LABELS as any)[row.marketplace] ?? row.marketplace}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtR(row.cmp)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtR(row.avgPrice)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-700">{fmtR(row.minPrice)}</td>
                  <td className={`px-5 py-3 text-right font-bold ${row.priceGap >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {row.priceGap >= 0 ? '+' : ''}{fmtR(row.priceGap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">* Margem-alvo: 40%. Para alterar, ajuste o parâmetro <code>targetMargin</code> em <code>app/dashboard/precificacao/page.tsx</code>.</p>
      </div>
    </>
  )
}
