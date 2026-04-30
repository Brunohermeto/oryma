import { getValidAmazonToken } from '@/lib/integrations/amazon'
import { getCredential } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

const AMAZON_BASE = 'https://sellingpartnerapi-na.amazon.com'

async function amazonRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = await getValidAmazonToken()
  if (!token) throw new Error('Amazon não conectado')
  const res = await fetch(`${AMAZON_BASE}${path}`, {
    method,
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Amazon ${method} ${path}: ${res.status}`)
  return res.json()
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
    const params = new URLSearchParams({
      MarketplaceIds: marketplaceId,
      OrderStatuses: 'Shipped,Delivered',
      CreatedAfter: `${startDate}T00:00:00Z`,
      CreatedBefore: `${endDate}T23:59:59Z`,
      MaxResultsPerPage: '100',
    })
    if (nextToken) params.set('NextToken', nextToken)

    const ordersRes = await amazonRequest<AmazonOrdersResponse>(`/orders/v0/orders?${params}`)

    for (const order of ordersRes.payload?.Orders ?? []) {
      const fulfillmentType = order.FulfillmentChannel === 'AFN' ? 'fba_amazon' : 'galpao'

      const itemsRes = await amazonRequest<AmazonOrderItemsResponse>(
        `/orders/v0/orders/${order.AmazonOrderId}/orderItems`
      )

      for (const item of itemsRes.payload?.OrderItems ?? []) {
        const sku = item.SellerSKU
        const grossPrice = parseFloat(item.ItemPrice?.Amount ?? '0') * item.QuantityOrdered
        const { data: product } = await db.from('products').select('id').eq('sku', sku).single()

        await db.from('sales').upsert({
          external_order_id: `amz_${order.AmazonOrderId}_${item.SellerSKU}`,
          marketplace: 'amazon',
          fulfillment_type: fulfillmentType,
          product_id: product?.id ?? null,
          sku,
          sale_date: order.PurchaseDate.slice(0, 10),
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
