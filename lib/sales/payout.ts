/**
 * Auditoria de repasse: compara o que o Oryma ESPERA que o marketplace repasse
 * com o que ele REALMENTE repassou (payout_actual, vindo da API de cada canal).
 *
 * Esperado = bruto − devolução − comissão − taxa fixa − frete do vendedor − ADS
 *            − cupom + rebate. Frete do COMPRADOR não entra (é neutro: comprador
 *            paga, marketplace repassa à logística), seguindo a regra canônica.
 */
// Canais cujo repasse vem de um extrato INDEPENDENTE (dá pra auditar de verdade).
// Shopee fica de fora: a API só devolve a "Renda estimada", derivada das mesmas
// taxas que já temos e instável com a finalização — reconciliar seria circular.
const CANAIS_AUDITAVEIS = new Set(['mercado_livre', 'amazon', 'magalu'])
export const isPayoutAuditable = (mp?: string | null) => !!mp && CANAIS_AUDITAVEIS.has(mp)

export type PayoutSale = {
  marketplace?: string | null
  gross_price: number | string | null
  cancellation?: number | string | null
  marketplace_commission?: number | string | null
  marketplace_fixed_fee?: number | string | null
  marketplace_shipping_fee?: number | string | null
  ads_cost?: number | string | null
  discounts?: number | string | null
  rebate?: number | string | null
  payout_actual?: number | string | null
}

const n = (v: unknown) => Number(v ?? 0)

export function expectedPayout(s: PayoutSale): number {
  return n(s.gross_price) - n(s.cancellation)
    - n(s.marketplace_commission) - n(s.marketplace_fixed_fee)
    - n(s.marketplace_shipping_fee) - n(s.ads_cost) - n(s.discounts)
    + n(s.rebate)
}

/** Divergência = real − esperado. Negativa = marketplace pagou MENOS que o devido. */
export function payoutDiff(s: PayoutSale): number {
  return n(s.payout_actual) - expectedPayout(s)
}

/**
 * Só vale conciliar quando há repasse real registrado. Divergência relevante:
 * acima de R$ 1,00 E acima de 2% do esperado (evita ruído de arredondamento).
 */
export function isPayoutDivergent(s: PayoutSale): boolean {
  if (s.payout_actual == null) return false
  if (!isPayoutAuditable(s.marketplace)) return false  // Shopee = referência, não alerta
  const exp = expectedPayout(s)
  const diff = Math.abs(payoutDiff(s))
  return diff > 1 && (exp === 0 || diff / Math.abs(exp) > 0.02)
}
