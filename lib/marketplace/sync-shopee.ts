import { shopeeGet } from '@/lib/integrations/shopee'
import { getCredential } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toBrazilDate } from '@/lib/utils/brazil-time'

interface ShopeeOrderListResponse {
  response?: {
    order_list: Array<{ order_sn: string; create_time: number }>
    more: boolean
    next_cursor: string
  }
  error?: string
}

interface ShopeeOrderDetailResponse {
  response?: {
    order_list: Array<{
      order_sn: string
      order_status?: string
      recipient_address?: { state?: string }
      item_list: Array<{
        item_sku: string
        model_sku?: string
        item_name: string
        model_quantity_purchased: number
        model_original_price: number
        model_discounted_price: number
      }>
      total_amount: number
      actual_shipping_fee: number
      estimated_shipping_fee: number
      buyer_paid_shipping_fee?: number
      actual_shipping_fee_confirmed: boolean
    }>
  }
}

interface ShopeeEscrowResponse {
  response?: {
    order_income: {
      buyer_total_amount: number
      escrow_amount: number
      commission_fee: number
      service_fee: number
      net_commission_fee?: number
      net_service_fee?: number
      final_shipping_fee: number
      actual_shipping_fee: number
      buyer_paid_shipping_fee: number
      ads_campaign_cost?: number
      voucher_from_seller?: number
      voucher_from_shopee?: number
    }
  }
}

export async function syncShopee(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  const cred = await getCredential('shopee')
  if (!cred?.access_token) return 0

  // Pré-carrega produtos
  const { data: allProducts } = await db.from('products').select('id, sku')
  const productMap = Object.fromEntries((allProducts ?? []).map(p => [p.sku, p.id]))

  let cursor = ''
  let synced = 0
  const fromTs = Math.floor(new Date(startDate).getTime() / 1000)
  const toTs = Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000)

  while (true) {
    const params: Record<string, string> = {
      time_range_field: 'create_time',
      time_from: String(fromTs),
      time_to: String(toTs),
      page_size: '50',
    }
    if (cursor) params.cursor = cursor

    const listRes = await shopeeGet<ShopeeOrderListResponse>('/order/get_order_list', params)
    const orders = listRes.response?.order_list ?? []
    if (!orders.length) break

    // Batch fetch order details
    const orderSns = orders.map(o => o.order_sn)
    const detailRes = await shopeeGet<ShopeeOrderDetailResponse>('/order/get_order_detail', {
      order_sn_list: orderSns.join(','),
      response_optional_fields: 'item_list,order_status,recipient_address',
    })

    const SKIP_STATUS = new Set(['CANCELLED', 'UNPAID', 'IN_CANCEL'])
    for (const orderDetail of detailRes.response?.order_list ?? []) {
      if (SKIP_STATUS.has((orderDetail as any).order_status ?? '')) continue
      const createTime = orders.find(o => o.order_sn === orderDetail.order_sn)?.create_time
        ?? (orderDetail as any).create_time
      if (!createTime) continue
      // Fetch escrow (financial) data per order
      let escrow: ShopeeEscrowResponse['response'] | undefined
      try {
        const escrowRes = await shopeeGet<ShopeeEscrowResponse>('/payment/get_escrow_detail', {
          order_sn: orderDetail.order_sn,
        })
        escrow = escrowRes.response
      } catch {
        // proceed without escrow data
      }

      // rateio do escrow por item (o escrow é do PEDIDO inteiro)
      const itemsAll = orderDetail.item_list ?? []
      const totalItems = itemsAll.reduce((a, it) =>
        a + (it.model_discounted_price || it.model_original_price) * it.model_quantity_purchased, 0)
      // Shopee mascara o endereço (****) após a conclusão — só grava UF válida
      const ufRaw = (orderDetail as any).recipient_address?.state?.toUpperCase() ?? ''
      const uf = /^[A-Z]{2}$/.test(ufRaw) ? ufRaw : null
      for (const item of itemsAll) {
        // SKU da variação (model_sku) é o código real; item_sku é o do anúncio
        const sku = item.model_sku || item.item_sku
        const grossPrice = (item.model_discounted_price || item.model_original_price) * item.model_quantity_purchased
        const share = totalItems > 0 ? grossPrice / totalItems : 1 / itemsAll.length
        const productId = productMap[sku] ?? null

        const income = escrow?.order_income
        await db.from('sales').upsert({
          external_order_id: `shopee_${orderDetail.order_sn}_${sku}`,
          marketplace: 'shopee',
          fulfillment_type: 'galpao',
          product_id: productId,
          sku,
          sale_date: toBrazilDate(new Date(createTime * 1000)),
          quantity: item.model_quantity_purchased,
          gross_price: grossPrice,
          shipping_received: ((income as any)?.buyer_paid_shipping_fee ?? 0) * share, // info; frete é neutro pro vendedor
          // Custos REAIS da Shopee (já LÍQUIDOS do ajuste de ação comercial):
          //   comissão líquida + serviço líquida. Frete NÃO é custo do vendedor
          //   (comprador paga e a Shopee repassa à logística — resultado zero).
          // usa a LÍQUIDA quando já existe (pedido concluído); senão a BRUTA como
          // provisória (a líquida só é finalizada na entrega — antes vem 0, o que
          // zerava o custo e inflava a margem de vendas ainda em trânsito)
          marketplace_commission: (((income as any)?.net_commission_fee > 0 ? (income as any).net_commission_fee : income?.commission_fee) ?? 0) * share,
          marketplace_fixed_fee:  (((income as any)?.net_service_fee > 0 ? (income as any).net_service_fee : income?.service_fee) ?? 0) * share,
          marketplace_shipping_fee: 0,
          ads_cost: ((income as any)?.ads_campaign_cost ?? 0) * share,
          // cupom que reduz a receita do vendedor (Shopee desconta do repasse)
          discounts: (((income as any)?.voucher_from_seller ?? 0) + ((income as any)?.voucher_from_shopee ?? 0)) * share,
          // escrow_amount (Renda estimada) rateado — referência da Shopee, não é
          // repasse independente (fica fora do alerta). 0/ausente = não liberado.
          ...((Number((income as any)?.escrow_amount) > 0) ? { payout_actual: (income as any).escrow_amount * share } : {}),
          cancellation: 0,
          // não sobrescrever UF vinda do XML da NF quando a API vier mascarada
          ...(uf ? { uf_destino: uf } : {}),
          synced_at: new Date().toISOString(),
        }, { onConflict: 'external_order_id' })

        synced++
      }
    }

    if (!listRes.response?.more) break
    cursor = listRes.response.next_cursor
  }

  return synced
}
