/**
 * POST /api/import-orders/filial-credits
 *
 * Transferência matriz/filial: os créditos de PIS/COFINS (e ICMS, se houver)
 * ficam na NF de ENTRADA da filial, não na NF de transferência. Esta rota
 * aplica esses créditos aos itens do lote de transferência:
 *
 *  - body {order_id, xml}: lê o XML da NF de entrada da filial, extrai os
 *    créditos POR ITEM e casa com os itens da transferência (EAN → produto,
 *    ou código do produto). Caminho principal — zero digitação.
 *  - body {order_id, pis_total, cofins_total, icms_total?}: fallback manual —
 *    rateia os totais entre os itens proporcionalmente ao valor.
 *
 * Depois grava unit_pis_imp/unit_cofins_imp/unit_icms_gnre nos import_items e
 * recalcula o landed cost — o crédito abate no CUSTO (convenção nacional),
 * então NÃO é devolvido de novo na margem (sem dupla contagem).
 * O chamador deve rodar /api/landed-cost/relink em seguida para as margens.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { parseNFeXml } from '@/lib/nfe/parser'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const orderId = String(body.order_id ?? '')
  if (!orderId) return NextResponse.json({ error: 'order_id é obrigatório' }, { status: 400 })

  const db = createSupabaseServiceClient()
  const { data: items } = await db.from('import_items')
    .select('id, sku, product_id, quantity, total_fob_value')
    .eq('import_order_id', orderId)
  if (!items?.length) return NextResponse.json({ error: 'NF sem itens' }, { status: 404 })

  let updated = 0
  const naoCasados: string[] = []

  if (typeof body.xml === 'string' && body.xml.length > 100) {
    // ── Caminho principal: XML da NF de entrada da filial ──
    let parsed
    try { parsed = parseNFeXml(body.xml) }
    catch (e) { return NextResponse.json({ error: `XML inválido: ${String(e).slice(0, 80)}` }, { status: 400 }) }

    // Créditos por produto (EAN → products.sku) e por código (cProd)
    const eans = parsed.items.map(i => i.cEAN).filter(e => e && e !== 'SEM GTIN')
    const { data: prods } = eans.length
      ? await db.from('products').select('id, sku').in('sku', eans)
      : { data: [] as Array<{ id: string; sku: string }> }
    const productByEan = new Map((prods ?? []).map(p => [p.sku, p.id]))

    const byProduct = new Map<string, { pis: number; cofins: number; icms: number }>()
    const byCode    = new Map<string, { pis: number; cofins: number; icms: number }>()
    for (const it of parsed.items) {
      const c = { pis: it.unitPisImp, cofins: it.unitCofinsImp, icms: it.unitIcmsGnre }
      const pid = productByEan.get(it.cEAN)
      if (pid) byProduct.set(pid, c)
      if (it.cProd) byCode.set(it.cProd, c)
    }

    for (const item of items) {
      const c = (item.product_id && byProduct.get(item.product_id)) || byCode.get(item.sku)
      if (!c) {
        // itens auxiliares (caixas etc.) sem crédito não são erro
        if (item.product_id) naoCasados.push(item.sku)
        continue
      }
      await db.from('import_items').update({
        unit_pis_imp:    c.pis,
        unit_cofins_imp: c.cofins,
        unit_icms_gnre:  c.icms,
      }).eq('id', item.id)
      updated++
    }
    if (updated === 0) {
      return NextResponse.json({
        error: 'Nenhum item da NF da filial casou com os itens da transferência (confira EAN/códigos)',
        nao_casados: naoCasados,
      }, { status: 422 })
    }
  } else {
    // ── Fallback manual: totais rateados por valor ──
    const pisTotal    = Number(body.pis_total ?? 0)
    const cofinsTotal = Number(body.cofins_total ?? 0)
    const icmsTotal   = Number(body.icms_total ?? 0)
    if (pisTotal <= 0 && cofinsTotal <= 0 && icmsTotal <= 0) {
      return NextResponse.json({ error: 'Envie o XML ou informe os totais de PIS/COFINS' }, { status: 400 })
    }
    const somaValor = items.reduce((s, i) => s + Number(i.total_fob_value ?? 0), 0) || 1
    for (const item of items) {
      if (!item.product_id) continue  // itens auxiliares ficam de fora
      const share = Number(item.total_fob_value ?? 0) / somaValor
      const qty   = Number(item.quantity) || 1
      await db.from('import_items').update({
        unit_pis_imp:    Math.round(pisTotal    * share / qty * 10000) / 10000,
        unit_cofins_imp: Math.round(cofinsTotal * share / qty * 10000) / 10000,
        unit_icms_gnre:  Math.round(icmsTotal   * share / qty * 10000) / 10000,
      }).eq('id', item.id)
      updated++
    }
  }

  // Recalcula o landed cost do lote (custo cai; vigências regravadas)
  await recalculateLandedCost(orderId)

  return NextResponse.json({ ok: true, itens_atualizados: updated, nao_casados: naoCasados })
}
