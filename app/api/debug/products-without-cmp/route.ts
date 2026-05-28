/**
 * GET /api/debug/products-without-cmp
 * Lista todos os produtos com vendas mas sem CMP, e tenta sugerir
 * o produto correto (com CMP) baseado em similaridade de nome.
 *
 * Retorna:
 *   - products_without_cmp: lista com sugestão de match (se encontrada)
 *   - products_with_cmp: lista de todos os produtos que têm CMP
 *   - summary: totais
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'gru1'

// Normaliza string para comparação: minúsculas, remove pontuação, split em palavras
function words(str: string): Set<string> {
  return new Set(
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2) // ignora palavras curtas (de, em, -)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const w of a) { if (b.has(w)) intersection++ }
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : intersection / union
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // Produtos com CMP (com o valor mais recente)
  const { data: cmps } = await db
    .from('cmp_costs')
    .select('product_id, cmp_value, effective_date')
    .order('effective_date', { ascending: false })

  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))

  // Último CMP por produto
  const cmpByProduct: Record<string, { cmp_value: number; effective_date: string }> = {}
  for (const c of (cmps ?? []) as { product_id: string; cmp_value: number; effective_date: string }[]) {
    if (!cmpByProduct[c.product_id]) {
      cmpByProduct[c.product_id] = { cmp_value: c.cmp_value, effective_date: c.effective_date }
    }
  }

  // Todos os produtos
  const { data: products } = await db
    .from('products')
    .select('id, sku, name')

  const prodById: Record<string, { id: string; sku: string; name: string }> = {}
  for (const p of (products ?? []) as { id: string; sku: string; name: string }[]) {
    prodById[p.id] = p
  }

  // Vendas agrupadas por product_id (paginação para contornar limite 1000)
  const PAGE = 1000
  const allSales: { product_id: string; sku: string; marketplace: string }[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('sales')
      .select('product_id, sku, marketplace')
      .not('product_id', 'is', null)
      .range(offset, offset + PAGE - 1)
    if (error || !data?.length) break
    allSales.push(...data)
    if (data.length < PAGE) break
  }

  // Agrupa por product_id
  const salesByProduct: Record<string, { count: number; skus: Set<string>; marketplaces: Set<string> }> = {}
  for (const s of allSales) {
    if (!s.product_id) continue
    if (!salesByProduct[s.product_id]) {
      salesByProduct[s.product_id] = { count: 0, skus: new Set(), marketplaces: new Set() }
    }
    salesByProduct[s.product_id].count++
    salesByProduct[s.product_id].skus.add(s.sku ?? '')
    salesByProduct[s.product_id].marketplaces.add(s.marketplace ?? '')
  }

  // Produtos COM CMP para referência
  const productsWithCmp = Object.entries(cmpByProduct)
    .map(([productId, cmp]) => {
      const p = prodById[productId]
      return {
        product_id: productId,
        sku: p?.sku ?? '???',
        name: p?.name ?? '???',
        cmp_value: cmp.cmp_value,
        effective_date: cmp.effective_date,
        sales_count: salesByProduct[productId]?.count ?? 0,
      }
    })
    .sort((a, b) => a.sku.localeCompare(b.sku))

  // Produtos SEM CMP — tenta sugerir match por similaridade de nome
  const productsWithoutCmp = Object.entries(salesByProduct)
    .filter(([productId]) => !prodWithCmp.has(productId))
    .map(([productId, info]) => {
      const p = prodById[productId]
      const nameWords = words(p?.name ?? '')

      // Encontra o melhor match entre produtos com CMP
      let bestMatch: typeof productsWithCmp[0] | null = null
      let bestScore = 0

      for (const candidate of productsWithCmp) {
        const score = jaccardSimilarity(nameWords, words(candidate.name))
        if (score > bestScore) {
          bestScore = score
          bestMatch = candidate
        }
      }

      return {
        product_id: productId,
        sku: p?.sku ?? '???',
        name: p?.name ?? '???',
        sales_count: info.count,
        marketplaces: Array.from(info.marketplaces).filter(Boolean),
        // Sugestão de match (se score razoável)
        suggested_match: bestScore >= 0.30 ? {
          product_id: bestMatch!.product_id,
          sku: bestMatch!.sku,
          name: bestMatch!.name,
          cmp_value: bestMatch!.cmp_value,
          similarity_score: Math.round(bestScore * 100),
          confidence: bestScore >= 0.60 ? 'alta' : bestScore >= 0.40 ? 'média' : 'baixa',
        } : null,
      }
    })
    .sort((a, b) => b.sales_count - a.sales_count)

  return NextResponse.json({
    summary: {
      total_products_with_sales: Object.keys(salesByProduct).length,
      products_with_cmp: prodWithCmp.size,
      products_WITHOUT_cmp: productsWithoutCmp.length,
      with_suggestion: productsWithoutCmp.filter(p => p.suggested_match).length,
    },
    products_without_cmp: productsWithoutCmp,
    products_with_cmp: productsWithCmp,
  })
}
