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
    shipping_cost: number   // valor cobrado ao COMPRADOR pelo frete
    coupon_amount: number
  }>
  shipping: {
    id?: number
    logistic_type?: string
    mode?: string
  }
  tags?: string[]
}

interface MLOrdersResponse {
  results: MLOrder[]
  paging: { total: number; offset: number; limit: number }
}

interface MLShipmentCosts {
  sender_cost?: number           // custo do frete cobrado ao VENDEDOR
  senders_real_cost?: number     // custo real do frete ao vendedor (após desconto)
  gross_amount?: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function isFulfillmentFull(order: MLOrder): boolean {
  return (
    order.tags?.includes('delivered_by_mercadolibre') === true ||
    order.shipping?.logistic_type === 'fulfillment'
  )
}

// Para Galpão: busca custo real do frete ao vendedor via API de shipments
async function getShippingCostForSeller(shipmentId: number): Promise<number> {
  try {
    const res = await mlGet<MLShipmentCosts>(`/shipments/${shipmentId}/costs`)
    // senders_real_cost = custo líquido ao vendedor (após subsídios ML)
    if (typeof res.senders_real_cost === 'number' && res.senders_real_cost > 0) {
      return res.senders_real_cost
    }
    if (typeof res.sender_cost === 'number' && res.sender_cost > 0) {
      return res.sender_cost
    }
    return 0
  } catch {
    return 0
  }
}

export async function syncMercadoLivre(
  startDate: string,
  endDate: string,
  options: { fetchShipmentCosts?: boolean } = {}
): Promise<number> {
  const { fetchShipmentCosts = false } = options
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

      const isFull = isFulfillmentFull(order)
      const fulfillmentType = isFull ? 'full_ml' : 'galpao'

      // Frete ao vendedor:
      // - Full ML: incluído na tarifa de fulfillment (marketplace_commission), não busca separado
      // - Galpão: custo real via API de shipments (só no cron, não no sync manual rápido)
      let shippingCost = 0
      if (!isFull && order.shipping?.id && fetchShipmentCosts) {
        await sleep(150) // evita rate limit
        shippingCost = await getShippingCostForSeller(order.shipping.id)
      }

      // Frete recebido do comprador (receita de frete)
      // payment.shipping_cost = valor que o COMPRADOR pagou pelo frete
      const shippingReceived = Number(payment.shipping_cost ?? 0)

      for (const item of order.order_items) {
        const sku = item.item.seller_sku ?? item.item.id
        const qty = item.quantity
        const grossPrice = item.unit_price * qty

        // Comissão: usa sale_fee por item (mais preciso) ou marketplace_fee do pagamento
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
          sale_date: order.date_created.slice(0, 10),
          quantity: qty,
          gross_price: grossPrice,
          shipping_received: shippingReceived,  // frete cobrado ao comprador
          marketplace_commission: commission,
          marketplace_shipping_fee: shippingCost, // custo do frete ao vendedor
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
