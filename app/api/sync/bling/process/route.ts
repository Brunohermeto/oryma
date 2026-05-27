/**
 * POST /api/sync/bling/process
 *
 * Fase 2: busca UMA NF-e completa e vincula à venda correspondente.
 *
 * MUDANÇA CHAVE: usa GET /nfe/{id} em vez de GET /nfe/{id}/xml
 * O endpoint /nfe/{id} retorna:
 *   - numeroPedidoLoja → campo direto (sem XML parsing, sem CDATA)
 *   - xml              → XML completo para extrair impostos
 *   - chaveAcesso, serie → campos diretos
 *
 * Estratégia de matching:
 *   1. numeroPedidoLoja (campo direto da API, testa ML / Shopee / Amazon)
 *   2. infCpl do XML (fallback se numeroPedidoLoja não disponível)
 *   3. data + valor (fallback final, ±1 dia para compat. com registros UTC)
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
  // Conteúdo direto
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  if (m) return m[1]
  // CDATA — infCpl frequentemente vem como <![CDATA[...]]>
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`))
  return cdata?.[1] ?? null
}

interface BlingNFeCompleta {
  id?: number
  chaveAcesso?: string | null
  numeroPedidoLoja?: string | null  // Código buyer-facing ML (alfanumérico)
  xml?: string | null               // Pode ser URL S3 ou XML raw
  serie?: string | null
  numero?: string | null
  dataEmissao?: string | null       // "YYYY-MM-DD HH:mm:ss" — campo direto, sem XML
  valorTotal?: number | null        // Valor total direto — sem XML
  contato?: {
    nome?: string | null
    email?: string | null
    cpfCnpj?: string | null
  } | null
  itens?: Array<{
    valor?: number | null
    quantidade?: number | null
    descricao?: string | null
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
    await sleep(200)  // respeita rate limit do Bling

    // Busca NF-e completa — retorna numeroPedidoLoja + xml + chaveAcesso em 1 chamada
    const nfeRes = await blingGet<{ data: BlingNFeCompleta }>(`/nfe/${nfe_id}`, undefined, 0)
    const nfeData = nfeRes.data

    if (!nfeData) {
      return NextResponse.json({ ok: true, matched: false, reason: 'no_data' })
    }

    const xml   = nfeData.xml ?? null
    const chave = nfe_chave_acesso ?? nfeData.chaveAcesso ?? null
    if (!chave) return NextResponse.json({ ok: true, matched: false, reason: 'no_chave' })

    // Verifica se já foi processada
    const { data: existingSale } = await db
      .from('sales').select('id').eq('nfe_saida_key', chave).limit(1)
    if (existingSale?.[0]) {
      return NextResponse.json({ ok: true, matched: false, reason: 'already_linked' })
    }

    // ── Matching ──────────────────────────────────────────────────────────

    let saleId: string | null = null
    const numeroPedidoLoja = nfeData.numeroPedidoLoja?.trim() ?? null

    // Estratégia 1a: numeroPedidoLoja campo direto (ID numérico ML/Shopee/Amazon)
    if (numeroPedidoLoja) {
      const prefixes = [
        `ml_${numeroPedidoLoja}`,
        `shopee_${numeroPedidoLoja}`,
        `amazon_${numeroPedidoLoja}`,
      ]
      for (const prefix of prefixes) {
        const { data } = await db.from('sales').select('id')
          .like('external_order_id', `${prefix}%`).limit(1)
        if (data?.[0]) { saleId = data[0].id; break }
      }
    }

    // Estratégia 1b: numeroPedidoLoja pode ser código alfanumérico buyer-facing do ML
    // ex: "260519RPR9AXGX" → extrai sufixo alfabético e tenta pack_id ou SKU match
    if (!saleId && numeroPedidoLoja) {
      // Tenta o sufixo alfabético (ex: "RPR9AXGX" de "260519RPR9AXGX")
      const alphaMatch = numeroPedidoLoja.match(/[A-Z][A-Z0-9]{5,}$/i)
      if (alphaMatch) {
        const suffix = alphaMatch[0]
        const { data } = await db.from('sales').select('id')
          .like('external_order_id', `%${suffix}%`).limit(1)
        saleId = data?.[0]?.id ?? null
      }
    }

    // Estratégia 2: infCpl do XML (cobre caso numeroPedidoLoja ausente)
    if (!saleId && xml) {
      const infCpl = extractStr(xml, 'infCpl') ?? ''
      const canalMatch = infCpl.match(/Canal:\s*(Mercado Livre|Shopee|Amazon)/i)
      const canal = canalMatch?.[1]?.toLowerCase().replace('mercado livre', 'mercado_livre') ?? null
      const pedidoMatch = infCpl.match(/Numero Pedido Loja:\s*([^\s]+)/i)
      const numeroPedido = pedidoMatch?.[1] ?? null

      if (canal && numeroPedido) {
        const prefix = canal === 'mercado_livre' ? `ml_${numeroPedido}` : `${canal}_${numeroPedido}`
        const { data } = await db.from('sales').select('id')
          .like('external_order_id', `${prefix}%`).limit(1)
        saleId = data?.[0]?.id ?? null
      }
    }

    // Estratégia 3: data + valor
    // Usa campos DIRETOS do Bling (dataEmissao, valorTotal, itens) antes de tentar XML
    // O XML pode ser uma URL S3 (não parseable), mas campos diretos sempre funcionam
    if (!saleId) {
      // Valor: campo direto valorTotal ou soma dos itens
      const vDireto = nfeData.valorTotal
        ?? (nfeData.itens ?? []).reduce((s, i) => s + Number(i.valor ?? 0), 0)
        ?? 0

      // Data: campo direto dataEmissao ou fallback para XML
      const dataDireta = nfeData.dataEmissao?.slice(0, 10) ?? null
      const dataXml    = xml?.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10)
                      ?? xml?.match(/<dEmi>([^<]+)<\/dEmi>/)?.[1]?.slice(0, 10)
                      ?? null
      const dhEmi = dataDireta ?? dataXml ?? null

      // Valor: fallback para XML se direto não disponível
      const vNF = vDireto > 0 ? vDireto
        : (xml?.includes('<') ? extractTag(xml, 'vNF') : 0)

      if (vNF > 0 && dhEmi) {
        const tol       = vNF * 0.02
        const d         = new Date(dhEmi)
        const dayBefore = new Date(d.getTime() - 86400000).toISOString().slice(0, 10)
        const dayAfter  = new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
        const { data }  = await db.from('sales').select('id')
          .gte('sale_date', dayBefore).lte('sale_date', dayAfter)
          .is('nfe_saida_key', null)
          .gte('gross_price', vNF - tol).lte('gross_price', vNF + tol).limit(1)
        saleId = data?.[0]?.id ?? null
      }
    }

    if (!saleId) {
      const vDiag  = nfeData.valorTotal ?? 0
      const dDiag  = nfeData.dataEmissao?.slice(0, 10) ?? ''
      const xmlIsUrl = xml ? !xml.includes('<') : false
      return NextResponse.json({
        ok: true, matched: false, reason: 'no_sale_match',
        debug: {
          numeroPedidoLoja,
          canal_xml: xml ? (extractStr(xml, 'infCpl') ?? '(vazio)').slice(0, 100) : '(sem xml)',
          xml_tipo: xml ? (xmlIsUrl ? 'url_s3' : 'xml_raw') : 'nulo',
          valorDireto: vDiag,
          dataDireta: dDiag,
          vNF: xml?.includes('<') ? extractTag(xml, 'vNF') : 0,
          dhEmi: xml?.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? '',
        },
      })
    }

    // ── XML para impostos ─────────────────────────────────────────────────
    // /nfe/{id} não retorna o XML completo — busca separado só quando há match

    // Baixa XML completo para extração de impostos
    // Tenta novo endpoint (março 2026) → fallback para endpoint antigo
    let xmlFull: string | null = null

    // Verifica se o xml do /nfe/{id} já é XML válido (não URL)
    if (xml && xml.includes('<')) {
      xmlFull = xml
    }

    if (!xmlFull && chave) {
      // Novo endpoint (mar/2026): retorna JSON { data[0].conteudo = base64(gzip(xml)) }
      try {
        xmlFull = await blingGetDocumentoXml(chave)
      } catch { xmlFull = null }
    }

    if (!xmlFull) {
      // Fallback: endpoint antigo GET /nfe/{id}/xml
      try {
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe_id}/xml`, undefined, 0)
        const candidate = xmlRes.data?.xml ?? null
        xmlFull = candidate && candidate.includes('<') ? candidate : null
      } catch { xmlFull = null }
    }

    const pis    = xmlFull ? extractTag(xmlFull, 'vPIS')    : 0
    const cofins = xmlFull ? extractTag(xmlFull, 'vCOFINS') : 0
    const icms   = xmlFull ? extractTag(xmlFull, 'vICMS')   : 0
    const difal  = xmlFull ? extractTag(xmlFull, 'vICMSUFDest') + extractTag(xmlFull, 'vICMSUFRemet') : 0
    const ipi    = xmlFull ? extractTag(xmlFull, 'vIPI')    : 0
    const frete  = xmlFull ? extractTag(xmlFull, 'vFrete')  : 0

    // ── Salva ─────────────────────────────────────────────────────────────

    const updates: Record<string, unknown> = { nfe_saida_key: chave }
    if (frete > 0) updates.marketplace_shipping_fee = frete

    // sale_taxes não tem UNIQUE constraint em sale_id — usa delete+insert
    await Promise.all([
      db.from('sales').update(updates).eq('id', saleId),
      db.from('sale_taxes').delete().eq('sale_id', saleId).then(() =>
        db.from('sale_taxes').insert({
          sale_id: saleId, nfe_key: chave,
          pis, cofins, icms, icms_difal: difal, ipi,
        })
      ),
    ])

    return NextResponse.json({ ok: true, matched: true, chave, numeroPedidoLoja })

  } catch (err) {
    return NextResponse.json({ ok: true, matched: false, reason: String(err) })
  }
}
