/**
 * GET /api/debug/products-without-cmp
 *
 * 1. Busca o catálogo completo de produtos no Bling (código + gtin/EAN)
 * 2. Cruza com os produtos locais que têm vendas mas sem CMP
 * 3. Para cada um, tenta encontrar o produto correto via:
 *    a) código Bling == SKU do ML  →  retorna o EAN (gtin) do produto Bling
 *    b) Se o EAN estiver cadastrado localmente como produto com CMP, faz o link
 *
 * Retorna a lista completa pronta para o usuário confirmar e aplicar.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { blingGet } from '@/lib/integrations/bling'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

interface BlingProduct {
  id: number
  nome: string
  codigo: string        // SKU / código interno
  gtin?: string         // EAN 13
  codigoFabricante?: string
}

interface BlingProductsResponse {
  data: BlingProduct[]
}

// Busca todos os produtos do Bling paginando (100 por página)
async function fetchAllBlingProducts(): Promise<BlingProduct[]> {
  const all: BlingProduct[] = []
  let page = 1
  const limit = 100

  while (true) {
    const res = await blingGet<BlingProductsResponse>('/produtos', {
      pagina: String(page),
      limite: String(limit),
    })
    const items = res?.data ?? []
    all.push(...items)
    if (items.length < limit) break
    page++
    if (page > 50) break // segurança: máximo 5000 produtos
  }

  return all
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // ── 1. Produtos locais e CMPs ──────────────────────────────────────────────
  const { data: products } = await db
    .from('products')
    .select('id, sku, name')

  const { data: cmps } = await db
    .from('cmp_costs')
    .select('product_id, cmp_value, effective_date')
    .order('effective_date', { ascending: false })

  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))

  const cmpByProduct: Record<string, { cmp_value: number; effective_date: string }> = {}
  for (const c of (cmps ?? []) as { product_id: string; cmp_value: number; effective_date: string }[]) {
    if (!cmpByProduct[c.product_id]) {
      cmpByProduct[c.product_id] = { cmp_value: c.cmp_value, effective_date: c.effective_date }
    }
  }

  const prodById: Record<string, { id: string; sku: string; name: string }> = {}
  const prodBySku: Record<string, { id: string; sku: string; name: string }> = {}
  for (const p of (products ?? []) as { id: string; sku: string; name: string }[]) {
    prodById[p.id] = p
    prodBySku[p.sku] = p
  }

  // ── 2. Vendas por product_id (paginado) ────────────────────────────────────
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

  // ── 3. Catálogo Bling ──────────────────────────────────────────────────────
  let blingProducts: BlingProduct[] = []
  let blingError: string | null = null
  try {
    blingProducts = await fetchAllBlingProducts()
  } catch (e) {
    blingError = String(e)
  }

  // Index Bling por código (SKU) e por GTIN (EAN)
  const blingByCodigo: Record<string, BlingProduct> = {}
  const blingByGtin: Record<string, BlingProduct> = {}
  for (const bp of blingProducts) {
    if (bp.codigo) blingByCodigo[bp.codigo.trim()] = bp
    if (bp.gtin)   blingByGtin[bp.gtin.trim()] = bp
  }

  // ── 4. Produtos SEM CMP — tenta resolver via Bling ────────────────────────
  const productsWithoutCmp = Object.entries(salesByProduct)
    .filter(([productId]) => !prodWithCmp.has(productId))
    .map(([productId, info]) => {
      const localProd = prodById[productId]
      const mlSku = localProd?.sku ?? ''

      // Estratégia A: código Bling == SKU do ML → pega o GTIN/EAN
      const blingMatch = blingByCodigo[mlSku]
      const ean = blingMatch?.gtin?.trim() ?? blingMatch?.codigoFabricante?.trim() ?? null

      // Estratégia B: o EAN está cadastrado como produto local com CMP?
      const localEanProd = ean ? prodBySku[ean] : null
      const hasCmp = localEanProd ? prodWithCmp.has(localEanProd.id) : false
      const cmpInfo = localEanProd ? cmpByProduct[localEanProd.id] : null

      return {
        product_id: productId,
        sku: mlSku,
        name: localProd?.name ?? '???',
        sales_count: info.count,
        marketplaces: Array.from(info.marketplaces).filter(Boolean),
        // Dados do Bling para este SKU
        bling: blingMatch ? {
          codigo: blingMatch.codigo,
          nome: blingMatch.nome,
          gtin: ean,
        } : null,
        // Match no banco local via EAN
        suggested_match: (hasCmp && localEanProd && cmpInfo) ? {
          product_id: localEanProd.id,
          sku: localEanProd.sku,
          name: localEanProd.name,
          cmp_value: cmpInfo.cmp_value,
          effective_date: cmpInfo.effective_date,
          source: 'bling_catalog', // match via catálogo Bling
        } : null,
        // Flag se o EAN foi encontrado no Bling mas não está no banco local
        ean_found_in_bling_but_no_local_product: (ean && !localEanProd) ? ean : null,
        ean_found_but_no_cmp: (ean && localEanProd && !hasCmp) ? ean : null,
      }
    })
    .sort((a, b) => b.sales_count - a.sales_count)

  // ── 5. Resumo ──────────────────────────────────────────────────────────────
  const withMatch    = productsWithoutCmp.filter(p => p.suggested_match).length
  const withEanOnly  = productsWithoutCmp.filter(p => !p.suggested_match && p.bling?.gtin).length
  const withNothing  = productsWithoutCmp.filter(p => !p.bling).length

  return NextResponse.json({
    summary: {
      total_products_with_sales: Object.keys(salesByProduct).length,
      products_with_cmp: prodWithCmp.size,
      products_WITHOUT_cmp: productsWithoutCmp.length,
      resolved_via_bling: withMatch,
      ean_found_no_local_product: withEanOnly,
      not_found_in_bling: withNothing,
    },
    products_without_cmp: productsWithoutCmp,
    bling_catalog_size: blingProducts.length,
    bling_error: blingError,
  })
}
