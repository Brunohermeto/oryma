export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

/**
 * Marketing & Ads — investimento em anúncios por canal, campanha e PRODUTO.
 * Fontes: ads_metrics (ML via API diária; Shopee/Amazon via upload quinzenal).
 * "Ads por produto" usa sales.ads_cost (o MESMO valor que entra na margem,
 * rateado por produto/dia — regra do Bruno 02/10/2026).
 */
import Link from 'next/link'
import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { brazilToday } from '@/lib/utils/brazil-time'
import { isReturned } from '@/lib/sales/returned'
import { AdsUpload } from '@/components/ads/AdsUpload'

const MP: Record<string, { label: string; color: string }> = {
  mercado_livre: { label: 'Mercado Livre', color: '#E6A800' },
  shopee: { label: 'Shopee', color: '#EE4D2D' },
  amazon: { label: 'Amazon', color: '#232F3E' },
  magalu: { label: 'Magalu', color: '#0086FF' },
}
const CANAIS = ['mercado_livre', 'shopee', 'amazon', 'magalu']
const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.97 0.008 258)', text: '#0B1023', muted: 'oklch(0.50 0.025 258)' }

const R = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const P = (v: number | null) => v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`
const X = (v: number | null) => v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}x`
const div = (a: number, b: number) => (b > 0 ? a / b : null)

type Row = { marketplace: string; campaign_id: string; campaign_name: string | null; ad_ref: string; ad_title: string | null; product_skus: string[]; impressions: number; clicks: number; cost: number; ad_sales: number; ad_orders: number; date_from: string; date_to: string }
type Sale = { id: string; marketplace: string; product_id: string | null; gross_price: number; cancellation: number; discounts: number; ads_cost: number; sale_costs: { margin_value: number | null } | { margin_value: number | null }[] | null }

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ mes?: string; canal?: string }> }) {
  const sp = await searchParams
  const hoje = brazilToday()
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? '') ? sp.mes! : hoje.slice(0, 7)
  const canal = CANAIS.includes(sp.canal ?? '') ? sp.canal! : null
  const ini = `${mes}-01`
  const fimDate = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)
  const fim = `${mes}-${String(fimDate.getDate()).padStart(2, '0')}`
  const db = createSupabaseServiceClient()
  // evolução mensal: o mês escolhido + os 5 anteriores
  const evoIni = (() => { const d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 6, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` })()

  const [rows, sales, { data: produtos }, { data: mapeados }, evoAds, evoVendas] = await Promise.all([
    fetchAll<Row>(() => {
      let q = db.from('ads_metrics').select('marketplace, campaign_id, campaign_name, ad_ref, ad_title, product_skus, impressions, clicks, cost, ad_sales, ad_orders, date_from, date_to')
        .gte('date_from', ini).lte('date_from', fim)
      if (canal) q = q.eq('marketplace', canal)
      return q.order('id')
    }),
    fetchAll<Sale>(() => {
      let q = db.from('sales').select('id, marketplace, product_id, gross_price, cancellation, discounts, ads_cost, sale_costs(margin_value)')
        .gte('sale_date', ini).lte('sale_date', fim)
      if (canal) q = q.eq('marketplace', canal)
      return q.order('id')
    }),
    db.from('products').select('id, sku, name').eq('archived', false).order('sku').range(0, 4999),
    db.from('ads_campaign_products').select('marketplace, campaign_id'),
    fetchAll<{ marketplace: string; date_from: string; cost: number; ad_sales: number }>(() => {
      let q = db.from('ads_metrics').select('marketplace, date_from, cost, ad_sales').gte('date_from', evoIni).lte('date_from', fim)
      if (canal) q = q.eq('marketplace', canal)
      return q.order('id')
    }),
    fetchAll<{ marketplace: string; sale_date: string; gross_price: number; cancellation: number; discounts: number }>(() => {
      let q = db.from('sales').select('marketplace, sale_date, gross_price, cancellation, discounts').gte('sale_date', evoIni).lte('sale_date', fim)
      if (canal) q = q.eq('marketplace', canal)
      return q.order('id')
    }),
  ])
  const prodById = new Map((produtos ?? []).map(p => [p.id as string, p as { id: string; sku: string; name: string }]))
  const prodBySku = new Map((produtos ?? []).map(p => [p.sku as string, p as { id: string; sku: string; name: string }]))
  const n = (v: unknown) => Number(v ?? 0)
  const liq = (s: Sale) => n(s.gross_price) - n(s.cancellation) - n(s.discounts)
  const vivas = sales.filter(s => !isReturned(s))

  // ── por canal ──
  type Agg = { cost: number; adSales: number; imp: number; clicks: number; orders: number; receita: number; adsRateado: number }
  const novo = (): Agg => ({ cost: 0, adSales: 0, imp: 0, clicks: 0, orders: 0, receita: 0, adsRateado: 0 })
  const porCanal = new Map<string, Agg>()
  const ag = (k: string) => { if (!porCanal.has(k)) porCanal.set(k, novo()); return porCanal.get(k)! }
  for (const r of rows) { const a = ag(r.marketplace); a.cost += n(r.cost); a.adSales += n(r.ad_sales); a.imp += n(r.impressions); a.clicks += n(r.clicks); a.orders += n(r.ad_orders) }
  for (const s of vivas) { const a = ag(s.marketplace); a.receita += liq(s); a.adsRateado += n(s.ads_cost) }
  const tot = novo()
  for (const a of porCanal.values()) for (const k of Object.keys(tot) as (keyof Agg)[]) tot[k] += a[k]

  // ── por campanha ──
  const porCamp = new Map<string, Agg & { mp: string; nome: string }>()
  for (const r of rows) {
    const k = `${r.marketplace}|${r.campaign_id || r.ad_ref}`
    if (!porCamp.has(k)) porCamp.set(k, { ...novo(), mp: r.marketplace, nome: r.campaign_name || r.ad_title || r.ad_ref || r.campaign_id })
    const a = porCamp.get(k)!; a.cost += n(r.cost); a.adSales += n(r.ad_sales); a.imp += n(r.impressions); a.clicks += n(r.clicks); a.orders += n(r.ad_orders)
  }
  const campanhas = [...porCamp.values()].filter(c => c.cost > 0).sort((a, b) => b.cost - a.cost)

  // ── por produto (ads rateado = o que entra na margem) ──
  type PA = { receita: number; ads: Record<string, number>; adsTot: number; mv: number; base: number; adSales: number }
  const porProd = new Map<string, PA>()
  const pp = (id: string) => { if (!porProd.has(id)) porProd.set(id, { receita: 0, ads: {}, adsTot: 0, mv: 0, base: 0, adSales: 0 }); return porProd.get(id)! }
  for (const s of vivas) {
    if (!s.product_id) continue
    const a = pp(s.product_id); a.receita += liq(s)
    const ads = n(s.ads_cost); a.ads[s.marketplace] = (a.ads[s.marketplace] ?? 0) + ads; a.adsTot += ads
    const sc = Array.isArray(s.sale_costs) ? s.sale_costs[0] : s.sale_costs
    if (sc?.margin_value !== null && sc?.margin_value !== undefined) { a.mv += n(sc.margin_value); a.base += liq(s) }
  }
  // vendas atribuídas aos anúncios, divididas igualmente entre os produtos do anúncio
  for (const r of rows) {
    const ids = (r.product_skus ?? []).map(s => prodBySku.get(s)?.id).filter(Boolean) as string[]
    for (const id of ids) pp(id).adSales += n(r.ad_sales) / ids.length
  }
  const prods = [...porProd.entries()].filter(([, a]) => a.adsTot > 0 || a.adSales > 0).sort((a, b) => b[1].adsTot - a[1].adsTot)

  // campanhas Amazon/Shopee com gasto e sem produto (ainda não vinculadas)
  const jaMap = new Set((mapeados ?? []).map(m => `${m.marketplace}|${m.campaign_id}`))
  const pend = new Map<string, { marketplace: string; campaign_id: string; campaign_name: string | null; cost: number }>()
  for (const r of rows) {
    if (r.marketplace === 'mercado_livre' || n(r.cost) <= 0 || (r.product_skus ?? []).length) continue
    const k = `${r.marketplace}|${r.campaign_id}`
    if (jaMap.has(k)) continue
    const p = pend.get(k) ?? { marketplace: r.marketplace, campaign_id: r.campaign_id, campaign_name: r.campaign_name, cost: 0 }
    p.cost += n(r.cost); pend.set(k, p)
  }

  // evolução mensal (investimento, vendas via ads, faturamento → ROAS e TACOS)
  const evo = new Map<string, { cost: number; adSales: number; receita: number }>()
  const ev = (m: string) => { if (!evo.has(m)) evo.set(m, { cost: 0, adSales: 0, receita: 0 }); return evo.get(m)! }
  for (const r of evoAds) { const a = ev(r.date_from.slice(0, 7)); a.cost += n(r.cost); a.adSales += n(r.ad_sales) }
  for (const s of evoVendas) {
    if (isReturned(s)) continue
    ev(s.sale_date.slice(0, 7)).receita += n(s.gross_price) - n(s.cancellation) - n(s.discounts)
  }
  const evoMeses = [...evo.keys()].sort()

  const meses = Array.from({ length: 6 }, (_, i) => { const d = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1 - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  const link = (m: string, c: string | null) => `/dashboard/ads?mes=${m}${c ? `&canal=${c}` : ''}`
  const th = 'px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-right whitespace-nowrap'
  const td = 'px-2 py-2 text-[12px] text-right whitespace-nowrap'
  const mono = { fontFamily: 'var(--font-geist-mono)', color: B.text }
  const canaisVis = canal ? [canal] : CANAIS.filter(c => porCanal.has(c))

  const Kpi = ({ t, v, s }: { t: string; v: string; s?: string }) => (
    <div className="bg-white rounded-2xl p-4" style={{ border: `1px solid ${B.border}` }}>
      <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: B.muted }}>{t}</div>
      <div className="text-xl font-bold mt-1" style={mono}>{v}</div>
      {s && <div className="text-[11px] mt-0.5" style={{ color: B.muted }}>{s}</div>}
    </div>
  )

  return (
    <>
      <TopBar title="Marketing & Ads" subtitle="Investimento em anúncios por canal, campanha e produto — ML automático; Shopee e Amazon por upload quinzenal" />
      <div className="px-4 md:px-8 py-6 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {/* qualquer mês (sem JS: formulário GET nativo) */}
          <form method="get" className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold" style={{ color: B.muted }}>Mês</span>
            <input type="month" name="mes" defaultValue={mes} max={hoje.slice(0, 7)} className="text-[12px] px-2 py-1 rounded-lg" style={{ border: `1px solid ${B.border}`, color: B.text }} />
            {canal && <input type="hidden" name="canal" value={canal} />}
            <button type="submit" className="text-[12px] px-2.5 py-1 rounded-lg cursor-pointer" style={{ background: '#125BFF', color: 'white', border: 'none' }}>Ver</button>
          </form>
          {meses.map(m => <Link key={m} href={link(m, canal)} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: m === mes ? '#125BFF' : B.bg, color: m === mes ? 'white' : B.muted }}>{m.slice(5)}/{m.slice(2, 4)}</Link>)}
          <span className="mx-2" style={{ color: B.border }}>|</span>
          <Link href={link(mes, null)} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: !canal ? '#0B1023' : B.bg, color: !canal ? 'white' : B.muted }}>Todos</Link>
          {CANAIS.map(c => <Link key={c} href={link(mes, c)} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: canal === c ? MP[c].color : B.bg, color: canal === c ? 'white' : B.muted }}>{MP[c].label}</Link>)}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Kpi t="Investimento" v={R(tot.cost)} />
          <Kpi t="Vendas via ads" v={R(tot.adSales)} s="atribuídas pelo marketplace" />
          <Kpi t="ROAS" v={X(div(tot.adSales, tot.cost))} s="vendas ads ÷ investimento" />
          <Kpi t="ACOS" v={P(div(tot.cost, tot.adSales) !== null ? div(tot.cost, tot.adSales)! * 100 : null)} s="investimento ÷ vendas ads" />
          <Kpi t="TACOS" v={P(div(tot.cost, tot.receita) !== null ? div(tot.cost, tot.receita)! * 100 : null)} s="investimento ÷ faturamento total" />
          <Kpi t="CPC" v={tot.clicks ? `R$ ${(tot.cost / tot.clicks).toFixed(2)}` : '—'} s={`${tot.clicks.toLocaleString('pt-BR')} cliques`} />
          <Kpi t="CTR" v={P(div(tot.clicks, tot.imp) !== null ? div(tot.clicks, tot.imp)! * 100 : null)} s={`${Math.round(tot.imp).toLocaleString('pt-BR')} impressões`} />
        </div>

        <div className="bg-white rounded-2xl p-5 overflow-x-auto" style={{ border: `1px solid ${B.border}` }}>
          <div className="text-sm font-semibold mb-1" style={{ color: B.text }}>Evolução mensal {canal ? `— ${MP[canal].label}` : ''}</div>
          <div className="text-[12px] mb-3" style={{ color: B.muted }}>Últimos 6 meses até o mês escolhido. Shopee/Amazon só aparecem nos meses com relatório enviado.</div>
          <table className="w-full"><thead><tr style={{ color: B.muted, borderBottom: `1px solid ${B.border}` }}>
            <th className={`${th} text-left`}>Mês</th><th className={th}>Investimento</th><th className={th}>Vendas via ads</th><th className={th}>ROAS</th><th className={th}>Faturamento</th><th className={th}>TACOS</th>
          </tr></thead><tbody>
            {evoMeses.map(m => { const a = evo.get(m)!; return (
              <tr key={m} style={{ borderBottom: `1px solid ${B.bg}`, background: m === mes ? B.bg : undefined }}>
                <td className="px-2 py-2 text-[12px] font-medium" style={{ color: B.text }}><Link href={link(m, canal)}>{m.slice(5)}/{m.slice(0, 4)}</Link></td>
                <td className={td} style={mono}>{R(a.cost)}</td><td className={td} style={mono}>{R(a.adSales)}</td>
                <td className={td} style={mono}>{X(div(a.adSales, a.cost))}</td><td className={td} style={mono}>{R(a.receita)}</td>
                <td className={td} style={mono}>{P(div(a.cost, a.receita) !== null ? div(a.cost, a.receita)! * 100 : null)}</td>
              </tr>) })}
          </tbody></table>
        </div>

        <div className="bg-white rounded-2xl p-5 overflow-x-auto" style={{ border: `1px solid ${B.border}` }}>
          <div className="text-sm font-semibold mb-3" style={{ color: B.text }}>Por canal</div>
          <table className="w-full"><thead><tr style={{ color: B.muted, borderBottom: `1px solid ${B.border}` }}>
            <th className={`${th} text-left`}>Canal</th><th className={th}>Investimento</th><th className={th}>Vendas via ads</th><th className={th}>ROAS</th><th className={th}>ACOS</th>
            <th className={th}>Faturamento</th><th className={th}>TACOS</th><th className={th}>Cliques</th><th className={th}>CPC</th><th className={th}>CTR</th><th className={th}>Pedidos ads</th><th className={th}>CPA</th>
          </tr></thead><tbody>
            {canaisVis.map(c => { const a = porCanal.get(c) ?? novo(); return (
              <tr key={c} style={{ borderBottom: `1px solid ${B.bg}` }}>
                <td className="px-2 py-2 text-[12px] font-medium" style={{ color: B.text }}><span className="inline-block w-2.5 h-2.5 rounded-sm mr-2" style={{ background: MP[c].color }} />{MP[c].label}{a.cost === 0 && c !== 'mercado_livre' && <span className="text-[11px] ml-2" style={{ color: B.muted }}>(sem upload no mês)</span>}</td>
                <td className={td} style={mono}>{R(a.cost)}</td><td className={td} style={mono}>{R(a.adSales)}</td>
                <td className={td} style={mono}>{X(div(a.adSales, a.cost))}</td><td className={td} style={mono}>{P(div(a.cost, a.adSales) !== null ? div(a.cost, a.adSales)! * 100 : null)}</td>
                <td className={td} style={mono}>{R(a.receita)}</td><td className={td} style={mono}>{P(div(a.cost, a.receita) !== null ? div(a.cost, a.receita)! * 100 : null)}</td>
                <td className={td} style={mono}>{Math.round(a.clicks).toLocaleString('pt-BR')}</td><td className={td} style={mono}>{a.clicks ? `R$ ${(a.cost / a.clicks).toFixed(2)}` : '—'}</td>
                <td className={td} style={mono}>{P(div(a.clicks, a.imp) !== null ? div(a.clicks, a.imp)! * 100 : null)}</td>
                <td className={td} style={mono}>{Math.round(a.orders)}</td><td className={td} style={mono}>{a.orders ? `R$ ${(a.cost / a.orders).toFixed(0)}` : '—'}</td>
              </tr>) })}
          </tbody></table>
        </div>

        <div className="bg-white rounded-2xl p-5 overflow-x-auto" style={{ border: `1px solid ${B.border}` }}>
          <div className="text-sm font-semibold mb-1" style={{ color: B.text }}>Ads por produto {canal ? `— ${MP[canal].label}` : '— todos os marketplaces'}</div>
          <div className="text-[12px] mb-3" style={{ color: B.muted }}>Investimento = o valor rateado nas vendas do produto (o mesmo que entra na margem). TACOS do produto = ads ÷ faturamento do produto.</div>
          <table className="w-full"><thead><tr style={{ color: B.muted, borderBottom: `1px solid ${B.border}` }}>
            <th className={`${th} text-left`}>Produto</th><th className={th}>Ads total</th>
            {!canal && CANAIS.map(c => <th key={c} className={th}>{MP[c].label}</th>)}
            <th className={th}>Vendas via ads</th><th className={th}>ROAS</th><th className={th}>Faturamento</th><th className={th}>TACOS</th><th className={th}>Margem após ads</th>
          </tr></thead><tbody>
            {prods.map(([id, a]) => { const p = prodById.get(id); return (
              <tr key={id} style={{ borderBottom: `1px solid ${B.bg}` }}>
                <td className="px-2 py-2"><div className="text-[12px] font-medium" style={{ color: B.text }}>{p?.sku ?? id}</div><div className="text-[11px] truncate max-w-[240px]" style={{ color: B.muted }}>{p?.name}</div></td>
                <td className={td} style={mono}>{R(a.adsTot)}</td>
                {!canal && CANAIS.map(c => <td key={c} className={td} style={{ ...mono, color: a.ads[c] ? B.text : B.muted }}>{a.ads[c] ? R(a.ads[c]) : '—'}</td>)}
                <td className={td} style={mono}>{R(a.adSales)}</td><td className={td} style={mono}>{X(div(a.adSales, a.adsTot))}</td>
                <td className={td} style={mono}>{R(a.receita)}</td><td className={td} style={mono}>{P(div(a.adsTot, a.receita) !== null ? div(a.adsTot, a.receita)! * 100 : null)}</td>
                <td className={td} style={mono}>{P(div(a.mv, a.base) !== null ? div(a.mv, a.base)! * 100 : null)}</td>
              </tr>) })}
            {!prods.length && <tr><td colSpan={12} className="px-2 py-6 text-center text-[13px]" style={{ color: B.muted }}>Sem investimento em ads neste mês/canal.</td></tr>}
          </tbody></table>
        </div>

        <div className="bg-white rounded-2xl p-5 overflow-x-auto" style={{ border: `1px solid ${B.border}` }}>
          <div className="text-sm font-semibold mb-3" style={{ color: B.text }}>Por campanha / anúncio</div>
          <table className="w-full"><thead><tr style={{ color: B.muted, borderBottom: `1px solid ${B.border}` }}>
            <th className={`${th} text-left`}>Campanha</th><th className={th}>Investimento</th><th className={th}>Vendas via ads</th><th className={th}>ROAS</th><th className={th}>ACOS</th><th className={th}>Cliques</th><th className={th}>CPC</th><th className={th}>CTR</th><th className={th}>Pedidos</th>
          </tr></thead><tbody>
            {campanhas.map((c, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${B.bg}` }}>
                <td className="px-2 py-2 text-[12px] max-w-[380px] truncate" style={{ color: B.text }} title={c.nome}><span className="inline-block w-2 h-2 rounded-sm mr-2" style={{ background: MP[c.mp].color }} />{c.nome}</td>
                <td className={td} style={mono}>{R(c.cost)}</td><td className={td} style={mono}>{R(c.adSales)}</td>
                <td className={td} style={mono}>{X(div(c.adSales, c.cost))}</td><td className={td} style={mono}>{P(div(c.cost, c.adSales) !== null ? div(c.cost, c.adSales)! * 100 : null)}</td>
                <td className={td} style={mono}>{Math.round(c.clicks).toLocaleString('pt-BR')}</td><td className={td} style={mono}>{c.clicks ? `R$ ${(c.cost / c.clicks).toFixed(2)}` : '—'}</td>
                <td className={td} style={mono}>{P(div(c.clicks, c.imp) !== null ? div(c.clicks, c.imp)! * 100 : null)}</td><td className={td} style={mono}>{Math.round(c.orders)}</td>
              </tr>))}
          </tbody></table>
        </div>

        <AdsUpload produtos={(produtos ?? []).map(p => ({ sku: p.sku as string, name: p.name as string }))} pendentes={[...pend.values()]} />
      </div>
    </>
  )
}
