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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function isFulfillmentFull(order: MLOrder): boolean {
  return (
    order.tags?.includes('delivered_by_mercadolibre') === true ||
    order.shipping?.logistic_type === 'fulfillment'
  )
}

async function getShippingCostForSeller(shipmentId: number): Promise<number> {
  try {
    // Formato real do ML Brasil: custo do vendedor fica em senders[].cost
    // (senders_real_cost/sender_cost não existem no payload)
    const res = await mlGet<{ senders?: Array<{ cost?: number }> }>(`/shipments/${shipmentId}/costs`)
    return (res.senders ?? []).reduce((s, x) => s + Number(x.cost ?? 0), 0)
  } catch { return 0 }
}

/**
 * Extrai frete cobrado ao VENDEDOR pelo ML a partir de fee_details.
 *
 * No ML, fee_details com type contendo 'shipping' e amount > 0
 * representa o custo de envio cobrado do vendedor pelo Mercado Envios.
 * Isso evita a chamada extra ao endpoint /shipments/{id}/costs.
 */
function extractSellerShippingCost(order: MLOrder): number {
  if (!order.fee_details?.length) return 0
  const SHIPPING_TYPES = new Set([
    'mercadoenvios', 'mercadoenvios_ml',  // ← tipos reais no ML Brasil
    'shipping', 'shipping_fee', 'carrier_fee', 'logistic', 'fulfillment',
  ])
  let total = 0
  for (const fee of order.fee_details) {
    const amount = Number(fee.amount ?? fee.fee_amount ?? 0)
    const type   = fee.type?.toLowerCase() ?? ''
    if (amount > 0 && (SHIPPING_TYPES.has(type) || type.includes('shipping') || type.includes('envios') || type.includes('frete'))) {
      total += amount
    }
  }
  return total
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
  let rebateTotal = 0
  for (const fee of order.fee_details) {
    const amount = Number(fee.amount ?? fee.fee_amount ?? 0)
    if (amount < 0) rebateTotal += Math.abs(amount)
  }
  return rebateTotal
}

/**
 * Busca fee_details de um pedido individual via /orders/{id}.
 * O /orders/search NÃO retorna fee_details — só o endpoint individual.
 * fee_details contém: comissão real (ml_fee), frete ao vendedor (shipping*),
 * e rebates negativos (campanhas, estornos).
 */
async function fetchOrderFeeDetails(orderId: number): Promise<MLFeeDetail[]> {
  try {
    await sleep(180)
    const detail = await mlGet<{ fee_details?: MLFeeDetail[] }>(`/orders/${orderId}`)
    return detail.fee_details ?? []
  } catch {
    return []
  }
}

/**
 * Extrai comissão, frete e rebate de fee_details de um pedido individual.
 */
function extractAllFeesFromDetails(feeDetails: MLFeeDetail[]) {
  let commission = 0
  let shipping   = 0
  let rebate     = 0

  const SHIPPING_TYPES = new Set([
    'mercadoenvios', 'mercadoenvios_ml',  // tipos reais no ML Brasil
    'shipping', 'shipping_fee', 'carrier_fee', 'logistic', 'fulfillment',
  ])

  for (const fee of feeDetails) {
    const amount = Number(fee.amount ?? fee.fee_amount ?? 0)
    const type   = (fee.type ?? '').toLowerCase()

    if (type === 'ml_fee') {
      commission = Math.abs(amount)
    } else if (amount > 0 && (SHIPPING_TYPES.has(type) || type.includes('shipping') || type.includes('envios') || type.includes('frete'))) {
      shipping += amount
    } else if (amount < 0) {
      rebate += Math.abs(amount)
    }
  }
  return { commission, shipping, rebate }
}

export async function syncMercadoLivre(
  startDate: string,
  endDate: string,
  options: { fetchShipmentCosts?: boolean; fetchOrderDetails?: boolean } = {}
): Promise<number> {
  const { fetchShipmentCosts = false, fetchOrderDetails = true } = options
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

      // logistic_type não vem em /orders/search — só no shipment.
      // Sem essa chamada, TODA venda Full era marcada como galpão.
      let isFull = isFulfillmentFull(order)
      if (!isFull && order.shipping?.id && fetchOrderDetails) {
        try {
          await sleep(150)
          const sh = await mlGet<{ logistic_type?: string }>(`/shipments/${order.shipping.id}`)
          isFull = sh.logistic_type === 'fulfillment'
        } catch {}
      }
      const fulfillmentType = isFull ? 'full_ml' : 'galpao'

      // ── Busca fee_details individuais (frete real, comissão real, rebate) ──
      // O /orders/search não retorna fee_details — buscamos via /orders/{id}.
      // Limitado a pedidos com poucos itens (cron: 2-7 dias = ~20-100 pedidos/dia)
      let orderFeeDetails: MLFeeDetail[] = order.fee_details ?? []
      if (fetchOrderDetails && orderFeeDetails.length === 0) {
        orderFeeDetails = await fetchOrderFeeDetails(order.id)
      }

      const { commission: orderCommission, shipping: orderShipping, rebate: orderRebate }
        = extractAllFeesFromDetails(orderFeeDetails)

      // Se não veio de fee_details, fallback para campos do search
      let shippingCost = orderShipping > 0
        ? orderShipping
        : extractSellerShippingCost(order)

      // Full TAMBÉM paga frete por envio (senders[].cost) — não pular
      if (shippingCost === 0 && order.shipping?.id && fetchShipmentCosts) {
        await sleep(150)
        shippingCost = await getShippingCostForSeller(order.shipping.id)
      }

      const shippingReceived = Number(payment.shipping_cost ?? 0)
      const totalItemValue   = order.order_items.reduce((s, i) => s + i.unit_price * i.quantity, 0)

      for (const item of order.order_items) {
        const sku        = item.item.seller_sku ?? item.item.id
        const qty        = item.quantity
        const grossPrice = item.unit_price * qty

        // Comissão: usa fee_details (mais preciso) ou sale_fee/marketplace_fee como fallback
        const commission = orderCommission > 0
          ? orderCommission   // fee_details tem comissão total do pedido
          : (item.sale_fee ?? 0) > 0
            ? (item.sale_fee ?? 0)
            : (payment.marketplace_fee ?? 0)

        // Para pedidos multi-item, distribui comissão/frete/rebate proporcionalmente
        const itemShare  = totalItemValue > 0 ? (item.unit_price * qty) / totalItemValue : 1
        const itemRebate = orderRebate  > 0 ? orderRebate  * itemShare : 0
        // Frete: aplica ao item principal (ou distribui se multi-item)
        const itemShipping = shippingCost > 0 ? shippingCost * itemShare : 0

        const productId = productMap[sku] ?? null

        const { error: upsertErr } = await db.from('sales').upsert({
          external_order_id:        `ml_${order.id}_${item.item.id}`,
          marketplace:              'mercado_livre',
          fulfillment_type:         fulfillmentType,
          // Só grava product_id quando resolvido — senão o re-sync apagaria
          // vínculos feitos por outros caminhos (ex: EAN da NF-e do ML)
          ...(productId ? { product_id: productId } : {}),
          sku,
          pack_id:                  order.pack_id ? String(order.pack_id) : null,
          sale_date:                toBrazilDate(order.date_created),
          quantity:                 qty,
          gross_price:              grossPrice,
          shipping_received:        shippingReceived,
          marketplace_commission:   commission * itemShare,
          marketplace_shipping_fee: itemShipping,
          ads_cost:                 0,
          cancellation:             0,
          discounts:                (payment.coupon_amount ?? 0) * itemShare,
          rebate:                   itemRebate,
          synced_at:                new Date().toISOString(),
        }, { onConflict: 'external_order_id' })

        if (upsertErr) throw new Error(`Falha ao salvar venda ml_${order.id}: ${upsertErr.message}`)
        synced++
      }
    }

    offset += limit
    if (offset >= response.paging.total) break
  }

  return synced
}
