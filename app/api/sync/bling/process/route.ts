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
import { blingGet } from '@/lib/integrations/bling'
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
  numeroPedidoLoja?: string | null  // Campo direto — sem parsear XML!
  xml?: string | null
  serie?: string | null
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

    // Estratégia 1: numeroPedidoLoja campo direto da API (ML, Shopee, Amazon)
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

    // Estratégia 2: infCpl do XML (fallback — cobre caso numeroPedidoLoja ausente)
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

    // Estratégia 3: data + valor (fallback final, ±1 dia p/ compat. com registros UTC antigos)
    if (!saleId && xml) {
      const vNF   = extractTag(xml, 'vNF')
      const dhEmi = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? ''
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
      const vNF2  = xml ? extractTag(xml, 'vNF') : 0
      const dhEmi2 = xml?.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? ''
      return NextResponse.json({
        ok: true, matched: false, reason: 'no_sale_match',
        debug: {
          numeroPedidoLoja,
          canal_xml: xml ? (extractStr(xml, 'infCpl') ?? '').slice(0, 100) : '(sem xml)',
          vNF: vNF2,
          dhEmi: dhEmi2,
        },
      })
    }

    // ── XML para impostos ─────────────────────────────────────────────────
    // /nfe/{id} não retorna o XML completo — busca separado só quando há match

    let xmlFull: string | null = xml  // usa xml do /nfe/{id} se disponível
    if (!xmlFull || !xmlFull.includes('<nfeProc') && !xmlFull.includes('<NFe')) {
      // XML não veio ou é uma URL — busca explicitamente
      try {
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe_id}/xml`, undefined, 0)
        xmlFull = xmlRes.data?.xml ?? null
      } catch {
        xmlFull = null  // sem impostos neste ciclo, tudo bem
      }
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

    await Promise.all([
      db.from('sales').update(updates).eq('id', saleId),
      db.from('sale_taxes').upsert({
        sale_id: saleId, nfe_key: chave,
        pis, cofins, icms, icms_difal: difal, ipi,
        // total_taxes NÃO incluído — é coluna GENERATED no Postgres (auto-calcula)
      }, { onConflict: 'sale_id' }),
    ])

    return NextResponse.json({ ok: true, matched: true, chave, numeroPedidoLoja })

  } catch (err) {
    return NextResponse.json({ ok: true, matched: false, reason: String(err) })
  }
}
