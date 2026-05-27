import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toBrazilDate } from '@/lib/utils/brazil-time'

interface MLFeeDetail {
  type: string      // 'ml_fee' | 'coupon_ml' | 'financing_fee' | 'campaign' | etc.
  amount: number    // negativo = crédito ao vendedor (rebate/estorno/campanha)
  fee_amount?: number
}

interface MLOrder {
  id: number
  pack_id?: number | null
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
    shipping_cost: number     // valor cobrado ao COMPRADOR pelo frete
    coupon_amount: number
  }>
  shipping: {
    id?: number
    logistic_type?: string
    mode?: string
  }
  fee_details?: MLFeeDetail[]  // itens negativos = rebates/estornos/campanhas
  tags?: string[]
}

interface MLOrdersResponse {
  results: MLOrder[]
  paging: { total: number; offset: number; limit: number }
}

interface MLShipmentCosts {
  sender_cost?: number
  senders_real_cost?: number
  gross_amount?: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function isFulfillmentFull(order: MLOrder): boolean {
  return (
    order.tags?.includes('delivered_by_mercadolibre') === true ||
    order.shipping?.logistic_type === 'fulfillment'
  )
}

async function getShippingCostForSeller(shipmentId: number): Promise<number> {
  try {
    const res = await mlGet<MLShipmentCosts>(`/shipments/${shipmentId}/costs`)
    if (typeof res.senders_real_cost === 'number' && res.senders_real_cost > 0) return res.senders_real_cost
    if (typeof res.sender_cost === 'number' && res.sender_cost > 0) return res.sender_cost
    return 0
  } catch { return 0 }
}

/**
 * Extrai rebate do pedido ML.
 *
 * Fontes de rebate no ML:
 * 1. fee_details com amount < 0 (créditos ao vendedor):
 *    - "coupon_ml": ML subsidiou parte do cupom dado ao comprador
 *    - "campaign": bônus por participação em campanha comercial (ex: Semana do Consumidor)
 *    - "estorno": estorno de tarifa
 * 2. Quando ML paga parte do desconto de campanha, o coupon_amount cobrado ao
 *    vendedor é MENOR que o desconto total → a diferença está em fee_details como crédito
 *
 * Retorna o total de créditos ao vendedor (valor positivo = dinheiro recebido de volta).
 */
function extractRebate(order: MLOrder): number {
  if (!order.fee_details?.length) return 0

  // Tipos de fee que representam crédito/rebate ao vendedor (valor negativo no array)
  const REBATE_TYPES = new Set([
    'coupon_ml',          // ML subsidia parte do cupom
    'campaign',           // participação em campanha comercial
    'campaign_discount',  // desconto de campanha
    'estorno',            // estorno de tarifa
    'reversal',           // reversão
    'discount',           // desconto de tarifa por reputação/programa
    'seller_deal',        // promoção negociada com ML
  ])

  let rebateTotal = 0
  for (const fee of order.fee_details) {
    const amount = Number(fee.amount ?? fee.fee_amount ?? 0)
    // Créditos ao vendedor aparecem como NEGATIVOS em fee_details
    // (são valores que ML está devolvendo/concedendo ao vendedor)
    if (amount < 0) {
      // Se for um tipo conhecido de rebate OU qualquer crédito (amount < 0),
      // soma como rebate. Tipos conhecidos têm prioridade mas capturamos tudo.
      if (REBATE_TYPES.has(fee.type) || amount < 0) {
        rebateTotal += Math.abs(amount)
      }
    }
  }

  return rebateTotal
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

  const { data: allProducts } = await db.from('products').select('id, sku')
  const productMap = Object.fromEntries((allProducts ?? []).map(p => [p.sku, p.id]))

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

      const isFull         = isFulfillmentFull(order)
      const fulfillmentType = isFull ? 'full_ml' : 'galpao'

      let shippingCost = 0
      if (!isFull && order.shipping?.id && fetchShipmentCosts) {
        await sleep(150)
        shippingCost = await getShippingCostForSeller(order.shipping.id)
      }

      const shippingReceived = Number(payment.shipping_cost ?? 0)

      // Rebate do pedido: estornos + campanhas comerciais do ML
      // distribuído proporcionalmente entre os itens do pedido
      const orderRebate    = extractRebate(order)
      const totalItemValue = order.order_items.reduce((s, i) => s + i.unit_price * i.quantity, 0)

      for (const item of order.order_items) {
        const sku        = item.item.seller_sku ?? item.item.id
        const qty        = item.quantity
        const grossPrice = item.unit_price * qty

        const commission = (item.sale_fee ?? 0) > 0
          ? (item.sale_fee ?? 0)
          : (payment.marketplace_fee ?? 0)

        // Rebate rateado pelo valor do item em relação ao pedido total
        const itemShare  = totalItemValue > 0 ? (item.unit_price * qty) / totalItemValue : 1
        const itemRebate = orderRebate * itemShare

        const productId = productMap[sku] ?? null

        await db.from('sales').upsert({
          external_order_id:       `ml_${order.id}_${item.item.id}`,
          marketplace:             'mercado_livre',
          fulfillment_type:        fulfillmentType,
          product_id:              productId,
          sku,
          pack_id:                 order.pack_id ? String(order.pack_id) : null,
          sale_date:               toBrazilDate(order.date_created),
          quantity:                qty,
          gross_price:             grossPrice,
          shipping_received:       shippingReceived,
          marketplace_commission:  commission,
          marketplace_shipping_fee: shippingCost,
          ads_cost:                0,
          cancellation:            0,
          discounts:               payment.coupon_amount ?? 0,
          rebate:                  itemRebate,
          synced_at:               new Date().toISOString(),
        }, { onConflict: 'external_order_id' })

        synced++
      }
    }

    offset += limit
    if (offset >= response.paging.total) break
  }

  return synced
}
