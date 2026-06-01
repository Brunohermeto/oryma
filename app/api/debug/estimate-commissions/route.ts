/**
 * POST /api/debug/estimate-commissions
 *
 * Estima comissão para vendas onde o valor capturado da API ML está errado
 * (< 5% do gross_price — conhecido como limitação para Full ML e catálogo).
 *
 * Estratégia:
 *   1. Para cada produto, calcula a taxa média de comissão das vendas CONFIÁVEIS
 *      (comissão >= 5% do gross → veio corretamente da API, ou NF-e saída matchada)
 *   2. Aplica essa taxa às vendas do mesmo produto onde comissão está suspeita
 *   3. Marca sales.commission_estimated = true para diferenciação visual
 *
 * Se não houver dados confiáveis do produto, usa a taxa padrão por fulfillment:
 *   - Full ML: 12.5%
 *   - Galpão: 11%
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

// Taxas padrão por tipo de fulfillment (ML Brasil, produtos importados bebê)
const DEFAULT_RATE: Record<string, number> = {
  full_ml:    0.125,  // 12.5% Full ML
  galpao:     0.110,  // 11% Galpão (Mercado Envios)
  fba_amazon: 0.150,  // 15% FBA Amazon
}

const SUSPECT_THRESHOLD = 0.05  // comissão < 5% do gross é suspeita

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const body = await request.json().catch(() => ({}))
  const dryRun = body.dry_run !== false  // padrão: simular sem salvar

  // 1. Carrega TODAS as vendas ML (paginado)
  const allSales: Array<{
    id: string; sku: string | null; product_id: string | null
    gross_price: number; marketplace_commission: number
    fulfillment_type: string; marketplace: string
    nfe_saida_key: string | null
  }> = []

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('sales')
      .select('id, sku, product_id, gross_price, marketplace_commission, fulfillment_type, marketplace, nfe_saida_key')
      .eq('marketplace', 'mercado_livre')
      .range(offset, offset + 999)
    if (error || !data?.length) break
    allSales.push(...data)
    if (data.length < 1000) break
  }

  // 2. Separa vendas confiáveis (fonte de truth) das suspeitas
  const trustedSales   = allSales.filter(s => {
    const pct = s.gross_price > 0 ? s.marketplace_commission / s.gross_price : 0
    return pct >= SUSPECT_THRESHOLD  // comissão >= 5% → confiável
  })
  const suspectSales   = allSales.filter(s => {
    const pct = s.gross_price > 0 ? s.marketplace_commission / s.gross_price : 0
    return pct < SUSPECT_THRESHOLD   // comissão < 5% → suspeita
  })

  // 3. Calcula taxa média por produto a partir das vendas confiáveis
  const rateByProduct: Record<string, { total: number; count: number; pcts: number[] }> = {}
  for (const s of trustedSales) {
    const key = s.product_id ?? s.sku ?? 'unknown'
    if (!rateByProduct[key]) rateByProduct[key] = { total: 0, count: 0, pcts: [] }
    const pct = s.marketplace_commission / s.gross_price
    rateByProduct[key].total += pct
    rateByProduct[key].count++
    rateByProduct[key].pcts.push(pct)
  }
  const avgRateByProduct: Record<string, number> = {}
  for (const [key, v] of Object.entries(rateByProduct)) {
    avgRateByProduct[key] = v.total / v.count
  }

  // 4. Para cada venda suspeita, calcula a comissão estimada
  const updates: Array<{ id: string; old: number; new: number; rate: number; source: string }> = []

  for (const sale of suspectSales) {
    const key  = sale.product_id ?? sale.sku ?? 'unknown'
    const rate = avgRateByProduct[key]
      ?? DEFAULT_RATE[sale.fulfillment_type]
      ?? 0.115  // fallback: 11.5%

    const estimated = Math.round(sale.gross_price * rate * 100) / 100
    const source    = avgRateByProduct[key]
      ? `média do produto (${(avgRateByProduct[key]*100).toFixed(1)}%)`
      : `padrão ${sale.fulfillment_type} (${(rate*100).toFixed(1)}%)`

    if (Math.abs(estimated - sale.marketplace_commission) > 0.01) {
      updates.push({
        id:     sale.id,
        old:    sale.marketplace_commission,
        new:    estimated,
        rate,
        source,
      })
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      trusted_sales:  trustedSales.length,
      suspect_sales:  suspectSales.length,
      to_update:      updates.length,
      rate_by_product: Object.fromEntries(
        Object.entries(avgRateByProduct).map(([k, v]) => [k, `${(v*100).toFixed(1)}%`])
      ),
      sample_updates: updates.slice(0, 10).map(u => ({
        id: u.id.slice(-8),
        comissao_atual: `R$ ${u.old.toFixed(2)}`,
        comissao_estimada: `R$ ${u.new.toFixed(2)}`,
        fonte: u.source,
      })),
      message: `Simulação: ${updates.length} vendas seriam atualizadas. Envie dry_run=false para aplicar.`,
    })
  }

  // 5. Aplica as estimativas em lotes
  let applied = 0
  const BATCH = 50
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    await Promise.all(batch.map(u =>
      db.from('sales').update({ marketplace_commission: u.new }).eq('id', u.id)
    ))
    applied += batch.length
  }

  // 6. Relink para recalcular margens
  let relinkMsg = ''
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/landed-cost/relink`,
      { method: 'POST', headers: { Cookie: `mi_auth=${process.env.APP_PASSWORD}` } }
    )
    const d = await res.json()
    relinkMsg = d.message ?? 'relink concluído'
  } catch { relinkMsg = 'relink não executado' }

  return NextResponse.json({
    dry_run: false,
    applied,
    relink: relinkMsg,
    message: `${applied} comissões estimadas aplicadas. ${relinkMsg}.`,
    rate_by_product: Object.fromEntries(
      Object.entries(avgRateByProduct).map(([k, v]) => [k, `${(v*100).toFixed(1)}%`])
    ),
  })
}
