/**
 * POST /api/sales/{id}/reverify
 *
 * Reverifica UMA venda direto nas fontes (botão "Reverificar venda"):
 *   pedido ML (cupom da loja) → NF-e via ML (impostos, EAN) →
 *   extrato por pedido (comissão/tarifas/estorno) → frete (/shipments/costs) →
 *   recálculo do custo e margem.
 * Para conferências pontuais quando algum número parecer estranho.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { applyCmpToSale } from '@/lib/landed-cost/calculator'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

function taxesFromRules(rules: Array<{ name?: string; attributes?: Record<string, unknown> | null }>) {
  const num = (a: Record<string, unknown> | null | undefined, k: string) => Number((a as any)?.[k] ?? 0)
  let pis = 0, cofins = 0, icms = 0, difal = 0, ipi = 0
  for (const r of rules) {
    const a = r.attributes
    switch (r.name) {
      case 'PIS':    pis    += num(a, 'vpis');    break
      case 'COFINS': cofins += num(a, 'vcofins'); break
      case 'ICMS':
        icms  += num(a, 'vicms')
        difal += num(a, 'vicmsufdest') + num(a, 'vicmsufremet') + num(a, 'vfcpufdest')
        break
      case 'IPI':    ipi    += num(a, 'vipi');    break
    }
  }
  return { pis, cofins, icms, difal, ipi }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const db = createSupabaseServiceClient()

  const { data: sale } = await db.from('sales')
    .select('id, external_order_id, marketplace, gross_price, product_id')
    .eq('id', id).single()
  if (!sale) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })
  if (sale.marketplace !== 'mercado_livre') {
    return NextResponse.json({ error: 'Reverificação disponível apenas para Mercado Livre por enquanto' }, { status: 400 })
  }
  const m = sale.external_order_id?.match(/^ml_(\d+)_(\S+)$/)
  if (!m) return NextResponse.json({ error: 'Pedido não identificado' }, { status: 400 })
  const [, orderId, mlb] = m
  const uid = await getMercadoLivreSellerId()
  const passos: Record<string, unknown> = {}

  // 1. Pedido: cupom da loja (ML-funded não desconta)
  try {
    const order = await mlGet<any>(`/orders/${orderId}`)
    const cupomLoja = Number(order.coupon?.amount ?? 0)
    await db.from('sales').update({ discounts: cupomLoja }).eq('id', id)
    passos.cupom_loja = cupomLoja
  } catch (e) { passos.pedido = `erro: ${String(e).slice(0, 80)}` }

  // 2. NF-e via ML: impostos reais + vínculo de produto por EAN
  try {
    const inv = await mlGet<any>(`/users/${uid}/invoices/orders/${orderId}`)
    const chave = inv?.attributes?.invoice_key
    if (inv?.status === 'authorized' && chave) {
      const item = (inv.items ?? []).find((i: any) => i.external_product_id === mlb) ?? inv.items?.[0]
      const t = taxesFromRules(item?.fiscal_data?.rules ?? [])
      const updates: Record<string, unknown> = { nfe_saida_key: chave }
      if (!sale.product_id) {
        const ean = String(item?.attributes?.ean ?? '')
        const { data: prod } = await db.from('products').select('id').eq('sku', ean).maybeSingle()
        if (prod) updates.product_id = prod.id
      }
      await db.from('sales').update(updates).eq('id', id)
      await db.from('sale_taxes').delete().eq('sale_id', id)
      await db.from('sale_taxes').insert({
        sale_id: id, nfe_key: chave,
        pis: t.pis, cofins: t.cofins, icms: t.icms, icms_difal: t.difal, ipi: t.ipi,
      })
      passos.nota_ml = { chave: chave.slice(-10), impostos: t }
    } else {
      passos.nota_ml = 'não emitida via ML (galpão = Bling)'
    }
  } catch { passos.nota_ml = 'não encontrada via ML' }

  // 3. Extrato por pedido: comissão bruta, tarifas, estorno
  try {
    const res = await mlGet<any>(`/billing/integration/group/ML/order/details?order_ids=${orderId}&limit=150`)
    const r = (res.results ?? [])[0]
    if (r) {
      let commission = 0, shipping = 0, fixed = 0, rebate = 0
      for (const d of r.details ?? []) {
        const ci = d.charge_info ?? {}
        const st = ci.detail_sub_type ?? ''
        const amt = Number(ci.detail_amount ?? 0)
        if (ci.detail_type === 'CHARGE') {
          if (st === 'CFONPN' || st === 'CDIFAL' || st === 'PADS') continue
          if (st.startsWith('CV')) commission += amt
          else if (st.startsWith('CXD') || st.startsWith('CFF')) shipping += amt
          else fixed += amt
        } else if (ci.detail_type === 'BONUS' && st !== 'BFONPN') rebate += amt
      }
      const promo = Number(r.sale_fee?.rebate ?? 0)
      commission += promo; rebate += promo
      const fields: Record<string, unknown> = {
        marketplace_commission: Math.round(commission * 100) / 100,
        marketplace_fixed_fee:  Math.round(fixed * 100) / 100,
        rebate:                 Math.round(rebate * 100) / 100,
      }
      if (shipping > 0) fields.marketplace_shipping_fee = Math.round(shipping * 100) / 100
      await db.from('sales').update(fields).eq('id', id)
      passos.extrato = fields
    } else passos.extrato = 'sem lançamentos ainda'
  } catch (e) { passos.extrato = `erro: ${String(e).slice(0, 80)}` }

  // 4. Frete via shipments/costs (se o extrato não trouxe)
  try {
    const { data: cur } = await db.from('sales').select('marketplace_shipping_fee').eq('id', id).single()
    if (Number(cur?.marketplace_shipping_fee ?? 0) === 0) {
      const order = await mlGet<any>(`/orders/${orderId}`)
      if (order.shipping?.id) {
        const costs = await mlGet<any>(`/shipments/${order.shipping.id}/costs`)
        const frete = (costs?.senders ?? []).reduce((s: number, x: any) => s + Number(x.cost ?? 0), 0)
        if (frete > 0) {
          await db.from('sales').update({ marketplace_shipping_fee: frete }).eq('id', id)
          passos.frete = frete
        }
      }
    }
  } catch { /* opcional */ }

  // 5. Custo e margem
  await applyCmpToSale(id)
  passos.margem = 'recalculada'

  return NextResponse.json({ ok: true, passos })
}
