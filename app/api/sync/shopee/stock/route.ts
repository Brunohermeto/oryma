/**
 * POST /api/sync/shopee/stock
 *
 * Estoque no CD da Shopee (Full) → products.stock_shopee.
 * Varre anúncios ativos → modelos → soma o estoque em armazém Shopee
 * (stock_info_v2.shopee_stock) por SKU de variação (model_sku).
 */
import { NextRequest, NextResponse } from 'next/server'
import { shopeeGet } from '@/lib/integrations/shopee'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

interface ModelInfo {
  model_sku?: string
  stock_info_v2?: {
    shopee_stock?: Array<{ location_id?: string; stock?: number }>
  }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseServiceClient()

  // anúncios ativos
  const itemIds: number[] = []
  let offset = 0
  for (let page = 0; page < 20; page++) {
    const res = await shopeeGet<{ response?: { item: Array<{ item_id: number }>; has_next_page: boolean; next_offset: number } }>(
      '/product/get_item_list', { offset: String(offset), page_size: '100', item_status: 'NORMAL' }
    )
    itemIds.push(...(res.response?.item ?? []).map(i => i.item_id))
    if (!res.response?.has_next_page) break
    offset = res.response.next_offset
  }

  // estoque Shopee por model_sku (item base sem variação: get_item_base_info)
  const bySku = new Map<string, number>()
  const somaShopee = (m: ModelInfo) => (m.stock_info_v2?.shopee_stock ?? []).reduce((s, x) => s + Number(x.stock ?? 0), 0)
  for (let i = 0; i < itemIds.length; i += 50) {
    const base = await shopeeGet<{ response?: { item_list: Array<{ item_id: number; item_sku?: string; has_model?: boolean; stock_info_v2?: ModelInfo['stock_info_v2'] }> } }>(
      '/product/get_item_base_info', { item_id_list: itemIds.slice(i, i + 50).join(',') }
    )
    for (const it of base.response?.item_list ?? []) {
      if (it.has_model) {
        const models = await shopeeGet<{ response?: { model: ModelInfo[] } }>(
          '/product/get_model_list', { item_id: String(it.item_id) }
        )
        for (const m of models.response?.model ?? []) {
          const sku = (m.model_sku ?? '').trim()
          const qty = somaShopee(m)
          if (sku && qty > 0) bySku.set(sku, (bySku.get(sku) ?? 0) + qty)
        }
      } else {
        const sku = (it.item_sku ?? '').trim()
        const qty = somaShopee(it as ModelInfo)
        if (sku && qty > 0) bySku.set(sku, (bySku.get(sku) ?? 0) + qty)
      }
    }
  }

  // grava (resolve SKU com regras V-prefixo, como nas vendas)
  const { data: products } = await db.from('products').select('id, sku, stock_shopee').limit(3000)
  const pBySku = new Map((products ?? []).map(p => [String(p.sku).toUpperCase(), p]))
  const resolve = (raw: string) => {
    const s = raw.toUpperCase()
    return pBySku.get(s) ?? pBySku.get(s.replace(/^V/, '')) ?? pBySku.get(s.replace(/V$/, ''))
  }
  let updated = 0
  const semProduto: string[] = []
  const novos = new Map<string, number>()
  for (const [sku, qty] of bySku) {
    const p = resolve(sku)
    if (!p) { semProduto.push(`${sku}:${qty}`); continue }
    novos.set(p.id, (novos.get(p.id) ?? 0) + qty)
  }
  for (const [pid, qty] of novos) {
    const atual = (products ?? []).find(p => p.id === pid)
    if (Number(atual?.stock_shopee ?? 0) !== qty) {
      const { error } = await db.from('products').update({ stock_shopee: qty }).eq('id', pid)
      if (!error) updated++
    }
  }
  for (const p of products ?? []) {
    if (Number(p.stock_shopee ?? 0) > 0 && !novos.has(p.id)) {
      await db.from('products').update({ stock_shopee: 0 }).eq('id', p.id)
      updated++
    }
  }

  return NextResponse.json({
    ok: true,
    anuncios: itemIds.length,
    skus_com_estoque_full: bySku.size,
    unidades_full_shopee: [...bySku.values()].reduce((s, v) => s + v, 0),
    produtos_atualizados: updated,
    skus_sem_produto: semProduto.slice(0, 10),
  })
}
