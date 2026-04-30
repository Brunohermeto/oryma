import { shopeeGet } from '@/lib/integrations/shopee'
import { getCredential } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

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
      item_list: Array<{
        item_sku: string
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
      final_shipping_fee: number
      actual_shipping_fee: number
      buyer_paid_shipping_fee: number
      ads_campaign_cost?: number
      voucher_from_seller?: number
    }
  }
}

export async function syncShopee(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  const cred = await getCredential('shopee')
  if (!cred?.access_token) return 0

  let cursor = ''
  let synced = 0
  const fromTs = Math.floor(new Date(startDate).getTime() / 1000)
  const toTs = Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000)

  while (true) {
    const params: Record<string, string> = {
      time_range_field: 'create_time',
      time_from: String(fromTs),
      time_to: String(toTs),
      order_status: 'COMPLETED',
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
    })

    for (const orderDetail of detailRes.response?.order_list ?? []) {
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

      for (const item of orderDetail.item_list ?? []) {
        const sku = item.item_sku
        const grossPrice = (item.model_discounted_price || item.model_original_price) * item.model_quantity_purchased
        const { data: product } = await db.from('products').select('id').eq('sku', sku).single()

        const income = escrow?.order_income
        await db.from('sales').upsert({
          external_order_id: `shopee_${orderDetail.order_sn}_${sku}`,
          marketplace: 'shopee',
          fulfillment_type: 'galpao',
          product_id: product?.id ?? null,
          sku,
          sale_date: new Date(orders.find(o => o.order_sn === orderDetail.order_sn)!.create_time * 1000).toISOString().slice(0, 10),
          quantity: item.model_quantity_purchased,
          gross_price: grossPrice,
          shipping_received: income?.buyer_paid_shipping_fee ?? 0,
          marketplace_commission: (income?.commission_fee ?? 0) + (income?.service_fee ?? 0),
          marketplace_shipping_fee: income?.final_shipping_fee ?? 0,
          ads_cost: income?.ads_campaign_cost ?? 0,
          discounts: income?.voucher_from_seller ?? 0,
          cancellation: 0,
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
