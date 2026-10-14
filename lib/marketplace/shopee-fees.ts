/**
 * Custos e rebate de UM pedido Shopee a partir do escrow (get_escrow_detail).
 *
 * Espelha o extrato "Informações de Pagamento" da Shopee. Âncora = repasse real
 * (escrow_amount): comissão e serviço BRUTOS, descontos (cupons + ajuste PIX) e o
 * resto é o que a Shopee devolve a nós (rebate) = "Ajuste por participação em
 * ação comercial" (comissão/taxa) + "Cupons & descontos" (incentivos Shopee).
 *   rebate = repasse − (bruto − cupons − comissão − serviço)
 * Resíduo NEGATIVO (frete pago pelo vendedor, comissão de afiliado…) é custo →
 * vai para a tarifa fixa. Assim bruto − cupons − tarifas + rebate = repasse.
 * 14/10/2026: o "líquida 0 = não finalizada" perdia o rebate de comissão zerada
 * (pedido 261011AVQP4RUE: R$ 699 pagos por um item vendido a R$ 599).
 */
export function shopeeFees(inc: Record<string, unknown> | undefined, grossPedido: number) {
  const n = (k: string) => Number(inc?.[k] ?? 0)
  const comm  = n('commission_fee')
  const serv  = n('service_fee')
  // descontos = os do "Subtotal dos Produtos" do extrato: cupons + ajuste PIX
  const cupom = n('voucher_from_seller') + n('voucher_from_shopee') + n('pix_discount')
  const repasse = n('escrow_amount_after_adjustment') || n('escrow_amount')
  // repasse 0 = financeiro ainda não liberado → sem rebate por ora
  const residuo = repasse > 0 ? repasse - (grossPedido - cupom - comm - serv) : 0
  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    comm, cupom, repasse,
    serv: r2(serv + Math.max(-residuo, 0)),
    rebate: r2(Math.max(residuo, 0)),
  }
}
