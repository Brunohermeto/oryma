import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'
import { buildBlingProductIndex, resolveSkuFromBling, type BlingProductIndex } from '@/lib/bling/product-index'
import type { ParsedNFe } from './parser'

// SKU_MAP: mapeia código do produto na NF-e (cProd) → SKU interno
// Cada variante de cor/modelo tem seu próprio SKU — NÃO mesclar variantes distintas.
const SKU_MAP: Record<string, string> = {
  // RAGA001 — Canguru/Mochila Portabebê (variantes por cor — fornecedor usa código próprio)
  'RAGA001-C': 'RAGA001-C', 'RAGA001-R': 'RAGA001-R',
  'RAGA001-A': 'RAGA001-A', 'RAGA001-B': 'RAGA001-B',
  'GRAY-3038':  'RAGA001-C', 'PINK-3021':  'RAGA001-R',
  'BLUE-3034':  'RAGA001-A', 'BEIGE-3045': 'RAGA001-B',

  // RAGA002 — Cadeira de Alimentação Luppa (variantes por cor)
  'RAGA002-C':     'RAGA002-C',
  'RAGA002-CINZA': 'RAGA002-CINZA',
  'RAGA002-R':     'RAGA002-R',
  'RAGA002-BG':    'RAGA002-BG',
  'LUPPA':         'RAGA002',   // código genérico do fornecedor (sem variante)

  // RAGA003 — Berço Portátil Sleepguard (variantes por cor)
  'RAGA003-C':  'RAGA003-C',
  'RAGA003-BG': 'RAGA003-BG',
  'MUB004':     'RAGA003',     // código genérico do fornecedor
  'BEDSIDE':    'RAGA003',

  // RAGA004 — Cadeira de Carro GIO Confort Max (variantes por cor)
  'RAGA004-C':  'RAGA004-C',
  'RAGA004-P':  'RAGA004-P',
  'RAGA004-BG': 'RAGA004-BG',
  'MUC101':     'RAGA004',     // código genérico do fornecedor

  // MOVEDUO — Carrinho 3 em 1 Move
  'MOVEDUO':           'MOVEDUO',
  '7908488105732':     'MOVEDUO',   // EAN do Move quando o fornecedor usa EAN como cProd
  '7908488105732-DUO': 'MOVEDUO',
}

// Palavras-chave por variante para fallback via xProd (descrição)
// IMPORTANTE: verificar variante ANTES de produto base (mais específico primeiro)
const XPROD_KEYWORDS: Array<{ keywords: string[]; sku: string }> = [
  // RAGA001
  { keywords: ['RAGA001-C', 'CINZA', 'GRAY'],  sku: 'RAGA001-C' },
  { keywords: ['RAGA001-R', 'ROSA', 'PINK'],   sku: 'RAGA001-R' },
  { keywords: ['RAGA001-A', 'AZUL', 'BLUE'],   sku: 'RAGA001-A' },
  { keywords: ['RAGA001-B', 'BEGE', 'BEIGE'],  sku: 'RAGA001-B' },
  // RAGA002
  { keywords: ['RAGA002-C', 'LUPPA', 'CINZA RAJADO'],      sku: 'RAGA002-C' },
  { keywords: ['RAGA002-CINZA', 'LUPPA', 'CINZA'],         sku: 'RAGA002-CINZA' },
  { keywords: ['RAGA002-BG', 'LUPPA', 'BEGE'],             sku: 'RAGA002-BG' },
  { keywords: ['RAGA002-R', 'LUPPA', 'ROSA', 'VERMELHO'],  sku: 'RAGA002-R' },
  { keywords: ['LUPPA'],                                    sku: 'RAGA002' },
  // RAGA003
  { keywords: ['RAGA003-C', 'SLEEPGUARD', 'CINZA'],   sku: 'RAGA003-C' },
  { keywords: ['RAGA003-BG', 'SLEEPGUARD', 'BEGE'],   sku: 'RAGA003-BG' },
  { keywords: ['MUB004'],                              sku: 'RAGA003' },
  { keywords: ['BEDSIDE'],                             sku: 'RAGA003' },
  // RAGA004
  { keywords: ['RAGA004-P', 'GIO', 'PRETO'],          sku: 'RAGA004-P' },
  { keywords: ['RAGA004-C', 'GIO', 'CINZA'],          sku: 'RAGA004-C' },
  { keywords: ['RAGA004-BG', 'GIO', 'BEGE'],          sku: 'RAGA004-BG' },
  { keywords: ['MUC101'],                              sku: 'RAGA004' },
  // MOVEDUO
  { keywords: ['MOVEDUO', 'MOVE'],                    sku: 'MOVEDUO' },
]

function resolveProductSku(cProd: string, xProd: string, blingIndex?: BlingProductIndex, cEAN?: string): string {
  // 1. Mapeamento direto pelo cProd (SKU_MAP tem precedência)
  if (SKU_MAP[cProd]) return SKU_MAP[cProd]

  // 1b. EAN do item — o cadastro (vindo do Bling) usa EAN como SKU na maioria
  //     dos produtos; é o identificador fiscal mais confiável da NF.
  if (cEAN && /^\d{12,14}$/.test(cEAN)) {
    if (SKU_MAP[cEAN]) return SKU_MAP[cEAN]
    if (blingIndex) {
      const eanSku = resolveSkuFromBling(cEAN, blingIndex)
      if (eanSku) return eanSku
    }
  }

  // 2. Catálogo do Bling: codigoFabricante ou GTIN → SKU interno
  if (blingIndex) {
    const blingSku = resolveSkuFromBling(cProd, blingIndex)
    if (blingSku) return blingSku
  }

  // 3. Fallback por palavras-chave na descrição (xProd)
  const upper = xProd.toUpperCase()
  const sorted = [...XPROD_KEYWORDS].sort((a, b) => b.keywords.length - a.keywords.length)
  for (const rule of sorted) {
    if (rule.keywords.every(kw => upper.includes(kw.toUpperCase()))) {
      return rule.sku
    }
  }

  // 4. Fallback final: usa o cProd literalmente
  return cProd
}

// Famílias Ragaluma nas NF-e da PRÓPRIA MCL (importação 3102 e transferência
// matriz→filial 5152): o cProd vem "CFOP3102"/"CFOP5152" e o código real fica no
// INÍCIO da descrição ("GRAY-3038 - BERCO…", "MUB004 - …", "MUH-035-1 - …"), com a
// cor no texto. Item SEM cor (ex.: "CADEIRA … LUPPA 12 EM 1" da NF 1) vale para
// todas as cores da família — o custo unitário é o mesmo por cor (NF 8, mar/2026).
// Ordem das cores importa: RAJADO antes de CINZA.
const FAMILIAS: Array<{ match: RegExp; cores: Array<[RegExp, string]> }> = [
  // Linha S500/Levvi (transferência 5152 de set/2026): "MODELO - TIPO - COR - …"
  // igual ao nome do cadastro. Mais específico PRIMEIRO (+ BASE antes de + CAR SEAT).
  { match: /^S500 - STROLLER \+ CAR SEAT \+ BASE/,
    cores: [[/GOLD\/BLACK/, 'RAGA010-D'], [/GRAY\/BLACK/, 'RAGA010-PP'], [/GRAY\/GRAY/, 'RAGA010-C']] },
  { match: /^S500 - STROLLER \+ CAR SEAT/,
    cores: [[/GOLD\/BLACK/, 'RAGA009-D'], [/GRAY\/BLACK/, 'RAGA009-PP'], [/GRAY\/GRAY/, 'RAGA009-C']] },
  { match: /^S500 - STROLLER/,
    cores: [[/GOLD\/BLACK/, 'RAGA005-D'], [/GRAY\/BLACK/, 'RAGA005-PP'], [/GRAY\/GRAY/, 'RAGA005-C']] },
  { match: /^DB03 - CAR SEAT/,
    cores: [[/- BLACK -/, 'RAGA006-P'], [/- GRAY -/, 'RAGA006-C']] },
  { match: /^ISOFIX BASE/, cores: [[/./, 'RAGA007']] },
  { match: /BERCO PORTATIL DE METAL|GRAY-3038|PINK-3021|BLUE-3034|BEIGE-3045/,
    cores: [[/GRAY|CINZA/, 'RAGA001-C'], [/PINK|ROSA/, 'RAGA001-R'], [/BLUE|AZUL/, 'RAGA001-A'], [/BEIGE|BEGE/, 'RAGA001-B']] },
  { match: /LUPPA|MUH-035/,
    cores: [[/RAJADO/, 'RAGA002-C'], [/ROSA|PINK/, 'RAGA002-R'], [/CINZA|GRAY|GREY/, 'RAGA002-CINZA']] },
  { match: /MUB004|BEDSIDE SLEEPER|SLEEPGUARD/,
    cores: [[/BEGE|BEIGE/, 'RAGA003-BG'], [/CINZA|GREY|GRAY/, 'RAGA003-C']] },
  { match: /MUC101|GIO CONFORT/,
    cores: [[/BEGE|BEIGE/, 'RAGA004-BG'], [/PRETO|BLACK/, 'RAGA004-P'], [/CINZA|GREY|GRAY/, 'RAGA004-C']] },
]

/**
 * SKU(s) internos de um item de NF-e. [] = peça de reposição/caixa (não vira
 * produto); 1 SKU = item normal; vários = item de família sem cor (o lote vale
 * para todas as cores). Usado pelo upload manual E pela sync do Bling.
 */
export function resolveVariantSkus(cProd: string, xProd: string, blingIndex?: BlingProductIndex, cEAN?: string): string[] {
  if (SKU_MAP[cProd]) return [SKU_MAP[cProd]]
  const up = (xProd ?? '').toUpperCase()
  if (/REPOSI[CÇ]/.test(up)) return []
  const fam = FAMILIAS.find(f => f.match.test(up) || f.match.test(cProd.toUpperCase()))
  if (fam) {
    const cor = fam.cores.find(([re]) => re.test(up))
    return cor ? [cor[1]] : fam.cores.map(c => c[1])
  }
  const sku = resolveProductSku(cProd, xProd, blingIndex, cEAN)
  return /^CFOP\d+/i.test(sku) ? [] : [sku]
}

export async function processImportNFe(
  nfe: ParsedNFe,
  storagePath: string | null,
  blingIndex?: BlingProductIndex
): Promise<{ orderId: string; itemsProcessed: number }> {
  const db = createSupabaseServiceClient()
  const totalFobValue = nfe.items.reduce((s, i) => s + i.vProd, 0)

  // Upsert do import_order (nfe_key tem UNIQUE constraint)
  const { data: order, error } = await db
    .from('import_orders')
    .upsert({
      nfe_number:      nfe.numero,
      nfe_key:         nfe.chave || null,
      supplier:        nfe.emitente,
      issue_date:      nfe.dataEmissao,
      cfop:            nfe.cfop,
      total_nfe_value: nfe.totais.vNF,
      total_fob_value: totalFobValue,
      source:          storagePath ? 'manual_upload' : 'bling',
      xml_storage_path: storagePath,
      costs_complete:  false,
    }, { onConflict: 'nfe_key' })
    .select('id')
    .single()

  if (error || !order) throw new Error(`Falha ao criar NF-e de importação: ${error?.message}`)

  // Delete + insert para evitar duplicatas sem precisar de constraint composta
  await db.from('import_items').delete().eq('import_order_id', order.id)

  let itemsProcessed = 0
  const itemRows = []
  for (const item of nfe.items) {
    const skus = resolveVariantSkus(item.cProd, item.xProd, blingIndex, (item as any).cEAN)
    // [] = peça/caixa: grava o item SEM produto (NUNCA criar produto-lixo "CFOP…")
    const alvos = skus.length ? skus : [null]
    for (const sku of alvos) {
      let productId: string | null = null
      if (sku) {
        let { data: product } = await db.from('products').select('id').eq('sku', sku).maybeSingle()
        if (!product) {
          const { data: newProd } = await db.from('products').insert({ sku, name: item.xProd }).select('id').maybeSingle()
          product = newProd
        }
        productId = product?.id ?? null
      }
      // família sem cor: a quantidade se divide entre as cores (custo unitário igual)
      const qty = item.qCom / alvos.length
      itemRows.push({
        import_order_id:  order.id,
        product_id:       productId,
        sku:              sku ?? item.cProd,
        description:      item.xProd,
        quantity:         qty,
        unit_fob_value:   item.vUnCom,
        total_fob_value:  item.vProd / alvos.length,
        unit_ii:          item.unitII,
        unit_ipi:         item.unitIPI,
        unit_pis_imp:     item.unitPisImp,
        unit_cofins_imp:  item.unitCofinsImp,
        unit_icms_gnre:   item.unitIcmsGnre,
      })
    }
    itemsProcessed++
  }

  if (itemRows.length > 0) {
    await db.from('import_items').insert(itemRows)
  }

  // Calcula landed cost + CMP automaticamente após importar os itens
  await recalculateLandedCost(order.id)

  return { orderId: order.id, itemsProcessed }
}
