/**
 * Crédito de PIS/COFINS sobre tarifas e Ads dos marketplaces — só no DRE (decisão
 * judicial favorável, Bruno 05/11/2026; vale para 2026 inteiro). A margem por venda
 * não muda. Base líquida do rebate: estorno não é tarifa paga. ICMS fica fora por
 * decisão do Bruno. ponytail: calculado pela alíquota, sem ler as notas de serviço.
 */
export const ALIQ_PIS_COFINS = 0.0165 + 0.076

export function creditoTarifas(comissao: number, tarifaFixa: number, frete: number, ads: number, rebate: number): number {
  return Math.max(0, comissao + tarifaFixa + frete + ads - rebate) * ALIQ_PIS_COFINS
}
