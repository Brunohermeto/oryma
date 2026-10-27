/**
 * Venda devolvida / cancelada pelo marketplace.
 *
 * Regra (2026-08-04): venda estornada NÃO entra em faturamento, margem nem
 * contagem de pedidos. O dinheiro voltou para o comprador, a mercadoria voltou
 * para o estoque e o marketplace estorna as tarifas — manter a venda nas contas
 * produz margem negativa falsa (ex: pedido Amazon 702-4116095-4193039, -97%).
 *
 * Devolução PARCIAL (cancellation < gross_price) continua valendo pelo líquido:
 * só a devolução INTEGRAL tira a venda das contas.
 */
export function isReturned(sale: {
  gross_price: number | string | null
  cancellation?: number | string | null
}): boolean {
  const gross  = Number(sale.gross_price ?? 0)
  const cancel = Number(sale.cancellation ?? 0)
  return gross > 0 && cancel >= gross - 0.01
}

/**
 * A comissão da venda já está apurada? Comissão 0 normalmente = extrato ainda não
 * chegou (margem fica "em cálculo"). Exceção: o Mercado Livre ZERA a comissão em
 * campanhas (10.10/2026: dezenas de pedidos com sale_fee 0). Passados 5 dias o
 * extrato do ML certamente já foi lançado — se continua 0, é comissão zero real.
 */
export function comissaoApurada(sale: { marketplace?: string | null; marketplace_commission?: number | string | null; sale_date?: string | null }, hoje = new Date()): boolean {
  if (Number(sale.marketplace_commission ?? 0) > 0) return true
  if (sale.marketplace !== 'mercado_livre' || !sale.sale_date) return false
  return (hoje.getTime() - new Date(`${sale.sale_date}T12:00:00-03:00`).getTime()) / 864e5 >= 5
}
