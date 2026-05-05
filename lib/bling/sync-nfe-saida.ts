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

// Séries válidas: 1, 2, 3 = NF-e ao consumidor | série 4xx = remessa Full ML/FBA (excluir)
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

/**
 * Extrai dados do campo "Dados Adicionais" (infCpl) da NF-e.
 * Exemplo: "Canal: Mercado Livre Numero Pedido Loja: 2000012748588981 Quem recebe: ..."
 * Exemplo: "Canal: Shopee Numero Pedido Loja: 260501A6ANR8A7 Quem recebe: ..."
 */
function parseInfoAdicionais(xml: string): { canal: string | null; numeroPedido: string | null } {
  const infCpl = extractStr(xml, 'infCpl') ?? ''

  const canalMatch = infCpl.match(/Canal:\s*(Mercado Livre|Shopee|Amazon)/i)
  const canal = canalMatch?.[1]?.toLowerCase()
    .replace('mercado livre', 'mercado_livre') ?? null

  const pedidoMatch = infCpl.match(/Numero Pedido Loja:\s*([^\s]+)/i)
  const numeroPedido = pedidoMatch?.[1] ?? null

  return { canal, numeroPedido }
}

/**
 * Tenta vincular a NF-e a uma venda pelo número do pedido do marketplace.
 * Usa .limit(1) em vez de .maybeSingle() para suportar pedidos com múltiplos itens
 * (ex: ml_ORDERID_ITEM1 e ml_ORDERID_ITEM2 — ambos têm o mesmo ORDERID).
 */
async function findSaleByOrderNumber(
  db: ReturnType<typeof import('@/lib/supabase/server').createSupabaseServiceClient>,
  canal: string,
  numeroPedido: string
): Promise<string | null> {
  const prefix = canal === 'mercado_livre' ? `ml_${numeroPedido}` : `${canal}_${numeroPedido}`

  const { data } = await db
    .from('sales')
    .select('id')
    .like('external_order_id', `${prefix}%`)
    .limit(1)

  return data?.[0]?.id ?? null
}

/**
 * maxItems: limite de NF-e a processar por rodada (evita timeout no Vercel)
 * - Manual: 100 (safe dentro de 60s)
 * - Cron:   500 (incremental — maioria já processada, poucas novas)
 */
export async function syncNFeSaida(startDate: string, endDate: string, maxItems = 100): Promise<number> {
  const db = createSupabaseServiceClient()
  let page = 1
  let synced = 0
  let processed = 0  // NF-e examinadas (incluindo as puladas por skip)

  // ── Pré-carrega chaves de NF-e já vinculadas ──────────────────────────────
  // Evita baixar o XML de NF-e já processadas — maior ganho de performance
  const { data: linked } = await db
    .from('sales')
    .select('nfe_saida_key')
    .not('nfe_saida_key', 'is', null)
  const linkedChaves = new Set((linked ?? []).map(s => s.nfe_saida_key as string))
  // ─────────────────────────────────────────────────────────────────────────

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

      // ── Atalho: se já temos a chave e ela já está vinculada, pula o XML ──
      if (nfe.chaveAcesso && linkedChaves.has(nfe.chaveAcesso)) continue

      // ── Limite de segurança: para não estourar o timeout do Vercel ──
      if (processed >= maxItems) break
      processed++

      try {
        await sleep(60)
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`)
        const xml = xmlRes.data?.xml
        if (!xml) continue

        // Chave de acesso
        const chave = nfe.chaveAcesso ?? xml.match(/<chNFe>([^<]+)<\/chNFe>/)?.[1] ?? null
        if (!chave) continue

        // Segunda checagem: chave extraída do XML pode já estar vinculada
        if (linkedChaves.has(chave)) continue

        // ── Impostos ──
        const pisTot    = extractTag(xml, 'vPIS')
        const cofinsTot = extractTag(xml, 'vCOFINS')
        const icmsTot   = extractTag(xml, 'vICMS')
        const difalTot  = extractTag(xml, 'vICMSUFDest') + extractTag(xml, 'vICMSUFRemet')
        const ipiTot    = extractTag(xml, 'vIPI')
        const freteTot  = extractTag(xml, 'vFrete')

        // ── Dados adicionais: canal + número do pedido ──
        const { canal, numeroPedido } = parseInfoAdicionais(xml)

        let saleId: string | null = null

        // Estratégia 1: matching pelo número do pedido na NF-e (mais preciso)
        if (canal && numeroPedido) {
          saleId = await findSaleByOrderNumber(db, canal, numeroPedido)
        }

        // Estratégia 2: matching pela chave NF-e já cadastrada
        if (!saleId) {
          const { data: saleByKey } = await db
            .from('sales')
            .select('id')
            .eq('nfe_saida_key', chave)
            .limit(1)
          saleId = saleByKey?.[0]?.id ?? null
        }

        // Estratégia 3: fallback por data + valor total (tolerância 2%)
        if (!saleId) {
          const vNF   = extractTag(xml, 'vNF')
          const dhEmi = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10)
            ?? nfe.dataEmissao.slice(0, 10)

          if (vNF > 0) {
            const tol = vNF * 0.02
            const { data: saleByVal } = await db
              .from('sales')
              .select('id')
              .eq('sale_date', dhEmi)
              .is('nfe_saida_key', null)
              .gte('gross_price', vNF - tol)
              .lte('gross_price', vNF + tol)
              .limit(1)
            saleId = saleByVal?.[0]?.id ?? null
          }
        }

        if (!saleId) continue

        // Vincula a chave NF-e à venda
        const updates: Record<string, unknown> = { nfe_saida_key: chave }
        if (freteTot > 0) updates.marketplace_shipping_fee = freteTot

        await db.from('sales').update(updates).eq('id', saleId)

        // Salva os impostos
        await db.from('sale_taxes').upsert({
          sale_id: saleId,
          nfe_key: chave,
          pis:        pisTot,
          cofins:     cofinsTot,
          icms:       icmsTot,
          icms_difal: difalTot,
          ipi:        ipiTot,
        }, { onConflict: 'sale_id' })

        // Adiciona ao set local para não processar novamente nesta mesma execução
        linkedChaves.add(chave)
        synced++
      } catch {
        continue
      }
    }

    if (list.data.length < 100) break
    if (processed >= maxItems) break  // atingiu o limite — para sem buscar mais páginas
    page++
  }

  return synced
}
