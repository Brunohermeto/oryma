import { mlGet } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

interface MLOrder {
  id: number
  date_created: string
  status: string
  order_items: Array<{
    item: { id: string; title: string; seller_sku?: string }
    quantity: number
    unit_price: number
  }>
  payments: Array<{ total_paid_amount: number; marketplace_fee: number; shipping_cost: number }>
  shipping: { receiver_address?: { state?: { id?: string } } }
  tags?: string[]
}

interface MLOrdersResponse {
  results: MLOrder[]
  paging: { total: number; offset: number; limit: number }
}

function isFulfillmentFull(order: MLOrder): boolean {
  return order.tags?.includes('delivered_by_mercadolibre') ?? false
}

export async function syncMercadoLivre(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  let offset = 0
  let synced = 0
  const limit = 50

  while (true) {
    const response = await mlGet<MLOrdersResponse>('/orders/search', {
      seller: 'me',
      'order.status': 'paid',
      'order.date_created.from': `${startDate}T00:00:00.000-03:00`,
      'order.date_created.to': `${endDate}T23:59:59.000-03:00`,
      limit: String(limit),
      offset: String(offset),
    })

    if (!response.results?.length) break

    for (const order of response.results) {
      const payment = order.payments?.[0]
      if (!payment) continue

      for (const item of order.order_items) {
        const fulfillmentType = isFulfillmentFull(order) ? 'full_ml' : 'galpao'
        const sku = item.item.seller_sku ?? item.item.id
        const grossPrice = item.unit_price * item.quantity

        // Match product by SKU
        const { data: product } = await db.from('products').select('id').eq('sku', sku).single()

        await db.from('sales').upsert({
          external_order_id: `ml_${order.id}_${item.item.id}`,
          marketplace: 'mercado_livre',
          fulfillment_type: fulfillmentType,
          product_id: product?.id ?? null,
          sku,
          sale_date: order.date_created.slice(0, 10),
          quantity: item.quantity,
          gross_price: grossPrice,
          shipping_received: 0,
          marketplace_commission: payment.marketplace_fee ?? 0,
          marketplace_shipping_fee: payment.shipping_cost ?? 0,
          ads_cost: 0, // ADS pulled separately via /advertising/reports
          cancellation: 0,
          discounts: 0,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'external_order_id' })

        synced++
      }
    }

    offset += limit
    if (offset >= response.paging.total) break
  }

  return synced
}
