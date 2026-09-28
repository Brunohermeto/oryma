/**
 * Fórmula ÚNICA dos números de venda nas telas (regra 5 do AGENTS.md).
 *
 * - faturamento = liq = gross_price − cancellation − discounts
 *   (shipping_received NUNCA entra: é frete do comprador, fica com o marketplace)
 * - devolvidas (isReturned) ficam fora de tudo — filtrar ANTES de agregar
 * - margem % = Σ margin_value ÷ Σ liq DAS MESMAS vendas com margin_value não nulo
 *   (margin_value gravado pelo relink; tela não recalcula margem por venda)
 * - sem base → null (exibir "—", nunca 0,0%)
 */
type Num = number | string | null | undefined

export interface MetricSale {
  gross_price: Num
  cancellation?: Num
  discounts?: Num
  margin_value?: Num
}

export const liq = (s: MetricSale) =>
  Number(s.gross_price ?? 0) - Number(s.cancellation ?? 0) - Number(s.discounts ?? 0)

/** revenue = Σ liq de todas; mv/base = só as vendas com margem apurada */
export interface Agg { revenue: number; orders: number; mv: number; base: number }

export const newAgg = (): Agg => ({ revenue: 0, orders: 0, mv: 0, base: 0 })

export function addSale(a: Agg, s: MetricSale): Agg {
  const g = liq(s)
  a.revenue += g
  a.orders++
  if (s.margin_value !== null && s.margin_value !== undefined) {
    a.mv   += Number(s.margin_value)
    a.base += g
  }
  return a
}

/** Margem % (0–100) ou null quando não há base apurada */
export const pctOf = (a: { mv: number; base: number }): number | null =>
  a.base > 0 ? (a.mv / a.base) * 100 : null

export function marginAgg(rows: MetricSale[]): { mv: number; base: number; pct: number | null } {
  const a = newAgg()
  for (const r of rows) addSale(a, r)
  return { mv: a.mv, base: a.base, pct: pctOf(a) }
}

/** Agregador por chave (canal, dia, UF, produto…) */
export function aggBy<T extends MetricSale>(rows: T[], key: (r: T) => string): Map<string, Agg> {
  const m = new Map<string, Agg>()
  for (const r of rows) {
    const k = key(r)
    let a = m.get(k)
    if (!a) m.set(k, (a = newAgg()))
    addSale(a, r)
  }
  return m
}
