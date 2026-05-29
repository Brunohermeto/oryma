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

function resolveProductSku(cProd: string, xProd: string, blingIndex?: BlingProductIndex): string {
  // 1. Mapeamento direto pelo cProd (SKU_MAP tem precedência)
  if (SKU_MAP[cProd]) return SKU_MAP[cProd]

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
    const resolvedSku = resolveProductSku(item.cProd, item.xProd, blingIndex)

    // Busca o produto — cria automaticamente se não existir
    // (evita product_id=null que impede o cálculo de CMP)
    let { data: product } = await db.from('products').select('id').eq('sku', resolvedSku).maybeSingle()
    if (!product) {
      const { data: newProd } = await db
        .from('products')
        .insert({ sku: resolvedSku, name: item.xProd })
        .select('id')
        .maybeSingle()
      product = newProd
    }

    itemRows.push({
      import_order_id:  order.id,
      product_id:       product?.id ?? null,
      sku:              resolvedSku,
      description:      item.xProd,
      quantity:         item.qCom,
      unit_fob_value:   item.vUnCom,
      total_fob_value:  item.vProd,
      unit_ii:          item.unitII,
      unit_ipi:         item.unitIPI,
      unit_pis_imp:     item.unitPisImp,
      unit_cofins_imp:  item.unitCofinsImp,
      unit_icms_gnre:   item.unitIcmsGnre,
    })
    itemsProcessed++
  }

  if (itemRows.length > 0) {
    await db.from('import_items').insert(itemRows)
  }

  // Calcula landed cost + CMP automaticamente após importar os itens
  await recalculateLandedCost(order.id)

  return { orderId: order.id, itemsProcessed }
}
