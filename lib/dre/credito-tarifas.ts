/**
 * Crédito de PIS/COFINS sobre as tarifas dos marketplaces — só no DRE (decisão
 * judicial favorável, Bruno 05/11/2026; vale para 2026 inteiro). A margem por venda
 * não muda. Base líquida do rebate: estorno não é tarifa paga.
 * ponytail: calculado pela alíquota, sem ler as notas de serviço; sem ICMS até
 * confirmar numa nota real se ele vem destacado e a qual alíquota.
 */
export const ALIQ_PIS_COFINS = 0.0165 + 0.076

export function creditoTarifas(comissao: number, tarifaFixa: number, frete: number, rebate: number): number {
  return Math.max(0, comissao + tarifaFixa + frete - rebate) * ALIQ_PIS_COFINS
}
