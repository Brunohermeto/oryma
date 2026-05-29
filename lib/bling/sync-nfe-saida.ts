import { blingGet } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

interface BlingNFeSaidaItem {
  id: number
  numero: string
  serie: string
  dataEmissao: string
  situacao: { id: number }
  chaveAcesso: string | null
}

interface BlingNFeSaidaList {
  data: BlingNFeSaidaItem[]
}

interface MatchedNFe {
  saleIds: string[]   // pode ser >1 se pedido multi-item
  orderKey: string    // ex: "ml_2123456789"
  chave: string
  freteTot: number
  pis: number
  cofins: number
  icms: number
  difal: number
  ipi: number
  totalNfeValue: number
}

// Séries válidas: 1, 2, 3 = NF-e ao consumidor | série 4xx = remessa Full ML/FBA
function isSerieValida(serie: string): boolean {
  const n = Number(serie)
  if (isNaN(n)) return false
  return n < 100
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractTag(xml: string, tag: string): number {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  return parseFloat(m?.[1] ?? '0')
}

function extractStr(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  return m?.[1] ?? null
}

function parseInfoAdicionais(xml: string): { canal: string | null; numeroPedido: string | null } {
  const infCpl = extractStr(xml, 'infCpl') ?? ''
  const canalMatch = infCpl.match(/Canal:\s*(Mercado Livre|Shopee|Amazon)/i)
  const canal = canalMatch?.[1]?.toLowerCase().replace('mercado livre', 'mercado_livre') ?? null
  const pedidoMatch = infCpl.match(/Numero Pedido Loja:\s*([^\s]+)/i)
  const numeroPedido = pedidoMatch?.[1] ?? null
  return { canal, numeroPedido }
}

/**
 * Estratégia de performance:
 *
 * FASE 1 — 2 queries DB → pré-carrega tudo em memória
 *   - Chaves já vinculadas (para skip sem baixar XML)
 *   - Todas as vendas sem NF-e (para matching in-memory — sem queries por NF-e!)
 *
 * FASE 2 — Baixa XMLs e faz matching em memória (0 queries DB por NF-e)
 *   - 150ms sleep + ~200ms XML (GRU1 ↔ Bling BR) = ~350ms por NF-e
 *
 * FASE 3 — Salva tudo em 2 operações batch paralelas
 *   - Promise.all([sales upsert, tax upsert]) → ~150ms total
 *
 * Tempo total para 25 NF-e: ~250ms + 25×350ms + 150ms ≈ 9s (dentro do limite)
 */
export async function syncNFeSaida(startDate: string, endDate: string, maxItems = 25): Promise<number> {
  const db = createSupabaseServiceClient()

  // ── FASE 1: 2 queries para pré-carregar tudo ────────────────────────────

  // Carrega chaves já vinculadas (para skip imediato)
  const { data: linkedData } = await db.from('sales').select('nfe_saida_key').not('nfe_saida_key', 'is', null)
  const linkedChaves = new Set((linkedData ?? []).map(s => s.nfe_saida_key as string))

  // Carrega TODAS as vendas sem NF-e (paginado — sem esse fix só pega 1000 de ~3270)
  const unmatchedSales: Array<{ id: string; external_order_id: string; sale_date: string; gross_price: number }> = []
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error } = await db
      .from('sales')
      .select('id, external_order_id, sale_date, gross_price')
      .is('nfe_saida_key', null)
      .range(offset, offset + 999)
    if (error || !page?.length) break
    unmatchedSales.push(...page)
    if (page.length < 1000) break
  }

  // ── Estruturas de matching ────────────────────────────────────────────────

  // Mapa 1: "ml_ORDERID" → lista de sale_ids do mesmo pedido
  // (um pedido ML pode ter múltiplos itens = múltiplos sales rows)
  const orderSalesMap = new Map<string, { saleIds: string[]; totalValue: number; date: string }>()

  // Mapa 2: infCpl numeroPedido direto → primeiro sale_id
  const orderPrefixMap = new Map<string, string>()

  // Mapa 3: "YYYY-MM-DD" → [{ orderKey, totalValue }] para fallback por data+valor
  const dateOrderMap = new Map<string, Array<{ orderKey: string; totalValue: number }>>()

  for (const s of unmatchedSales) {
    const eid = s.external_order_id ?? ''

    // Extrai o prefixo "canal_ORDERID" (ex: "ml_2123456789")
    const firstUnderscore  = eid.indexOf('_')
    const secondUnderscore = eid.indexOf('_', firstUnderscore + 1)
    if (firstUnderscore <= 0 || secondUnderscore <= 0) continue

    const orderKey = eid.slice(0, secondUnderscore)  // ex: "ml_2123456789"

    // Agrupa sales do mesmo pedido (value = soma para pedidos multi-item)
    if (!orderSalesMap.has(orderKey)) {
      orderSalesMap.set(orderKey, { saleIds: [], totalValue: 0, date: s.sale_date })
    }
    orderSalesMap.get(orderKey)!.saleIds.push(s.id)
    orderSalesMap.get(orderKey)!.totalValue += Number(s.gross_price ?? 0)

    // Índice para Strategy 1 (numeroPedido numérico)
    if (!orderPrefixMap.has(orderKey)) orderPrefixMap.set(orderKey, s.id)
  }

  // Constrói mapa de data → pedidos (para Strategy 2: data+valor do pedido total)
  for (const [orderKey, info] of orderSalesMap) {
    const date = info.date
    if (!dateOrderMap.has(date)) dateOrderMap.set(date, [])
    dateOrderMap.get(date)!.push({ orderKey, totalValue: info.totalValue })
  }

  // ── FASE 2: Baixar XMLs e matching in-memory ─────────────────────────────

  const matches: MatchedNFe[] = []
  let page = 1
  let processed = 0

  while (true) {
    // retries=1: máximo 1 segundo de espera em rate limit (não 7s com retries=3)
    const list = await blingGet<BlingNFeSaidaList>('/nfe', {
      pagina: String(page),
      limite: '100',
      dataEmissaoInicio: startDate,
      dataEmissaoFim: endDate,
    }, 1)

    if (!list.data?.length) break

    for (const nfe of list.data) {
      if (!isSerieValida(nfe.serie)) continue
      // Skip imediato se chave já conhecida (sem baixar XML)
      if (nfe.chaveAcesso && linkedChaves.has(nfe.chaveAcesso)) continue

      if (processed >= maxItems) break
      processed++

      try {
        await sleep(200)
        // retries=0: se der 429, pula este NF-e (será processado na próxima rodada)
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`, undefined, 0)
        const xml = xmlRes.data?.xml
        if (!xml) continue

        const chave = nfe.chaveAcesso ?? xml.match(/<chNFe>([^<]+)<\/chNFe>/)?.[1] ?? null
        if (!chave || linkedChaves.has(chave)) continue

        // Impostos
        const pis    = extractTag(xml, 'vPIS')
        const cofins = extractTag(xml, 'vCOFINS')
        const icms   = extractTag(xml, 'vICMS')
        const difal  = extractTag(xml, 'vICMSUFDest') + extractTag(xml, 'vICMSUFRemet')
        const ipi    = extractTag(xml, 'vIPI')
        const frete  = extractTag(xml, 'vFrete')

        // ── Matching in-memory ────────────────────────────────────────────
        let matchedOrderKey: string | null = null

        // Estratégia 1: numeroPedido numérico do infCpl → "canal_ORDERID"
        const { canal, numeroPedido } = parseInfoAdicionais(xml)
        if (canal && numeroPedido) {
          const key = canal === 'mercado_livre' ? `ml_${numeroPedido}` : `${canal}_${numeroPedido}`
          if (orderSalesMap.has(key)) matchedOrderKey = key
        }

        // Estratégia 2: data + valor total do pedido com tolerância ±2 dias
        // Compara vNF (total da NF) com a SOMA dos itens do pedido — cobre multi-item
        if (!matchedOrderKey) {
          const vNF   = extractTag(xml, 'vNF')
          const dhEmi = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10)
                     ?? nfe.dataEmissao.slice(0, 10)
          if (vNF > 0 && dhEmi) {
            const tol = vNF * 0.05  // 5% tolerância (inclui frete variação)
            const datesToTry = [dhEmi]
            const baseDate = new Date(dhEmi + 'T12:00:00Z')
            for (let d = 1; d <= 3; d++) {
              datesToTry.push(
                new Date(baseDate.getTime() - d * 86400000).toISOString().slice(0, 10),
                new Date(baseDate.getTime() + d * 86400000).toISOString().slice(0, 10),
              )
            }
            for (const tryDate of datesToTry) {
              const candidates = dateOrderMap.get(tryDate) ?? []
              const found = candidates.find(c =>
                c.totalValue >= vNF - tol && c.totalValue <= vNF + tol
              )
              if (found) { matchedOrderKey = found.orderKey; break }
            }
          }
        }

        if (!matchedOrderKey) continue
        const orderInfo = orderSalesMap.get(matchedOrderKey)
        if (!orderInfo) continue

        const vNF = extractTag(xml, 'vNF')
        matches.push({
          saleIds: orderInfo.saleIds,
          orderKey: matchedOrderKey,
          chave,
          freteTot: frete, pis, cofins, icms, difal, ipi,
          totalNfeValue: vNF,
        })

        // Marca como usado para evitar double-match na mesma rodada
        linkedChaves.add(chave)
        orderSalesMap.delete(matchedOrderKey)
        // Remove do dateOrderMap também
        for (const [, list] of dateOrderMap) {
          const idx = list.findIndex(c => c.orderKey === matchedOrderKey)
          if (idx >= 0) { list.splice(idx, 1); break }
        }
      } catch {
        continue
      }
    }

    if (list.data.length < 100) break
    if (processed >= maxItems) break
    page++
  }

  if (matches.length === 0) return 0

  // ── FASE 3: Distribui impostos por item e salva em batch ─────────────────
  // Para pedidos multi-item, os impostos da NF são rateados proporcionalmente
  // ao gross_price de cada item.

  const salesRows: Array<{ id: string; nfe_saida_key: string; marketplace_shipping_fee?: number }> = []
  const taxRows:   Array<{ sale_id: string; nfe_key: string; pis: number; cofins: number; icms: number; icms_difal: number; ipi: number }> = []

  // Busca gross_price dos sales para calcular proporção
  const allSaleIds = matches.flatMap(m => m.saleIds)
  const { data: saleValues } = await db
    .from('sales').select('id, gross_price')
    .in('id', allSaleIds)
  const salePriceMap = Object.fromEntries((saleValues ?? []).map(s => [s.id, Number(s.gross_price ?? 0)]))

  for (const m of matches) {
    const totalOrderValue = m.saleIds.reduce((s, id) => s + (salePriceMap[id] ?? 0), 0)
    const n = m.saleIds.length

    for (const saleId of m.saleIds) {
      const share = totalOrderValue > 0 ? (salePriceMap[saleId] ?? 0) / totalOrderValue : 1 / n

      salesRows.push({
        id: saleId,
        nfe_saida_key: m.chave,
        ...(m.freteTot > 0 ? { marketplace_shipping_fee: m.freteTot * share } : {}),
      })

      taxRows.push({
        sale_id:    saleId,
        nfe_key:    m.chave,
        pis:        m.pis    * share,
        cofins:     m.cofins * share,
        icms:       m.icms   * share,
        icms_difal: m.difal  * share,
        ipi:        m.ipi    * share,
      })
    }
  }

  // Salva em batch paralelo
  await Promise.all([
    db.from('sales').upsert(salesRows, { onConflict: 'id' }),
    db.from('sale_taxes').upsert(taxRows, { onConflict: 'sale_id' }),
  ])

  return matches.length
}
