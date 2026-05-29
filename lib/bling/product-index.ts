/**
 * Busca o catálogo completo de produtos do Bling e constrói índices de lookup.
 *
 * Cada produto Bling tem:
 *  - codigo          → SKU interno (ex: RAGA002-C)
 *  - codigoFabricante → código do fornecedor na NF-e (ex: LUPPA-GRAY, MUB004-CZ)
 *  - gtin            → EAN/barcode (ex: 7908488105732)
 *  - nome            → nome do produto
 *
 * O index permite resolver qualquer desses campos → SKU interno correto.
 */
import { blingGet } from '@/lib/integrations/bling'

export interface BlingProductEntry {
  codigo: string
  nome: string
  codigoFabricante?: string
  gtin?: string
}

export interface BlingProductIndex {
  /** Todos os produtos, indexados pelo código interno (SKU) */
  byCodigo: Record<string, BlingProductEntry>
  /** código do fabricante → SKU interno */
  byFabricante: Record<string, string>
  /** GTIN/EAN → SKU interno */
  byGtin: Record<string, string>
  /** total de produtos no catálogo */
  total: number
}

interface BlingProductsResponse {
  data: Array<{
    id: number
    nome: string
    codigo: string
    codigoFabricante?: string
    gtin?: string
  }>
}

export async function buildBlingProductIndex(): Promise<BlingProductIndex> {
  const index: BlingProductIndex = {
    byCodigo: {},
    byFabricante: {},
    byGtin: {},
    total: 0,
  }

  let page = 1
  const limit = 100

  while (true) {
    const res = await blingGet<BlingProductsResponse>('/produtos', {
      pagina: String(page),
      limite: String(limit),
    })
    const items = res?.data ?? []
    if (!items.length) break

    for (const p of items) {
      const codigo = p.codigo?.trim()
      if (!codigo) continue

      const entry: BlingProductEntry = {
        codigo,
        nome: p.nome ?? '',
        codigoFabricante: p.codigoFabricante?.trim() || undefined,
        gtin: p.gtin?.trim() || undefined,
      }

      index.byCodigo[codigo] = entry

      if (entry.codigoFabricante) {
        index.byFabricante[entry.codigoFabricante] = codigo
      }
      if (entry.gtin && entry.gtin !== '0' && entry.gtin.length >= 8) {
        index.byGtin[entry.gtin] = codigo
      }
    }

    index.total += items.length
    if (items.length < limit) break
    page++
    if (page > 50) break // segurança: máx 5000 produtos
  }

  return index
}

/**
 * Resolve o SKU interno a partir de qualquer código que apareça em uma NF-e.
 * Ordem de prioridade:
 *   1. Match exato no codigo (SKU interno)
 *   2. Match via codigoFabricante
 *   3. Match via gtin/EAN
 *   4. null (não encontrado no catálogo)
 */
export function resolveSkuFromBling(
  code: string,
  index: BlingProductIndex
): string | null {
  const c = code?.trim()
  if (!c) return null

  // 1. Código direto (já é o SKU interno)
  if (index.byCodigo[c]) return c

  // 2. Código do fabricante
  if (index.byFabricante[c]) return index.byFabricante[c]

  // 3. EAN/GTIN
  if (index.byGtin[c]) return index.byGtin[c]

  return null
}
