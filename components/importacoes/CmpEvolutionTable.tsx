import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  subtle:   'oklch(0.40 0.020 258)',
  brand:    '#125BFF',
}

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtPct(v: number) {
  const sign = v > 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(1)}%`
}
function fmtDate(d: string) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

interface CmpEra {
  id: string
  productId: string
  productSku: string
  productName: string
  effectiveDate: string
  cmpValue: number
  totalStockQty: number
  salesCount: number
  avgMarginPct: number | null
  totalRevenue: number
}

export async function CmpEvolutionTable() {
  const db = createSupabaseServiceClient()

  // 1. Busca todos os CMPs com dados do produto
  const { data: rawCmps } = await db
    .from('cmp_costs')
    .select('id, product_id, cmp_value, effective_date, total_stock_qty, calculated_at, products(id, sku, name)')
    .order('effective_date', { ascending: false })
    .order('calculated_at', { ascending: false })

  // 2. Deduplica: mantém um registro por (product_id, effective_date)
  const seen = new Set<string>()
  const cmps = (rawCmps ?? []).filter(c => {
    const key = `${c.product_id}_${c.effective_date}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (!cmps.length) return null

  // 3. Busca estatísticas de vendas por cmp_cost_id
  const cmpIds = cmps.map(c => c.id)
  const { data: saleStats } = await db
    .from('sale_costs')
    .select('cmp_cost_id, margin_pct, total_cost, sales(gross_price, cancellation)')
    .in('cmp_cost_id', cmpIds)

  // Agrega por cmp_cost_id
  const statsByCmp = new Map<string, {
    count: number; marginSum: number; marginCount: number; revenue: number
  }>()
  for (const s of saleStats ?? []) {
    if (!s.cmp_cost_id) continue
    const sale = s.sales as any
    const existing = statsByCmp.get(s.cmp_cost_id) ?? { count: 0, marginSum: 0, marginCount: 0, revenue: 0 }
    existing.count++
    if (s.margin_pct !== null && s.margin_pct !== undefined) {
      existing.marginSum += Number(s.margin_pct)
      existing.marginCount++
    }
    existing.revenue += Math.max(0, Number(sale?.gross_price ?? 0) - Number(sale?.cancellation ?? 0))
    statsByCmp.set(s.cmp_cost_id, existing)
  }

  // 4. Monta eras por produto
  const byProduct = new Map<string, CmpEra[]>()
  for (const c of cmps) {
    const prod = c.products as any
    if (!prod) continue
    const stats = statsByCmp.get(c.id)
    const era: CmpEra = {
      id:            c.id,
      productId:     c.product_id,
      productSku:    prod.sku,
      productName:   prod.name,
      effectiveDate: c.effective_date ?? '',
      cmpValue:      Number(c.cmp_value),
      totalStockQty: Number(c.total_stock_qty),
      salesCount:    stats?.count ?? 0,
      avgMarginPct:  stats && stats.marginCount > 0 ? stats.marginSum / stats.marginCount : null,
      totalRevenue:  stats?.revenue ?? 0,
    }
    if (!byProduct.has(c.product_id)) byProduct.set(c.product_id, [])
    byProduct.get(c.product_id)!.push(era)
  }

  // Ordena eras de cada produto por data ASC (mais antiga primeiro = linha do tempo)
  for (const [, eras] of byProduct) {
    eras.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  }

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${B.border}` }}>
        <div className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
          Evolução de Custo e Margem por Lote
        </div>
        <p className="text-xs mt-0.5" style={{ color: B.muted }}>
          Cada linha = um lote de importação. CMP acumulado ponderado entre todos os lotes anteriores.
        </p>
      </div>

      <div className="overflow-x-auto">
        {[...byProduct.values()].map(eras => {
          const latest = eras[eras.length - 1]
          return (
            <div key={latest.productId}>
              {/* Cabeçalho do produto */}
              <div
                className="px-5 py-2 flex items-center gap-3"
                style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}
              >
                <span className="font-mono text-xs font-bold" style={{ color: B.brand }}>
                  {latest.productSku}
                </span>
                <span className="text-xs" style={{ color: B.subtle }}>{latest.productName}</span>
                <span className="ml-auto text-xs font-semibold" style={{ color: B.muted }}>
                  CMP atual: {fmtR(latest.cmpValue)}
                </span>
              </div>

              {/* Tabela de lotes */}
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                    {['Lote (data NF-e)', 'CMP do lote', 'Δ vs anterior', 'Qtd estoque', 'Vendas c/ este CMP', 'Margem média', 'Faturamento'].map((h, i) => (
                      <th
                        key={h}
                        className={`py-2 font-semibold uppercase tracking-wide ${i < 2 ? 'text-left px-5' : 'text-right px-4'}`}
                        style={{ color: B.muted, fontSize: '10px' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eras.map((era, idx) => {
                    const prev = idx > 0 ? eras[idx - 1] : null
                    const delta = prev ? (era.cmpValue - prev.cmpValue) / prev.cmpValue : null
                    const isUp   = delta !== null && delta > 0.001
                    const isDown = delta !== null && delta < -0.001
                    const isNew  = idx === eras.length - 1

                    return (
                      <tr
                        key={era.id}
                        className="hover:bg-[oklch(0.97_0.010_258)] transition-colors"
                        style={{
                          borderBottom: `1px solid ${B.bgSubtle}`,
                          background: isNew ? 'oklch(0.97 0.02 258)' : undefined,
                        }}
                      >
                        {/* Data lote */}
                        <td className="px-5 py-2.5 font-medium" style={{ color: B.text }}>
                          {fmtDate(era.effectiveDate)}
                          {isNew && (
                            <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: 'oklch(0.94 0.10 258)', color: B.brand }}>
                              atual
                            </span>
                          )}
                        </td>

                        {/* CMP */}
                        <td className="px-5 py-2.5 font-semibold tabular-nums" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                          {fmtR(era.cmpValue)}
                        </td>

                        {/* Delta */}
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {delta === null ? (
                            <span style={{ color: B.muted }}>—</span>
                          ) : (
                            <span className="inline-flex items-center justify-end gap-1 font-semibold"
                              style={{ color: isUp ? '#dc2626' : isDown ? '#16a34a' : B.muted }}>
                              {isUp && <TrendingUp size={11} />}
                              {isDown && <TrendingDown size={11} />}
                              {!isUp && !isDown && <Minus size={11} />}
                              {fmtPct(delta)}
                            </span>
                          )}
                        </td>

                        {/* Qtd estoque no lote */}
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                          {era.totalStockQty.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un
                        </td>

                        {/* Vendas */}
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: era.salesCount > 0 ? B.subtle : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                          {era.salesCount > 0 ? `${era.salesCount} venda${era.salesCount > 1 ? 's' : ''}` : '—'}
                        </td>

                        {/* Margem média */}
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {era.avgMarginPct !== null ? (
                            <span className="font-semibold" style={{
                              color: era.avgMarginPct >= 0.35 ? '#16a34a'
                                   : era.avgMarginPct >= 0.20 ? '#d97706'
                                   : '#dc2626',
                              fontFamily: 'var(--font-geist-mono)',
                            }}>
                              {(era.avgMarginPct * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span style={{ color: B.muted }}>—</span>
                          )}
                        </td>

                        {/* Faturamento no período */}
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                          {era.totalRevenue > 0 ? fmtR(era.totalRevenue) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      {[...byProduct.values()].length === 0 && (
        <div className="px-5 py-8 text-center text-sm" style={{ color: B.muted }}>
          Nenhum lote de importação com CMP calculado ainda.
          Importe uma NF-e e clique em "Vincular produtos e recalcular CMP".
        </div>
      )}
    </div>
  )
}
