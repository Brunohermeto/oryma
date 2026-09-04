import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'
import { isReturned } from '@/lib/sales/returned'
import { expectedPayout, isPayoutAuditable, type PayoutSale } from '@/lib/sales/payout'
import { mpLabel } from '@/components/marketplaces'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

const fmtR = (v: number) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const B = { border: 'oklch(0.88 0.016 258)', text: '#0B1023', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

type Row = {
  order: string; marketplace: string; sale_date: string
  gross: number; expected: number; actual: number; diff: number; divergent: boolean
}

export default async function RepassePage({
  searchParams,
}: { searchParams: Promise<{ mp?: string; days?: string; only?: string }> }) {
  const db = createSupabaseServiceClient()
  const params = await searchParams
  const mp = params.mp ?? ''
  const days = Number(params.days ?? 45)
  const onlyDiff = params.only !== '0'   // por padrão mostra só as divergências
  const from = brazilDaysAgo(days)

  // só vendas com repasse REAL registrado (payout_actual preenchido)
  const rows: any[] = []
  for (let pg = 0; pg < 30; pg++) {
    let q = db.from('sales')
      .select('external_order_id, marketplace, sale_date, gross_price, cancellation, marketplace_commission, marketplace_fixed_fee, marketplace_shipping_fee, ads_cost, discounts, rebate, payout_actual')
      .not('payout_actual', 'is', null)
      .gte('sale_date', from)
      .order('id', { ascending: true }).range(pg * 1000, pg * 1000 + 999)
    if (mp) q = q.eq('marketplace', mp)
    const { data } = await q
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }

  // agrupa por PEDIDO (repasse é por pedido; a venda é por item)
  const byOrder = new Map<string, Row>()
  for (const s of rows) {
    if (isReturned(s)) continue
    const order = String(s.external_order_id).replace(/^[a-z_]+_/i, '').split('_')[0]
    const key = `${s.marketplace}:${order}`
    if (!byOrder.has(key)) byOrder.set(key, {
      order, marketplace: s.marketplace, sale_date: s.sale_date,
      gross: 0, expected: 0, actual: 0, diff: 0, divergent: false,
    })
    const r = byOrder.get(key)!
    r.gross    += Number(s.gross_price ?? 0)
    r.expected += expectedPayout(s as PayoutSale)
    r.actual   += Number(s.payout_actual ?? 0)
  }
  const all = [...byOrder.values()].map(r => {
    r.diff = Math.round((r.actual - r.expected) * 100) / 100
    // Shopee entra só como referência (fonte não-independente) — nunca divergente
    r.divergent = isPayoutAuditable(r.marketplace)
      && Math.abs(r.diff) > 1 && (r.expected === 0 || Math.abs(r.diff) / Math.abs(r.expected) > 0.02)
    return r
  }).sort((a, b) => a.diff - b.diff)   // mais negativo (pagou menos) no topo

  const shown = onlyDiff ? all.filter(r => r.divergent) : all
  const totExpected = all.reduce((s, r) => s + r.expected, 0)
  const totActual   = all.reduce((s, r) => s + r.actual, 0)
  const totDiff     = Math.round((totActual - totExpected) * 100) / 100
  const nDiv        = all.filter(r => r.divergent).length
  const perdido     = all.filter(r => r.divergent && r.diff < 0).reduce((s, r) => s + r.diff, 0)

  const chip = (label: string, href: string, active: boolean) => (
    <a href={href} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg"
       style={{ background: active ? B.brand : 'oklch(0.96 0.010 258)', color: active ? '#fff' : B.brand }}>{label}</a>
  )

  return (
    <>
      <TopBar title="Auditoria de Repasse" subtitle={`${all.length} pedidos com repasse recebido · ${nDiv} divergentes — últimos ${days} dias`} />
      <div className="px-8 py-6 space-y-4">

        {/* Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Esperado (total)', value: fmtR(totExpected), color: B.text },
            { label: 'Recebido (total)', value: fmtR(totActual), color: B.text },
            { label: 'Diferença', value: fmtR(totDiff), color: Math.abs(totDiff) <= 1 ? '#16a34a' : totDiff < 0 ? '#dc2626' : '#d97706' },
            { label: 'Pedidos divergentes', value: `${nDiv}${perdido < 0 ? ` · ${fmtR(perdido)}` : ''}`, color: nDiv === 0 ? '#16a34a' : '#dc2626' },
          ].map((c, i) => (
            <div key={i} className="bg-white rounded-xl px-4 py-3" style={{ border: `1px solid ${B.border}` }}>
              <div className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: B.muted }}>{c.label}</div>
              <div className="text-base font-bold" style={{ color: c.color, fontFamily: 'var(--font-geist-mono)' }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          {chip('Todos os canais', `/dashboard/repasse?only=${onlyDiff ? '1' : '0'}`, !mp)}
          {['mercado_livre', 'shopee', 'amazon', 'magalu'].map(m =>
            chip(mpLabel(m), `/dashboard/repasse?mp=${m}&only=${onlyDiff ? '1' : '0'}`, mp === m))}
          <span className="mx-1" style={{ color: B.border }}>|</span>
          {chip(onlyDiff ? 'Mostrando só divergências' : 'Mostrando tudo', `/dashboard/repasse?${mp ? `mp=${mp}&` : ''}only=${onlyDiff ? '0' : '1'}`, false)}
        </div>

        {/* Tabela */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${B.border}` }}>
                  {['Pedido', 'Canal', 'Data', 'Esperado', 'Recebido', 'Diferença'].map((h, i) => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest"
                        style={{ color: B.muted, textAlign: i < 3 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: B.muted }}>
                    {onlyDiff ? 'Nenhuma divergência — todos os repasses bateram com o esperado ✓' : 'Nenhum repasse registrado ainda neste período.'}
                  </td></tr>
                )}
                {shown.slice(0, 500).map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid oklch(0.94 0.01 258)`, background: r.divergent ? 'oklch(0.98 0.03 25)' : '#fff' }}>
                    <td className="px-4 py-2.5 text-xs font-medium" style={{ color: B.text }}>{r.order}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: B.muted }}>{mpLabel(r.marketplace)}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: B.muted }}>{r.sale_date}</td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ fontFamily: 'var(--font-geist-mono)', color: B.text }}>{fmtR(r.expected)}</td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ fontFamily: 'var(--font-geist-mono)', color: B.text }}>{fmtR(r.actual)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold" style={{ fontFamily: 'var(--font-geist-mono)', color: !r.divergent ? '#16a34a' : r.diff < 0 ? '#dc2626' : '#d97706' }}>
                      {r.diff > 0 ? '+' : ''}{fmtR(r.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px]" style={{ color: B.muted }}>
          Esperado = bruto − devolução − comissão − taxa fixa − frete do vendedor − ADS − cupom + rebate. Frete do comprador não entra (neutro).
          Só aparecem pedidos cujo repasse já foi registrado. A <b>Shopee</b> entra como referência (a API devolve a Renda estimada dela, não um extrato independente), então não é marcada como divergente — a conciliação com alerta vale para Mercado Livre, Amazon e Magalu.
        </p>
      </div>
    </>
  )
}
