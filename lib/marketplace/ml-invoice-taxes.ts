/** Impostos de uma venda a partir da NF-e emitida via Mercado Livre. */
export interface MLInvoiceItem {
  external_product_id?: string
  fiscal_data?: { rules?: Array<{ name?: string; attributes?: Record<string, unknown> | null }> }
}

/**
 * Soma TODOS os itens da nota daquele anúncio: anúncio de kit vem como vários itens
 * com o mesmo MLB (05/11/2026: pedido 2000019108516658 lia só a capota de R$ 52,99 e
 * ignorava a cadeira de R$ 1.257,27). Sem casar pelo MLB, usa o item único da nota;
 * em nota multi-item retorna null, senão herdaria o imposto de outro item.
 */
export function impostosDaVenda(items: MLInvoiceItem[], mlb: string) {
  const doAnuncio = items.filter(i => i.external_product_id === mlb)
  const itens = doAnuncio.length ? doAnuncio : items.length === 1 ? items : []
  if (!itens.length) return null
  const t = { pis: 0, cofins: 0, icms: 0, difal: 0, ipi: 0 }
  const num = (a: Record<string, unknown> | null | undefined, k: string) => Number(a?.[k] ?? 0)
  for (const r of itens.flatMap(i => i.fiscal_data?.rules ?? [])) {
    const a = r.attributes
    switch (r.name) {
      case 'PIS':    t.pis    += num(a, 'vpis');    break
      case 'COFINS': t.cofins += num(a, 'vcofins'); break
      case 'ICMS':
        t.icms  += num(a, 'vicms')
        // DIFAL + FCP destino — carga do estado de destino
        t.difal += num(a, 'vicmsufdest') + num(a, 'vicmsufremet') + num(a, 'vfcpufdest')
        break
      case 'IPI':    t.ipi    += num(a, 'vipi');    break
    }
  }
  return t
}
