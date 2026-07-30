import { magaluGet } from '@/lib/integrations/magalu'
import { getCredential } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toBrazilDate } from '@/lib/utils/brazil-time'
import { buildBlingProductIndex, resolveSkuFromBling, type BlingProductIndex } from '@/lib/bling/product-index'

/**
 * Sincroniza vendas da Magalu (Magalu Devs /seller/v1/orders).
 *
 * REGRAS CANÔNICAS (AGENTS.md):
 *  - Comissão BRUTA: comissão por item (delivery) + parcela fixa do pedido
 *    (diferença pedido − Σ itens) rateada em marketplace_fixed_fee.
 *  - Frete pago pelo comprador vai em shipping_received e NUNCA é receita.
 *  - gross_price = valor pago pelo produto (total do item − frete). O desconto
 *    de campanha já está refletido no preço; se o repasse financeiro mostrar
 *    subsídio da Magalu, entra depois como rebate (validar com NF-e do Bling).
 *  - Valores da API vêm em centavos (normalizer 100).
 */

interface MagaluAmount { total?: number }
interface MagaluItemAmounts { total?: number; freight?: MagaluAmount; commission?: MagaluAmount; discount?: MagaluAmount }
interface MagaluOrderItem {
  quantity?: number
  unit_price?: { value?: number }
  amounts?: MagaluItemAmounts
  info?: { sku?: string; name?: string }
}
interface MagaluDelivery {
  items?: MagaluOrderItem[]
  amounts?: MagaluItemAmounts
  shipping?: { recipient?: { address?: { state?: string } } }
}
interface MagaluOrder {
  code: string
  status: string
  purchased_at: string
  amounts?: { total?: number; commission?: MagaluAmount }
  deliveries?: MagaluDelivery[]
}
interface MagaluOrdersResponse {
  meta?: { page?: { count?: number } }
  results?: MagaluOrder[]
}
interface MagaluSkuEntry {
  sku?: string
  identifiers?: Array<{ type?: string; value?: string | null }>
}

// pedidos que não viram venda (cancelado / ainda não pago)
const SKIP_STATUS = new Set(['cancelled', 'new', 'pending_payment'])

export async function syncMagalu(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  const cred = await getCredential('magalu')
  if (!cred?.access_token) return 0

  const { data: allProducts } = await db.from('products').select('id, sku')
  const productMap = Object.fromEntries((allProducts ?? []).map(p => [p.sku, p.id]))

  // Índice do Bling para resolver EAN/código fabricante → SKU interno.
  // Se o Bling estiver fora, seguimos sem (product_id fica null e o relink resolve depois).
  let blingIndex: BlingProductIndex | null = null
  try { blingIndex = await buildBlingProductIndex() } catch { /* segue sem */ }

  // Catálogo Magalu (sku numérico deles → EAN) — carregado só se necessário
  let magaluEans: Record<string, string> | null = null
  const loadMagaluEans = async (): Promise<Record<string, string>> => {
    if (magaluEans) return magaluEans
    magaluEans = {}
    for (let offset = 0; offset < 1000; offset += 100) {
      const res = await magaluGet<{ results?: MagaluSkuEntry[] }>('/seller/v1/portfolios/skus', {
        _limit: '100', _offset: String(offset),
      })
      const rows = res.results ?? []
      for (const s of rows) {
        const ean = (s.identifiers ?? []).find(i => i.type === 'ean')?.value
        if (s.sku && ean) magaluEans[s.sku] = ean
      }
      if (rows.length < 100) break
    }
    return magaluEans
  }

  const resolveProduct = async (rawSku: string): Promise<{ productId: string | null; sku: string }> => {
    if (productMap[rawSku]) return { productId: productMap[rawSku], sku: rawSku }
    if (blingIndex) {
      const internal = resolveSkuFromBling(rawSku, blingIndex)
      if (internal && productMap[internal]) return { productId: productMap[internal], sku: internal }
    }
    // SKU numérico da era do integrador antigo → EAN do catálogo Magalu → Bling
    if (/^\d+$/.test(rawSku) && blingIndex) {
      const ean = (await loadMagaluEans())[rawSku]
      if (ean) {
        const internal = resolveSkuFromBling(ean, blingIndex)
        if (internal && productMap[internal]) return { productId: productMap[internal], sku: internal }
      }
    }
    return { productId: null, sku: rawSku }
  }

  const cents = (v?: number) => Math.round(v ?? 0) / 100
  let synced = 0

  // Sem filtro de data documentado: pagina do mais recente para trás até passar do início
  outer: for (let offset = 0; offset < 4000; offset += 50) {
    const res = await magaluGet<MagaluOrdersResponse>('/seller/v1/orders', {
      _limit: '50', _offset: String(offset), _sort: 'purchased_at:desc',
    })
    const orders = res.results ?? []
    if (!orders.length) break

    for (const order of orders) {
      const day = toBrazilDate(order.purchased_at)
      if (day > endDate) continue
      if (day < startDate) break outer
      if (SKIP_STATUS.has(order.status)) continue

      const items = (order.deliveries ?? []).flatMap(d =>
        (d.items ?? []).map(it => ({ it, uf: d.shipping?.recipient?.address?.state?.toUpperCase() ?? null })))
      if (!items.length) continue

      // parcela fixa = comissão do pedido − Σ comissões dos itens, rateada pelo valor
      const itemCommissionSum = items.reduce((s, { it }) => s + (it.amounts?.commission?.total ?? 0), 0)
      const fixedFeeTotal = Math.max(0, (order.amounts?.commission?.total ?? 0) - itemCommissionSum)
      const itemsTotal = items.reduce((s, { it }) => s + (it.amounts?.total ?? 0), 0)

      for (const { it, uf } of items) {
        const { productId, sku } = await resolveProduct(it.info?.sku ?? '')
        const itemTotal = it.amounts?.total ?? 0
        const freight = it.amounts?.freight?.total ?? 0
        const share = itemsTotal > 0 ? itemTotal / itemsTotal : 1

        await db.from('sales').upsert({
          external_order_id: `magalu_${order.code}_${it.info?.sku ?? ''}`,
          marketplace: 'magalu',
          fulfillment_type: 'galpao',
          product_id: productId,
          sku,
          sale_date: day,
          quantity: it.quantity ?? 1,
          gross_price: cents(itemTotal - freight),
          shipping_received: cents(freight),
          marketplace_commission: cents(it.amounts?.commission?.total),
          marketplace_fixed_fee: cents(fixedFeeTotal * share),
          marketplace_shipping_fee: 0,
          ads_cost: 0,
          rebate: 0,
          discounts: 0,
          cancellation: 0,
          uf_destino: uf,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'external_order_id' })

        synced++
      }
    }
  }

  return synced
}
