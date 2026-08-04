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
