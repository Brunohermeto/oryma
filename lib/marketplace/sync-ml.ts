import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

interface MLOrder {
  id: number
  date_created: string
  status: string
  order_items: Array<{
    item: { id: string; title: string; seller_sku?: string }
    quantity: number
    unit_price: number
    sale_fee: number
  }>
  payments: Array<{
    total_paid_amount: number
    marketplace_fee: number
    shipping_cost: number
    coupon_amount: number
  }>
  shipping: {
    id?: number
    logistic_type?: string
  }
  tags?: string[]
}

interface MLOrdersResponse {
  results: MLOrder[]
  paging: { total: number; offset: number; limit: number }
}

function isFulfillmentFull(order: MLOrder): boolean {
  return (
    order.tags?.includes('delivered_by_mercadolibre') === true ||
    order.shipping?.logistic_type === 'fulfillment'
  )
}

export async function syncMercadoLivre(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  let offset = 0
  let synced = 0
  const limit = 50

  const sellerId = await getMercadoLivreSellerId()
  if (!sellerId) throw new Error('Seller ID do Mercado Livre não encontrado — reconecte via OAuth')

  while (true) {
    const response = await mlGet<MLOrdersResponse>('/orders/search', {
      seller: sellerId,
      'order.status': 'paid',
      'order.date_created.from': `${startDate}T00:00:00.000-03:00`,
      'order.date_created.to': `${endDate}T23:59:59.000-03:00`,
      limit: String(limit),
      offset: String(offset),
      sort: 'date_asc',
    })

    if (!response.results?.length) break

    for (const order of response.results) {
      const payment = order.payments?.[0]
      if (!payment) continue

      const fulfillmentType = isFulfillmentFull(order) ? 'full_ml' : 'galpao'
      // Usa shipping_cost do payment diretamente — sem lookup extra por pedido (evita timeout)
      const shippingCost = payment.shipping_cost ?? 0

      for (const item of order.order_items) {
        const sku = item.item.seller_sku ?? item.item.id
        const qty = item.quantity
        const grossPrice = item.unit_price * qty
        const commission = (item.sale_fee ?? 0) > 0
          ? (item.sale_fee ?? 0) * qty
          : (payment.marketplace_fee ?? 0)

        const { data: product } = await db
          .from('products')
          .select('id')
          .eq('sku', sku)
          .maybeSingle()

        await db.from('sales').upsert({
          external_order_id: `ml_${order.id}_${item.item.id}`,
          marketplace: 'mercado_livre',
          fulfillment_type: fulfillmentType,
          product_id: product?.id ?? null,
          sku,
          product_name: item.item.title,
          sale_date: order.date_created.slice(0, 10),
          quantity: qty,
          gross_price: grossPrice,
          shipping_received: 0,
          marketplace_commission: commission,
          marketplace_shipping_fee: shippingCost,
          ads_cost: 0,
          cancellation: 0,
          discounts: payment.coupon_amount ?? 0,
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
