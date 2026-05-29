/**
 * POST /api/sync/bling/process
 *
 * Fase 2: busca UMA NF-e do Bling e vincula à(s) venda(s) correspondente(s).
 *
 * Estratégias de matching (em cascata):
 *   1a. numeroPedidoLoja numérico → ml/shopee/amazon_{id}
 *   1b. numeroPedidoLoja alfanumérico → sufixo no external_order_id
 *   2.  infCpl do XML (Canal + Numero Pedido Loja)
 *   3.  data ±3 dias + soma do pedido ±5% (multi-item safe)
 *       Agrupa sales pelo ML order ID e compara o total do pedido com vNF
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGet, blingGetDocumentoXml } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractTag(xml: string, tag: string): number {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  return parseFloat(m?.[1] ?? '0')
}

function extractStr(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  if (m) return m[1]
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`))
  return cdata?.[1] ?? null
}

interface BlingNFeCompleta {
  id?: number
  chaveAcesso?: string | null
  numeroPedidoLoja?: string | null
  xml?: string | null
  serie?: string | null
  numero?: string | null
  dataEmissao?: string | null
  valorTotal?: number | null      // campo antigo
  valor?: number | null           // campo alternativo
  totais?: {                      // campo correto na API atual
    vNF?: number | null
    vProd?: number | null
    vICMS?: number | null
    vPIS?: number | null
    vCOFINS?: number | null
    vIPI?: number | null
    vFrete?: number | null
    vICMSUFDest?: number | null
    vICMSUFRemet?: number | null
  } | null
  contato?: { nome?: string | null; cpfCnpj?: string | null } | null
  itens?: Array<{
    valor?: number | null
    quantidade?: number | null
    descricao?: string | null
    codigo?: string | null
  }> | null
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { nfe_id, nfe_chave_acesso } = await request.json() as {
    nfe_id: number
    nfe_chave_acesso?: string | null
  }

  const db = createSupabaseServiceClient()

  try {
    await sleep(200)

    const nfeRes  = await blingGet<{ data: BlingNFeCompleta }>(`/nfe/${nfe_id}`, undefined, 0)
    const nfeData = nfeRes.data
    if (!nfeData) return NextResponse.json({ ok: true, matched: false, reason: 'no_data' })

    const xml   = nfeData.xml ?? null
    const chave = nfe_chave_acesso ?? nfeData.chaveAcesso ?? null
    if (!chave) return NextResponse.json({ ok: true, matched: false, reason: 'no_chave' })

    const { data: existingSale } = await db.from('sales').select('id').eq('nfe_saida_key', chave).limit(1)
    if (existingSale?.[0]) return NextResponse.json({ ok: true, matched: false, reason: 'already_linked' })

    // Extrai valor total da NF-e de várias fontes possíveis
    const vNFDirect =
      Number(nfeData.totais?.vNF   ?? 0) ||
      Number(nfeData.totais?.vProd ?? 0) ||
      Number(nfeData.valorTotal    ?? 0) ||
      Number(nfeData.valor         ?? 0) ||
      (nfeData.itens ?? []).reduce((s, i) => s + Number(i.valor ?? 0), 0)

    // Data de emissão direta da API (não depende de XML)
    const dhEmiDirect = nfeData.dataEmissao?.slice(0, 10) ?? null

    // ── Matching ─────────────────────────────────────────────────────────────

    let saleId: string | null = null
    let matchedSaleIds: string[] = []  // pode ser >1 para pedidos multi-item
    const numeroPedidoLoja = nfeData.numeroPedidoLoja?.trim() ?? null

    // Estratégia 1a: numeroPedidoLoja numérico direto
    if (numeroPedidoLoja) {
      for (const canal of ['ml', 'shopee', 'amazon']) {
        const { data } = await db.from('sales').select('id, external_order_id')
          .like('external_order_id', `${canal}_${numeroPedidoLoja}_%`).limit(1)
        if (data?.[0]) {
          saleId = data[0].id
          // Busca todos os itens do mesmo pedido
          const orderMatch = data[0].external_order_id?.match(new RegExp(`^${canal}_(\\d+)_`))
          if (orderMatch) {
            const { data: orderItems } = await db.from('sales').select('id')
              .like('external_order_id', `${canal}_${orderMatch[1]}_%`)
              .is('nfe_saida_key', null)
            matchedSaleIds = (orderItems ?? []).map(s => s.id)
          }
          if (!matchedSaleIds.length) matchedSaleIds = [saleId]
          break
        }
      }
    }

    // Estratégia 1b: sufixo alfanumérico do numeroPedidoLoja
    if (!saleId && numeroPedidoLoja) {
      const alphaMatch = numeroPedidoLoja.match(/[A-Z][A-Z0-9]{5,}$/i)
      if (alphaMatch) {
        const suffix = alphaMatch[0]
        const { data } = await db.from('sales').select('id')
          .like('external_order_id', `%${suffix}%`).is('nfe_saida_key', null).limit(1)
        if (data?.[0]) { saleId = data[0].id; matchedSaleIds = [saleId] }
      }
    }

    // Estratégia 2: infCpl do XML
    if (!saleId && xml && xml.includes('<')) {
      const infCpl = extractStr(xml, 'infCpl') ?? ''
      const canalMatch  = infCpl.match(/Canal:\s*(Mercado Livre|Shopee|Amazon)/i)
      const canal       = canalMatch?.[1]?.toLowerCase().replace('mercado livre', 'mercado_livre') ?? null
      const pedidoMatch = infCpl.match(/Numero Pedido Loja:\s*([^\s]+)/i)
      const numeroPedido = pedidoMatch?.[1] ?? null
      if (canal && numeroPedido) {
        const { data } = await db.from('sales').select('id')
          .like('external_order_id', `${canal}_${numeroPedido}_%`).limit(1)
        if (data?.[0]) { saleId = data[0].id; matchedSaleIds = [saleId] }
      }
    }

    // Estratégia 3: data ±3 dias + soma do pedido ±5% (multi-item safe)
    if (!saleId) {
      // Usa dados diretos da API (não depende de XML)
      const vNF   = vNFDirect > 0 ? vNFDirect : (xml?.includes('<') ? extractTag(xml, 'vNF') : 0)
      const dhEmi = dhEmiDirect ?? xml?.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10)

      if (vNF > 0 && dhEmi) {
        const tol      = vNF * 0.05
        const base     = new Date(dhEmi + 'T12:00:00Z')
        const dayFrom  = new Date(base.getTime() - 3 * 86400000).toISOString().slice(0, 10)
        const dayTo    = new Date(base.getTime() + 3 * 86400000).toISOString().slice(0, 10)

        // Busca vendas sem NF-e na janela de ±3 dias
        const { data: windowSales } = await db.from('sales')
          .select('id, external_order_id, gross_price, marketplace')
          .gte('sale_date', dayFrom).lte('sale_date', dayTo)
          .is('nfe_saida_key', null)

        // Agrupa por pedido (ml_ORDERID ou shopee_ORDERID, etc.)
        const orderMap = new Map<string, { saleIds: string[]; total: number }>()
        for (const s of (windowSales ?? [])) {
          const eid   = s.external_order_id ?? ''
          const parts = eid.split('_')
          if (parts.length < 2) continue
          const orderKey = `${parts[0]}_${parts[1]}`
          if (!orderMap.has(orderKey)) orderMap.set(orderKey, { saleIds: [], total: 0 })
          orderMap.get(orderKey)!.saleIds.push(s.id)
          orderMap.get(orderKey)!.total += Number(s.gross_price ?? 0)
        }

        // Encontra pedido cujo total ≈ vNF
        for (const [, order] of orderMap) {
          if (order.total >= vNF - tol && order.total <= vNF + tol) {
            saleId         = order.saleIds[0]
            matchedSaleIds = order.saleIds
            break
          }
        }
      }
    }

    if (!saleId || !matchedSaleIds.length) {
      return NextResponse.json({
        ok: true, matched: false, reason: 'no_sale_match',
        debug: {
          numeroPedidoLoja,
          canal_xml:   xml?.includes('<') ? (extractStr(xml, 'infCpl') ?? '(vazio)').slice(0, 100) : '(url_s3 ou nulo)',
          vNF:         vNFDirect,
          dhEmi:       dhEmiDirect,
          xml_tipo:    xml ? (xml.includes('<') ? 'xml_raw' : 'url_s3') : 'nulo',
        },
      })
    }

    // ── Busca XML para impostos (só após match confirmado) ────────────────────

    let xmlFull: string | null = null

    // 1. Tenta impostos direto dos totais da API (sem XML)
    const pisDirect    = Number(nfeData.totais?.vPIS           ?? 0)
    const cofinsDirect = Number(nfeData.totais?.vCOFINS        ?? 0)
    const icmsDirect   = Number(nfeData.totais?.vICMS          ?? 0)
    const difalDirect  = Number(nfeData.totais?.vICMSUFDest    ?? 0)
                       + Number(nfeData.totais?.vICMSUFRemet   ?? 0)
    const ipiDirect    = Number(nfeData.totais?.vIPI           ?? 0)
    const freteDirect  = Number(nfeData.totais?.vFrete         ?? 0)

    const hasTotaisData = pisDirect + cofinsDirect + icmsDirect + ipiDirect > 0

    // 2. Se totais não tem impostos, tenta baixar XML
    if (!hasTotaisData) {
      if (xml && xml.includes('<')) xmlFull = xml
      if (!xmlFull && chave) {
        try { xmlFull = await blingGetDocumentoXml(chave) } catch { xmlFull = null }
      }
      if (!xmlFull) {
        try {
          const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe_id}/xml`, undefined, 0)
          const candidate = xmlRes.data?.xml ?? null
          xmlFull = candidate && candidate.includes('<') ? candidate : null
        } catch { xmlFull = null }
      }
    }

    const pis    = hasTotaisData ? pisDirect    : (xmlFull ? extractTag(xmlFull, 'vPIS')         : 0)
    const cofins = hasTotaisData ? cofinsDirect : (xmlFull ? extractTag(xmlFull, 'vCOFINS')      : 0)
    const icms   = hasTotaisData ? icmsDirect   : (xmlFull ? extractTag(xmlFull, 'vICMS')        : 0)
    const difal  = hasTotaisData ? difalDirect  : (xmlFull ? extractTag(xmlFull, 'vICMSUFDest') + extractTag(xmlFull, 'vICMSUFRemet') : 0)
    const ipi    = hasTotaisData ? ipiDirect    : (xmlFull ? extractTag(xmlFull, 'vIPI')         : 0)
    const frete  = hasTotaisData ? freteDirect  : (xmlFull ? extractTag(xmlFull, 'vFrete')       : 0)

    // ── Salva para todos os sales do pedido (distribuição proporcional) ──────

    // Busca valores dos sales para calcular proporção
    const { data: saleValues } = await db.from('sales').select('id, gross_price').in('id', matchedSaleIds)
    const salePriceMap = Object.fromEntries((saleValues ?? []).map(s => [s.id, Number(s.gross_price ?? 0)]))
    const totalOrder   = matchedSaleIds.reduce((sum, id) => sum + (salePriceMap[id] ?? 0), 0)
    const n            = matchedSaleIds.length

    const salesUpdates = matchedSaleIds.map(id => {
      const share = totalOrder > 0 ? (salePriceMap[id] ?? 0) / totalOrder : 1 / n
      return {
        id,
        nfe_saida_key: chave,
        ...(frete > 0 ? { marketplace_shipping_fee: frete * share } : {}),
      }
    })

    const taxRows = matchedSaleIds.map(id => {
      const share = totalOrder > 0 ? (salePriceMap[id] ?? 0) / totalOrder : 1 / n
      return {
        sale_id:    id,
        nfe_key:    chave,
        pis:        pis    * share,
        cofins:     cofins * share,
        icms:       icms   * share,
        icms_difal: difal  * share,
        ipi:        ipi    * share,
      }
    })

    await Promise.all([
      db.from('sales').upsert(salesUpdates, { onConflict: 'id' }),
      db.from('sale_taxes').delete().in('sale_id', matchedSaleIds).then(() =>
        db.from('sale_taxes').insert(taxRows)
      ),
    ])

    return NextResponse.json({
      ok: true, matched: true, chave, numeroPedidoLoja,
      sales_updated: matchedSaleIds.length,
    })

  } catch (err) {
    return NextResponse.json({ ok: true, matched: false, reason: String(err) })
  }
}
