/**
 * Cupom usado em cada pedido (painel Marketing & Ads → Cupons). Pedido do Bruno
 * 22/10/2026: medir ações com influenciador por código de cupom.
 *  - Shopee: o escrow traz o CÓDIGO exato do cupom do vendedor (seller_voucher_code)
 *  - ML: o pedido (/orders/{id}/discounts) só diz "cupom do vendedor de R$ X"; o
 *    código sai da campanha de cupom do vendedor com o mesmo valor e vigência
 *    → um valor diferente por influenciador deixa a ligação 100% certa
 * cupom_codigo: '' = conferido e sem cupom; NULL = ainda não conferido.
 */
export type Cupom = { codigo: string; vendedor: number; marketplace: number }

const r2 = (v: number) => Math.round(v * 100) / 100

export function cupomShopee(inc: Record<string, unknown> | undefined): Cupom {
  const n = (k: string) => Number(inc?.[k] ?? 0)
  const codes = Array.isArray(inc?.seller_voucher_code) ? (inc!.seller_voucher_code as string[]).filter(Boolean) : []
  const vendedor = n('voucher_from_seller'), marketplace = n('voucher_from_shopee')
  const codigo = codes.length ? codes.join('+') : vendedor > 0 ? 'Cupom do vendedor (sem código)' : marketplace > 0 ? 'Cupom da Shopee' : ''
  return { codigo, vendedor: r2(vendedor), marketplace: r2(marketplace) }
}

export type CampanhaML = { nome: string; codigo: string; fixo: number | null; pct: number | null; ini: string; fim: string }
type Detalhe = { type?: string; items?: Array<{ amounts?: { total?: number; seller?: number } }> }

export function cupomML(details: Detalhe[] | undefined, campanhas: CampanhaML[], dia: string, totalItens: number): Cupom {
  let vendedor = 0, total = 0
  for (const d of details ?? []) if (d.type === 'coupon')
    for (const i of d.items ?? []) { vendedor += Number(i.amounts?.seller ?? 0); total += Number(i.amounts?.total ?? 0) }
  const marketplace = Math.max(total - vendedor, 0)
  if (!total) return { codigo: '', vendedor: 0, marketplace: 0 }
  let codigo = 'Cupom do Mercado Livre'
  if (vendedor > 0) {
    const c = campanhas.find(c => dia >= c.ini && dia <= c.fim && (
      (c.fixo != null && Math.abs(c.fixo - vendedor) < 0.01) ||
      (c.pct != null && Math.abs(totalItens * c.pct / 100 - vendedor) < 0.05)))
    codigo = c ? `${c.codigo} (${c.nome})` : `Cupom do vendedor R$ ${vendedor.toFixed(2).replace('.', ',')} (campanha ML)`
  }
  return { codigo, vendedor: r2(vendedor), marketplace: r2(marketplace) }
}
