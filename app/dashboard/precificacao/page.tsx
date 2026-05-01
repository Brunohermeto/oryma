import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentCmp } from '@/lib/landed-cost/calculator'
import { MARKETPLACE_LABELS } from '@/types'
import { subDays, format } from 'date-fns'

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
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

// Marketplace badge colors — Oryma palette
const MP_BADGE: Record<string, { bg: string; color: string }> = {
  mercado_livre: { bg: 'oklch(0.94 0.06 258)', color: '#125BFF' },
  shopee:        { bg: 'oklch(0.94 0.08 280)', color: '#7B61FF' },
  amazon:        { bg: 'oklch(0.94 0.08 204)', color: '#0097b2' },
}

export default async function PrecificacaoPage() {
  const db = createSupabaseServiceClient()
  const since = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const targetMargin = 0.40

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
        const avgPrice      = data.prices.reduce((s, p) => s + p, 0) / data.prices.length
        const avgCommission = data.commissions.reduce((s, c) => s + c, 0) / data.commissions.length
        const commissionPct = avgPrice > 0 ? avgCommission / avgPrice : 0
        const denominator   = 1 - commissionPct - targetMargin
        const minPrice      = denominator > 0 ? cmp / denominator : 0
        const priceGap      = avgPrice - minPrice
        const costSlack     = avgPrice * (1 - commissionPct) * (1 - targetMargin) - cmp
        return { product, marketplace: mp, cmp, avgPrice, commissionPct, minPrice, priceGap, costSlack }
      })
    })
  )

  const flatRows = rows.flat().filter(Boolean) as NonNullable<typeof rows[0]>[0][]

  return (
    <>
      <TopBar title="Simulador de Preço" subtitle="Preço mínimo para 40% de margem — baseado no CMP atual" />
      <div className="px-8 py-6 space-y-4">
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}>
                {['Produto','Canal','CMP Atual','Preço Médio (30d)','Preço Mín. (40%)','Folga'].map((h, i) => (
                  <th
                    key={h}
                    className={`py-3 text-[11px] font-semibold uppercase tracking-wide ${i < 2 ? 'text-left px-5' : 'text-right px-4'} ${i === 5 ? 'px-5' : ''}`}
                    style={{ color: B.muted }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flatRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: B.muted }}>
                    Sem dados suficientes. Importe NF-e e sincronize vendas primeiro.
                  </td>
                </tr>
              )}
              {flatRows.map((row, i) => {
                const badge = MP_BADGE[row.marketplace] ?? { bg: B.bgSubtle, color: B.brand }
                return (
                  <tr
                    key={i}
                    className="transition-colors"
                    style={{ borderBottom: `1px solid ${B.bgSubtle}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = B.bgSubtle }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-xs" style={{ color: B.text }}>{row.product.name}</div>
                      <div className="text-xs mt-0.5" style={{ color: B.muted }}>{row.product.sku}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>
                        {(MARKETPLACE_LABELS as any)[row.marketplace] ?? row.marketplace}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                      {fmtR(row.cmp)}
                    </td>
                    <td className="px-4 py-3 text-right num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                      {fmtR(row.avgPrice)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold num" style={{ color: B.brand, fontFamily: 'var(--font-geist-mono)' }}>
                      {fmtR(row.minPrice)}
                    </td>
                    <td className="px-5 py-3 text-right font-bold num" style={{
                      color: row.priceGap >= 0 ? '#16a34a' : '#dc2626',
                      fontFamily: 'var(--font-geist-mono)',
                    }}>
                      {row.priceGap >= 0 ? '+' : ''}{fmtR(row.priceGap)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs" style={{ color: B.muted }}>
          * Margem-alvo: 40%. Para alterar, ajuste o parâmetro <code>targetMargin</code> em{' '}
          <code>app/dashboard/precificacao/page.tsx</code>.
        </p>
      </div>
    </>
  )
}
