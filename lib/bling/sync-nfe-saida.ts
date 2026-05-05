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
  saleId: string
  chave: string
  freteTot: number
  pis: number
  cofins: number
  icms: number
  difal: number
  ipi: number
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

  const [linkedResult, unmatchedResult] = await Promise.all([
    db.from('sales').select('nfe_saida_key').not('nfe_saida_key', 'is', null),
    db.from('sales').select('id, external_order_id, sale_date, gross_price').is('nfe_saida_key', null),
  ])

  // Set de chaves já vinculadas — skip imediato sem baixar XML
  const linkedChaves = new Set((linkedResult.data ?? []).map(s => s.nfe_saida_key as string))

  // Mapa para matching por número do pedido: "ml_ORDERID" → sale_id
  const orderPrefixMap = new Map<string, string>()
  // Mapa para matching por data+valor: "YYYY-MM-DD" → [{id, gross_price}]
  const dateValueMap = new Map<string, Array<{ id: string; gross_price: number }>>()

  for (const s of (unmatchedResult.data ?? [])) {
    // external_order_id = "ml_ORDERID_ITEMID" ou "shopee_ORDERID_SKU"
    // Prefixo = "canal_orderId" (primeiros 2 componentes separados por _)
    const firstUnderscore = s.external_order_id.indexOf('_')
    const secondUnderscore = s.external_order_id.indexOf('_', firstUnderscore + 1)
    if (firstUnderscore > 0 && secondUnderscore > 0) {
      const prefix = s.external_order_id.slice(0, secondUnderscore)
      if (!orderPrefixMap.has(prefix)) orderPrefixMap.set(prefix, s.id)
    }

    const date = s.sale_date
    if (!dateValueMap.has(date)) dateValueMap.set(date, [])
    dateValueMap.get(date)!.push({ id: s.id, gross_price: Number(s.gross_price) })
  }

  // ── FASE 2: Baixar XMLs e matching in-memory ─────────────────────────────

  const matches: MatchedNFe[] = []
  let page = 1
  let processed = 0

  while (true) {
    const list = await blingGet<BlingNFeSaidaList>('/nfe', {
      pagina: String(page),
      limite: '100',
      dataEmissaoInicio: startDate,
      dataEmissaoFim: endDate,
    })

    if (!list.data?.length) break

    for (const nfe of list.data) {
      if (!isSerieValida(nfe.serie)) continue
      // Skip imediato se chave já conhecida (sem baixar XML)
      if (nfe.chaveAcesso && linkedChaves.has(nfe.chaveAcesso)) continue

      if (processed >= maxItems) break
      processed++

      try {
        await sleep(150)
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`)
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

        // ── Matching in-memory (sem queries DB) ──
        let saleId: string | null = null

        // Estratégia 1: número do pedido na NF-e
        const { canal, numeroPedido } = parseInfoAdicionais(xml)
        if (canal && numeroPedido) {
          const prefix = canal === 'mercado_livre' ? `ml_${numeroPedido}` : `${canal}_${numeroPedido}`
          saleId = orderPrefixMap.get(prefix) ?? null
        }

        // Estratégia 2: data + valor (fallback)
        if (!saleId) {
          const vNF   = extractTag(xml, 'vNF')
          const dhEmi = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? nfe.dataEmissao.slice(0, 10)
          if (vNF > 0) {
            const tol = vNF * 0.02
            const candidates = dateValueMap.get(dhEmi) ?? []
            const found = candidates.find(c => c.gross_price >= vNF - tol && c.gross_price <= vNF + tol)
            saleId = found?.id ?? null
          }
        }

        if (!saleId) continue

        matches.push({ saleId, chave, freteTot: frete, pis, cofins, icms, difal, ipi })

        // Marca como usada localmente para evitar double-match na mesma rodada
        linkedChaves.add(chave)
        // Remove da lista de candidatos para matching futuro
        orderPrefixMap.forEach((v, k) => { if (v === saleId) orderPrefixMap.delete(k) })
      } catch {
        continue
      }
    }

    if (list.data.length < 100) break
    if (processed >= maxItems) break
    page++
  }

  if (matches.length === 0) return 0

  // ── FASE 3: Salva tudo em batch paralelo (2 operações DB totais) ─────────

  const withFrete  = matches.filter(m => m.freteTot > 0)
  const withoutFrete = matches.filter(m => m.freteTot === 0)

  await Promise.all([
    // Sales: upsert batch por frete (evita sobrescrever com null)
    withFrete.length > 0
      ? db.from('sales').upsert(
          withFrete.map(m => ({ id: m.saleId, nfe_saida_key: m.chave, marketplace_shipping_fee: m.freteTot })),
          { onConflict: 'id' }
        )
      : Promise.resolve(),

    withoutFrete.length > 0
      ? db.from('sales').upsert(
          withoutFrete.map(m => ({ id: m.saleId, nfe_saida_key: m.chave })),
          { onConflict: 'id' }
        )
      : Promise.resolve(),

    // Impostos: upsert batch (1 operação para todos)
    db.from('sale_taxes').upsert(
      matches.map(m => ({
        sale_id:    m.saleId,
        nfe_key:    m.chave,
        pis:        m.pis,
        cofins:     m.cofins,
        icms:       m.icms,
        icms_difal: m.difal,
        ipi:        m.ipi,
      })),
      { onConflict: 'sale_id' }
    ),
  ])

  return matches.length
}
