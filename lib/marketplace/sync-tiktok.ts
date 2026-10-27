/**
 * Vendas do TikTok Shop (Order API 202309) → sales. Regras (27/10/2026):
 *  - envio sai do galpão (FULFILLMENT_BY_SELLER, coleta do TikTok) → 'galpao'; NF pelo Bling
 *  - bruto = preço depois do desconto DO VENDEDOR (original − seller_discount); o
 *    desconto bancado pelo TikTok (platform_discount) volta no repasse → não é
 *    receita perdida nem desconto nosso (mesma regra do cupom do ML)
 *  - TikTok devolve 1 line_item POR UNIDADE → agrupa por seller_sku
 *  - taxas/repasse vêm do extrato (/api/sync/tiktok/fees), liberado na entrega
 *  - pedido CANCELADO depois de pago: marca cancellation = bruto nas linhas já gravadas
 */
import { tiktokApi } from '@/lib/integrations/tiktok'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toBrazilDate } from '@/lib/utils/brazil-time'
import { upsertSale } from './upsert-sale'

type Item = { seller_sku?: string; original_price?: string; seller_discount?: string; sale_price?: string; platform_discount?: string }
type Pedido = { id: string; status: string; create_time: number; line_items?: Item[] }

export const TIKTOK_STATUS_INVALIDO = new Set(['UNPAID', 'CANCELLED'])

/** Pedidos do intervalo (horário de Brasília; hIni/hFim fatiam o dia de pico). */
export async function tiktokPedidos(startDate: string, endDate: string, hIni = 0, hFim = 24): Promise<Pedido[]> {
  const ts = (d: string, h: number) => Math.floor(new Date(`${d}T00:00:00-03:00`).getTime() / 1000) + h * 3600
  const out: Pedido[] = []
  let pageToken = ''
  for (let i = 0; i < 40; i++) {
    const d = await tiktokApi<{ orders?: Pedido[]; next_page_token?: string }>('POST', '/order/202309/orders/search',
      { page_size: '50', sort_field: 'create_time', sort_order: 'ASC', ...(pageToken ? { page_token: pageToken } : {}) },
      { create_time_ge: ts(startDate, hIni), create_time_lt: ts(endDate, hFim) })
    out.push(...(d.orders ?? []))
    pageToken = d.next_page_token ?? ''
    if (!pageToken) break
  }
  return out
}

export async function syncTiktok(startDate: string, endDate: string, hIni = 0, hFim = 24): Promise<number> {
  const db = createSupabaseServiceClient()
  const { data: prods } = await db.from('products').select('id, sku, archived')
  const produto = Object.fromEntries((prods ?? []).filter(p => !p.archived).map(p => [p.sku, p.id]))
  const n = (v?: string) => Number(v ?? 0)
  let synced = 0

  for (const p of await tiktokPedidos(startDate, endDate, hIni, hFim)) {
    if (p.status === 'CANCELLED') {
      // cancelado depois de pago: tira do faturamento o que já tinha entrado
      const { data: linhas } = await db.from('sales').select('id, gross_price, cancellation').like('external_order_id', `tiktok_${p.id}_%`)
      for (const l of linhas ?? [])
        if (Number(l.cancellation ?? 0) < Number(l.gross_price) - 0.01)
          await db.from('sales').update({ cancellation: l.gross_price }).eq('id', l.id)
      continue
    }
    if (TIKTOK_STATUS_INVALIDO.has(p.status)) continue

    const porSku = new Map<string, { qtd: number; bruto: number }>()
    for (const it of p.line_items ?? []) {
      const sku = (it.seller_sku ?? '').replace(/[ \s]+/g, '')
      const a = porSku.get(sku) ?? { qtd: 0, bruto: 0 }
      a.qtd++; a.bruto += n(it.original_price) - n(it.seller_discount)
      porSku.set(sku, a)
    }
    for (const [sku, a] of porSku) {
      await upsertSale(db, {
        external_order_id: `tiktok_${p.id}_${sku}`,
        marketplace: 'tiktok', fulfillment_type: 'galpao',
        product_id: produto[sku] ?? null, sku,
        sale_date: toBrazilDate(new Date(p.create_time * 1000)),
        quantity: a.qtd, gross_price: Math.round(a.bruto * 100) / 100,
        shipping_received: 0, marketplace_commission: 0, marketplace_fixed_fee: 0, marketplace_shipping_fee: 0,
        ads_cost: 0, discounts: 0, cancellation: 0,
        synced_at: new Date().toISOString(),
      })
      synced++
    }
  }
  return synced
}
