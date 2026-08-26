import { getValidAmazonToken } from '@/lib/integrations/amazon'
import { getCredential } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toBrazilDate } from '@/lib/utils/brazil-time'

const AMAZON_BASE = 'https://sellingpartnerapi-na.amazon.com'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Rate limit da Amazon é agressivo (429). Faz backoff e retenta algumas vezes;
// se persistir, lança 429 para o chamador decidir (pular o pedido, não abortar).
async function amazonRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = await getValidAmazonToken()
  if (!token) throw new Error('Amazon não conectado')
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${AMAZON_BASE}${path}`, {
      method,
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      next: { revalidate: 0 },
    })
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue }
    if (!res.ok) throw new Error(`Amazon ${method} ${path}: ${res.status}`)
    return res.json()
  }
  throw new Error(`Amazon ${method} ${path}: 429`)
}

interface AmazonOrdersResponse {
  payload: {
    Orders: Array<{
      AmazonOrderId: string
      PurchaseDate: string
      OrderStatus: string
      FulfillmentChannel: string
      OrderTotal?: { Amount: string }
    }>
    NextToken?: string
  }
}

interface AmazonOrderItemsResponse {
  payload: {
    OrderItems: Array<{
      ASIN: string
      SellerSKU: string
      Title: string
      QuantityOrdered: number
      ItemPrice?: { Amount: string }
      ItemTax?: { Amount: string }
      PromotionDiscount?: { Amount: string }
    }>
  }
}

export async function syncAmazon(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  const cred = await getCredential('amazon')
  if (!cred?.extra) return 0

  const marketplaceId = 'A2Q3Y263D00KWC' // Amazon.com.br
  let nextToken: string | undefined
  let synced = 0

  while (true) {
    // CreatedBefore não pode estar no futuro (Amazon exige ≥2 min no passado)
    const before = Math.min(new Date(`${endDate}T23:59:59Z`).getTime(), Date.now() - 5 * 60_000)
    // 'Delivered' não existe na SP-API — filtramos cancelado/pendente no loop
    const params = new URLSearchParams({
      MarketplaceIds: marketplaceId,
      CreatedAfter: `${startDate}T00:00:00Z`,
      CreatedBefore: new Date(before).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      MaxResultsPerPage: '100',
    })
    if (nextToken) params.set('NextToken', nextToken)

    const ordersRes = await amazonRequest<AmazonOrdersResponse>(`/orders/v0/orders?${params}`)

    for (const order of ordersRes.payload?.Orders ?? []) {
      if (order.OrderStatus === 'Canceled' || order.OrderStatus === 'Pending') continue
      const fulfillmentType = order.FulfillmentChannel === 'AFN' ? 'fba_amazon' : 'galpao'

      // throttle p/ respeitar o rate limit; 429 persistente = pula o pedido
      // (o backfill do dia seguinte pega), não aborta o canal inteiro
      await sleep(300)
      let itemsRes: AmazonOrderItemsResponse
      try {
        itemsRes = await amazonRequest<AmazonOrderItemsResponse>(
          `/orders/v0/orders/${order.AmazonOrderId}/orderItems`
        )
      } catch { continue }

      for (const item of itemsRes.payload?.OrderItems ?? []) {
        // SKUs da Amazon têm sufixo _FBA (ex: RAGA002-C_FBA) — normalizar p/ casar com o cadastro
        const sku = item.SellerSKU.replace(/_FBA$/i, '')
        // ItemPrice já é o TOTAL da linha (não multiplicar por qty) e vem SEM o
        // imposto — o bruto real (= NF) é ItemPrice + ItemTax
        const grossPrice = parseFloat(item.ItemPrice?.Amount ?? '0') + parseFloat(item.ItemTax?.Amount ?? '0')
        const { data: product } = await db.from('products').select('id').eq('sku', sku).single()

        await db.from('sales').upsert({
          external_order_id: `amz_${order.AmazonOrderId}_${item.SellerSKU}`,
          marketplace: 'amazon',
          fulfillment_type: fulfillmentType,
          product_id: product?.id ?? null,
          sku,
          sale_date: toBrazilDate(order.PurchaseDate),
          quantity: item.QuantityOrdered,
          gross_price: grossPrice,
          shipping_received: 0,
          marketplace_commission: 0, // Comes from settlement report
          marketplace_shipping_fee: 0, // Comes from settlement report
          ads_cost: 0,
          cancellation: 0,
          discounts: parseFloat(item.PromotionDiscount?.Amount ?? '0'),
          synced_at: new Date().toISOString(),
        }, { onConflict: 'external_order_id' })

        synced++
      }
    }

    nextToken = ordersRes.payload?.NextToken
    if (!nextToken) break
  }

  return synced
}
