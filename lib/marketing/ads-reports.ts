/**
 * Leitores dos relatórios de Ads enviados pelo Bruno (upload quinzenal).
 *  - Shopee: "Dados Gerais de Anúncios" (CSV; 7 linhas de cabeçalho antes da tabela;
 *    uma linha por anúncio de produto; números com ponto decimal).
 *  - Amazon: export da tela de Campanhas (CSV; números "R$ 1.234,56"; SEM datas —
 *    o período vem do formulário de upload; o ASIN costuma estar no nome: [B0…]).
 */
export interface AdRow {
  campaign_id: string
  campaign_name: string
  ad_ref: string          // ID do produto Shopee · ASIN Amazon ('' se não houver)
  ad_title: string
  impressions: number
  clicks: number
  cost: number
  ad_sales: number
  ad_orders: number
}

/** CSV mínimo (aspas duplas, vírgula); suficiente p/ estes dois relatórios */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const numPt = (v?: string) => {          // "R$ 1.234,56" | "1.234" | "0,0213"
  const t = (v ?? '').replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
  return t ? Number(t) : 0
}
const numEn = (v?: string) => {          // "58122.00" | "2.83%" | "-"
  const t = (v ?? '').replace(/[^\d.-]/g, '')
  return t && t !== '-' ? Number(t) : 0
}

export function parseShopeeAds(text: string): AdRow[] {
  const rows = parseCsv(text)
  const h = rows.findIndex(r => r[0] === '#' && r.includes('ID do produto'))
  if (h < 0) throw new Error('Não parece o relatório "Dados Gerais de Anúncios" da Shopee (falta a coluna "ID do produto").')
  const head = rows[h], col = (n: string) => head.indexOf(n)
  const out: AdRow[] = []
  for (const r of rows.slice(h + 1)) {
    if (!r[col('ID do produto')]) continue
    out.push({
      campaign_id: r[col('ID do produto')], campaign_name: r[col('Nome do Anúncio')] ?? '',
      ad_ref: r[col('ID do produto')], ad_title: r[col('Nome do Anúncio')] ?? '',
      impressions: numEn(r[col('Impressões')]), clicks: numEn(r[col('Cliques')]),
      cost: numEn(r[col('Despesas')]), ad_sales: numEn(r[col('GMV')]), ad_orders: numEn(r[col('Conversões')]),
    })
  }
  return out
}

export function parseAmazonCampaigns(text: string): AdRow[] {
  const rows = parseCsv(text)
  const head = rows[0] ?? []
  const col = (n: string) => head.indexOf(n)
  if (col('ID da campanha') < 0 || col('Custo total') < 0)
    throw new Error('Não parece o export de Campanhas da Amazon (faltam "ID da campanha" / "Custo total").')
  const out: AdRow[] = []
  for (const r of rows.slice(1)) {
    if (!r[col('ID da campanha')]) continue
    const nome = r[col('Nome da campanha')] ?? ''
    out.push({
      campaign_id: r[col('ID da campanha')], campaign_name: nome,
      ad_ref: nome.match(/\b(B0[A-Z0-9]{8})\b/)?.[1] ?? '',
      ad_title: nome,
      impressions: numPt(r[col('Impressões')]), clicks: numPt(r[col('Cliques')]),
      cost: numPt(r[col('Custo total')]), ad_sales: numPt(r[col('Vendas')]), ad_orders: numPt(r[col('Compras')]),
    })
  }
  return out
}
