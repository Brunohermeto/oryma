/**
 * Anúncio → SKUs do NOSSO cadastro (vínculo SÓ por SKU, regra 4b do AGENTS.md).
 *  - Shopee: ID do produto → item_sku / model_sku (API get_item_base_info/get_model_list)
 *  - Amazon: ASIN → sellerSku (estoque FBA) → SKU; campanha sem ASIN → vínculo manual
 *    salvo em ads_campaign_products
 *  - ML: MLB → produto das vendas daquele anúncio
 */
import { shopeeGet } from '@/lib/integrations/shopee'
import { amazonGet } from '@/lib/integrations/amazon'
import { SKU_ALIASES } from '@/lib/sales/sku-aliases'
import type { createSupabaseServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createSupabaseServiceClient>

/** índice SKU (normalizado) → SKU do cadastro, com as mesmas regras das vendas */
export async function indiceSkus(db: Db) {
  const { data } = await db.from('products').select('id, sku').range(0, 4999)
  const bySku = new Map((data ?? []).map(p => [String(p.sku).toUpperCase(), { id: p.id as string, sku: p.sku as string }]))
  const resolve = (raw: string) => {
    const s = raw.replace(/[\s ]+/g, '').toUpperCase().replace(/[-_]FBA$/, '')
    return bySku.get(s) ?? bySku.get(s.replace(/^V/, '')) ?? bySku.get(s.replace(/V$/, '')) ?? bySku.get(SKU_ALIASES[s] ?? '')
  }
  return { resolve, idPorSku: new Map([...bySku.values()].map(p => [p.sku, p.id])) }
}

export async function skusShopee(db: Db, itemIds: string[]): Promise<Map<string, string[]>> {
  const { resolve } = await indiceSkus(db)
  const out = new Map<string, string[]>()
  for (let i = 0; i < itemIds.length; i += 50) {
    const lote = itemIds.slice(i, i + 50)
    const base = await shopeeGet<{ response?: { item_list?: Array<{ item_id: number; item_sku?: string; has_model?: boolean }> } }>(
      '/product/get_item_base_info', { item_id_list: lote.join(',') })
    for (const it of base.response?.item_list ?? []) {
      const brutos: string[] = []
      if (it.has_model) {
        const m = await shopeeGet<{ response?: { model?: Array<{ model_sku?: string }> } }>('/product/get_model_list', { item_id: String(it.item_id) })
        for (const x of m.response?.model ?? []) if (x.model_sku) brutos.push(x.model_sku)
      }
      if (it.item_sku) brutos.push(it.item_sku)
      const skus = [...new Set(brutos.map(b => resolve(b)?.sku).filter(Boolean) as string[])]
      out.set(String(it.item_id), skus)
    }
  }
  return out
}

export async function skusAmazonPorAsin(db: Db): Promise<Map<string, string[]>> {
  const { resolve } = await indiceSkus(db)
  const out = new Map<string, Set<string>>()
  let next: string | undefined
  do {
    const r = await amazonGet<{ payload?: { inventorySummaries?: Array<{ asin?: string; sellerSku?: string }> }; pagination?: { nextToken?: string } }>(
      '/fba/inventory/v1/summaries', { granularityType: 'Marketplace', granularityId: 'A2Q3Y263D00KWC', marketplaceIds: 'A2Q3Y263D00KWC', ...(next ? { nextToken: next } : {}) })
    for (const s of r.payload?.inventorySummaries ?? []) {
      const p = s.sellerSku ? resolve(s.sellerSku) : undefined
      if (s.asin && p) { if (!out.has(s.asin)) out.set(s.asin, new Set()); out.get(s.asin)!.add(p.sku) }
    }
    next = r.pagination?.nextToken
  } while (next)
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

/** MLB → SKUs, a partir das vendas já vinculadas daquele anúncio */
export async function skusMlPorAnuncio(db: Db): Promise<Map<string, string[]>> {
  const out = new Map<string, Set<string>>()
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('sales').select('external_order_id, products(sku)')
      .eq('marketplace', 'mercado_livre').not('product_id', 'is', null).order('id').range(off, off + 999)
    for (const s of (data ?? []) as Array<{ external_order_id: string; products: { sku: string } | { sku: string }[] | null }>) {
      const mlb = s.external_order_id.split('_')[2]
      const p = Array.isArray(s.products) ? s.products[0] : s.products
      if (mlb && p?.sku) { if (!out.has(mlb)) out.set(mlb, new Set()); out.get(mlb)!.add(p.sku) }
    }
    if ((data ?? []).length < 1000) break
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}
