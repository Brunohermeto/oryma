import { shopeeGet } from '@/lib/integrations/shopee'
import { getCredential } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toBrazilDate } from '@/lib/utils/brazil-time'
import { upsertSale } from './upsert-sale'
import { shopeeFees } from './shopee-fees'
import { cupomShopee } from '@/lib/marketing/cupons'

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
    // financeiro (escrow) dos pedidos da página em PARALELO, 8 por vez — um a um,
    // dia de pico (10/10/2026: 104 pedidos) passava dos 60s e o sync parava no meio
    const escrows = new Map<string, ShopeeEscrowResponse['response']>()
    const validos = (detailRes.response?.order_list ?? []).filter(o => !SKIP_STATUS.has((o as any).order_status ?? ''))
    for (let i = 0; i < validos.length; i += 8) {
      await Promise.all(validos.slice(i, i + 8).map(async o => {
        try {
          const r = await shopeeGet<ShopeeEscrowResponse>('/payment/get_escrow_detail', { order_sn: o.order_sn })
          escrows.set(o.order_sn, r.response)
        } catch { /* segue sem escrow — o /api/sync/shopee/costs completa depois */ }
      }))
    }
    for (const orderDetail of detailRes.response?.order_list ?? []) {
      if (SKIP_STATUS.has((orderDetail as any).order_status ?? '')) continue
      const createTime = orders.find(o => o.order_sn === orderDetail.order_sn)?.create_time
        ?? (orderDetail as any).create_time
      if (!createTime) continue
      const escrow = escrows.get(orderDetail.order_sn)

      // rateio do escrow por item (o escrow é do PEDIDO inteiro)
      const itemsAll = orderDetail.item_list ?? []
      const totalItems = itemsAll.reduce((a, it) =>
        a + (it.model_discounted_price || it.model_original_price) * it.model_quantity_purchased, 0)
      // Shopee mascara o endereço (****) após a conclusão — só grava UF válida
      const ufRaw = (orderDetail as any).recipient_address?.state?.toUpperCase() ?? ''
      const uf = /^[A-Z]{2}$/.test(ufRaw) ? ufRaw : null
      const cp = cupomShopee(escrow?.order_income as unknown as Record<string, unknown> | undefined)
      const fees = shopeeFees(escrow?.order_income as unknown as Record<string, unknown> | undefined, totalItems)
      for (const item of itemsAll) {
        // SKU da variação (model_sku) é o código real; item_sku é o do anúncio
        const sku = item.model_sku || item.item_sku
        const grossPrice = (item.model_discounted_price || item.model_original_price) * item.model_quantity_purchased
        const share = totalItems > 0 ? grossPrice / totalItems : 1 / itemsAll.length
        const productId = productMap[sku] ?? null

        const income = escrow?.order_income
        await upsertSale(db, {
          external_order_id: `shopee_${orderDetail.order_sn}_${sku}`,
          marketplace: 'shopee',
          fulfillment_type: 'galpao',
          product_id: productId,
          sku,
          sale_date: toBrazilDate(new Date(createTime * 1000)),
          quantity: item.model_quantity_purchased,
          gross_price: grossPrice,
          shipping_received: ((income as any)?.buyer_paid_shipping_fee ?? 0) * share, // info; frete é neutro pro vendedor
          // comissão/serviço brutos + rebate ancorados no repasse (lib/marketplace/shopee-fees).
          // Frete NÃO é custo do vendedor (comprador paga e a Shopee repassa à logística).
          marketplace_commission: fees.comm * share,
          marketplace_fixed_fee:  fees.serv * share,
          rebate: fees.rebate * share,
          ...(escrow ? { cupom_codigo: cp.codigo, cupom_vendedor: cp.vendedor * share, cupom_marketplace: cp.marketplace * share } : {}),
          marketplace_shipping_fee: 0,
          ads_cost: ((income as any)?.ads_campaign_cost ?? 0) * share,
          // Cupom na SHOPEE: os DOIS reduzem a receita — voucher_from_seller E
          // voucher_from_shopee (a Shopee desconta do repasse). Regra de 26/08/2026:
          // 699 − comissão − serviço − voucher_from_shopee = escrow (Renda estimada).
          // DIFERENTE do ML (lá só a parte do vendedor). Revertido em 26/09 após
          // a auditoria de 22/09 aplicar a regra do ML aqui por engano.
          discounts: fees.cupom * share,
          // escrow_amount (Renda estimada) rateado — referência da Shopee, não é
          // repasse independente (fica fora do alerta). 0/ausente = não liberado.
          ...((Number((income as any)?.escrow_amount) > 0) ? { payout_actual: (income as any).escrow_amount * share } : {}),
          cancellation: 0,
          // não sobrescrever UF vinda do XML da NF quando a API vier mascarada
          ...(uf ? { uf_destino: uf } : {}),
          synced_at: new Date().toISOString(),
        })

        synced++
      }
    }

    if (!listRes.response?.more) break
    cursor = listRes.response.next_cursor
  }

  return synced
}
