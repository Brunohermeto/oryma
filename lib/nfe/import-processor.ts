import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'
import type { ParsedNFe } from './parser'

// SKU_MAP: mapeia código do produto na NF-e → SKU interno
// Cobre tanto os cProd (ex: RAGA001-C) quanto descrições (ex: GRAY-3038)
const SKU_MAP: Record<string, string> = {
  'RAGA001-C': 'RAGA001-C', 'RAGA001-R': 'RAGA001-R',
  'RAGA001-A': 'RAGA001-A', 'RAGA001-B': 'RAGA001-B',
  'GRAY-3038':  'RAGA001-C', 'PINK-3021':  'RAGA001-R',
  'BLUE-3034':  'RAGA001-A', 'BEIGE-3045': 'RAGA001-B',
  'LUPPA':      'RAGA002',
  'MUB004':     'RAGA003', 'BEDSIDE': 'RAGA003',
  'MUC101':     'RAGA004',
}

function resolveProductSku(cProd: string, xProd: string): string {
  if (SKU_MAP[cProd]) return SKU_MAP[cProd]
  const upper = xProd.toUpperCase()
  for (const [key, sku] of Object.entries(SKU_MAP)) {
    if (upper.includes(key.toUpperCase())) return sku
  }
  return cProd
}

export async function processImportNFe(
  nfe: ParsedNFe,
  storagePath: string | null
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
    const resolvedSku = resolveProductSku(item.cProd, item.xProd)
    const { data: product } = await db.from('products').select('id').eq('sku', resolvedSku).maybeSingle()

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
