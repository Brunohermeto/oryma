/**
 * GET /api/debug/products-without-cmp
 *
 * Lista todos os produtos com vendas mas sem CMP, e sugere o match correto usando:
 *
 *  1. Mapeamento manual (MOVEDUO → 7908488105732, etc.)
 *  2. Strip de sufixo de cor/variante: RAGA003-C → RAGA003, RAGA002-CINZA → RAGA002
 *  3. Similaridade de nome (fallback Jaccard)
 *
 * Não depende de EAN no Bling — funciona 100% com os dados locais.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'gru1'

// ─── Mapeamentos manuais conhecidos (ML SKU → SKU com CMP) ────────────────────
const MANUAL_MAP: Record<string, string> = {
  'MOVEDUO':            '7908488105732',
  '7908488105732-DUO':  '7908488105732',
}

// Sufixos de cor/variante comuns que aparecem depois de "-"
const COLOR_SUFFIXES = new Set([
  'C', 'R', 'A', 'B', 'P', 'G',
  'PT', 'CZ', 'BG', 'VD', 'AZ', 'RS',
  'PRETO', 'CINZA', 'BEGE', 'VERMELHO', 'AZUL', 'ROSA', 'VERDE',
  'BLACK', 'GREY', 'GRAY', 'WHITE', 'BRANCO',
  'DUO', 'PLUS', 'MAX',
])

// Tenta encontrar o SKU base removendo sufixo após o último "-"
function stripColorSuffix(sku: string): string | null {
  const idx = sku.lastIndexOf('-')
  if (idx <= 0) return null
  const suffix = sku.slice(idx + 1).toUpperCase()
  if (COLOR_SUFFIXES.has(suffix)) return sku.slice(0, idx)
  return null
}

// Normaliza para comparação por nome
function words(str: string): Set<string> {
  return new Set(
    str.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / new Set([...a, ...b]).size
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // ── Produtos locais ──────────────────────────────────────────────────────────
  const { data: products } = await db.from('products').select('id, sku, name')

  const prodById:  Record<string, { id: string; sku: string; name: string }> = {}
  const prodBySku: Record<string, { id: string; sku: string; name: string }> = {}
  for (const p of (products ?? []) as { id: string; sku: string; name: string }[]) {
    prodById[p.id]  = p
    prodBySku[p.sku] = p
  }

  // ── CMPs ─────────────────────────────────────────────────────────────────────
  const { data: cmps } = await db
    .from('cmp_costs')
    .select('product_id, cmp_value, effective_date')
    .order('effective_date', { ascending: false })

  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))
  const cmpByProduct: Record<string, { cmp_value: number; effective_date: string }> = {}
  for (const c of (cmps ?? []) as { product_id: string; cmp_value: number; effective_date: string }[]) {
    if (!cmpByProduct[c.product_id]) cmpByProduct[c.product_id] = { cmp_value: c.cmp_value, effective_date: c.effective_date }
  }

  // ── Vendas por product_id (paginado) ──────────────────────────────────────────
  const PAGE = 1000
  const allSales: { product_id: string; sku: string; marketplace: string }[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('sales').select('product_id, sku, marketplace')
      .not('product_id', 'is', null)
      .range(offset, offset + PAGE - 1)
    if (error || !data?.length) break
    allSales.push(...data)
    if (data.length < PAGE) break
  }

  const salesByProduct: Record<string, { count: number; marketplaces: Set<string> }> = {}
  for (const s of allSales) {
    if (!s.product_id) continue
    if (!salesByProduct[s.product_id]) salesByProduct[s.product_id] = { count: 0, marketplaces: new Set() }
    salesByProduct[s.product_id].count++
    salesByProduct[s.product_id].marketplaces.add(s.marketplace ?? '')
  }

  // Produtos COM CMP (para usar como candidatos de match)
  const candidatesWithCmp = Object.entries(cmpByProduct).map(([pid, cmp]) => ({
    product_id: pid,
    sku: prodById[pid]?.sku ?? '',
    name: prodById[pid]?.name ?? '',
    cmp_value: cmp.cmp_value,
    effective_date: cmp.effective_date,
  }))

  // ── Resolve match para cada produto sem CMP ────────────────────────────────────
  const productsWithoutCmp = Object.entries(salesByProduct)
    .filter(([pid]) => !prodWithCmp.has(pid))
    .map(([pid, info]) => {
      const local = prodById[pid]
      const mlSku = local?.sku ?? ''

      let match: typeof candidatesWithCmp[0] | null = null
      let matchSource = ''

      // Estratégia 1: mapeamento manual
      const manualTargetSku = MANUAL_MAP[mlSku]
      if (manualTargetSku) {
        const targetProd = prodBySku[manualTargetSku]
        if (targetProd && prodWithCmp.has(targetProd.id)) {
          match = candidatesWithCmp.find(c => c.product_id === targetProd.id) ?? null
          matchSource = 'manual'
        }
      }

      // Estratégia 2: strip sufixo de cor (ex: RAGA003-C → RAGA003)
      let baseSkuDiag: string | null = null
      let baseSkuStatus: 'not_in_db' | 'no_cmp' | 'ok' | null = null
      if (!match) {
        const baseSku = stripColorSuffix(mlSku)
        if (baseSku) {
          baseSkuDiag = baseSku
          const baseProd = prodBySku[baseSku]
          if (!baseProd) {
            baseSkuStatus = 'not_in_db'  // produto base não existe → NF-e nunca importada
          } else if (!prodWithCmp.has(baseProd.id)) {
            baseSkuStatus = 'no_cmp'     // produto base existe mas sem CMP → NF-e não processou custo
          } else {
            baseSkuStatus = 'ok'
            match = candidatesWithCmp.find(c => c.product_id === baseProd.id) ?? null
            matchSource = 'suffix_strip'
          }
        }
      }

      // Estratégia 3: similaridade de nome (fallback)
      if (!match) {
        const nameW = words(local?.name ?? '')
        let best = 0
        for (const c of candidatesWithCmp) {
          const score = jaccardSimilarity(nameW, words(c.name))
          if (score > best) { best = score; if (score >= 0.35) match = c }
        }
        if (match) matchSource = `name_similarity_${Math.round(best * 100)}pct`
      }

      return {
        product_id: pid,
        sku: mlSku,
        name: local?.name ?? '???',
        sales_count: info.count,
        marketplaces: Array.from(info.marketplaces).filter(Boolean),
        // Diagnóstico do motivo quando não há match
        no_match_reason: !match ? (
          baseSkuStatus === 'not_in_db' ? `Produto base "${baseSkuDiag}" não existe na base — NF-e de entrada não importada` :
          baseSkuStatus === 'no_cmp'    ? `Produto base "${baseSkuDiag}" existe mas sem CMP — verificar NF-e` :
          MANUAL_MAP[mlSku]             ? `Mapeamento manual aponta para "${MANUAL_MAP[mlSku]}" mas esse produto não tem CMP` :
          'Nenhum match encontrado'
        ) : null,
        suggested_match: match ? {
          product_id: match.product_id,
          sku: match.sku,
          name: match.name,
          cmp_value: match.cmp_value,
          effective_date: match.effective_date,
          source: matchSource,
        } : null,
      }
    })
    .sort((a, b) => b.sales_count - a.sales_count)

  const withMatch   = productsWithoutCmp.filter(p => p.suggested_match).length
  const withNothing = productsWithoutCmp.filter(p => !p.suggested_match).length

  return NextResponse.json({
    summary: {
      total_products_with_sales: Object.keys(salesByProduct).length,
      products_with_cmp: prodWithCmp.size,
      products_WITHOUT_cmp: productsWithoutCmp.length,
      resolved: withMatch,
      no_match_found: withNothing,
    },
    products_without_cmp: productsWithoutCmp,
    products_with_cmp: candidatesWithCmp.sort((a, b) => a.sku.localeCompare(b.sku)),
  })
}
