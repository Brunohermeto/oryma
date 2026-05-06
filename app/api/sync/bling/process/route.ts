/**
 * POST /api/sync/bling/process
 *
 * Fase 2: baixa o XML de UMA NF-e e vincula à venda correspondente.
 * Tempo: ~400ms (200ms sleep + 200ms XML + 50ms DB)
 * Nunca vai estourar o limite do Vercel.
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
  // Tenta conteúdo direto primeiro
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  if (m) return m[1]
  // Tenta CDATA — infCpl frequentemente vem dentro de <![CDATA[...]]>
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`))
  return cdata?.[1] ?? null
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

    // Baixa o XML — retries=0 (se falhar, pula; será tentado na próxima rodada)
    const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe_id}/xml`, undefined, 0)
    const xml = xmlRes.data?.xml
    if (!xml) return NextResponse.json({ ok: true, matched: false, reason: 'no_xml' })

    // Chave de acesso
    const chave = nfe_chave_acesso ?? xml.match(/<chNFe>([^<]+)<\/chNFe>/)?.[1] ?? null
    if (!chave) return NextResponse.json({ ok: true, matched: false, reason: 'no_chave' })

    // Verifica se já foi processada
    const { data: existingSale } = await db
      .from('sales').select('id').eq('nfe_saida_key', chave).limit(1)
    if (existingSale?.[0]) return NextResponse.json({ ok: true, matched: false, reason: 'already_linked' })

    // Impostos
    const pis    = extractTag(xml, 'vPIS')
    const cofins = extractTag(xml, 'vCOFINS')
    const icms   = extractTag(xml, 'vICMS')
    const difal  = extractTag(xml, 'vICMSUFDest') + extractTag(xml, 'vICMSUFRemet')
    const ipi    = extractTag(xml, 'vIPI')
    const frete  = extractTag(xml, 'vFrete')

    // Matching: canal + número do pedido
    const infCpl = extractStr(xml, 'infCpl') ?? ''
    const canalMatch = infCpl.match(/Canal:\s*(Mercado Livre|Shopee|Amazon)/i)
    const canal = canalMatch?.[1]?.toLowerCase().replace('mercado livre', 'mercado_livre') ?? null
    const pedidoMatch = infCpl.match(/Numero Pedido Loja:\s*([^\s]+)/i)
    const numeroPedido = pedidoMatch?.[1] ?? null

    let saleId: string | null = null

    // Estratégia 1: número do pedido
    if (canal && numeroPedido) {
      const prefix = canal === 'mercado_livre' ? `ml_${numeroPedido}` : `${canal}_${numeroPedido}`
      const { data } = await db.from('sales').select('id').like('external_order_id', `${prefix}%`).limit(1)
      saleId = data?.[0]?.id ?? null
    }

    // Estratégia 2: data + valor (fallback)
    // Busca ±1 dia para compatibilidade com registros antigos gravados em UTC
    if (!saleId) {
      const vNF   = extractTag(xml, 'vNF')
      const dhEmi = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? ''
      if (vNF > 0 && dhEmi) {
        const tol = vNF * 0.02
        const d = new Date(dhEmi)
        const dayBefore = new Date(d.getTime() - 86400000).toISOString().slice(0, 10)
        const dayAfter  = new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
        const { data } = await db.from('sales').select('id')
          .gte('sale_date', dayBefore).lte('sale_date', dayAfter)
          .is('nfe_saida_key', null)
          .gte('gross_price', vNF - tol).lte('gross_price', vNF + tol).limit(1)
        saleId = data?.[0]?.id ?? null
      }
    }

    if (!saleId) {
      const vNF2  = extractTag(xml, 'vNF')
      const dhEmi2 = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? ''
      return NextResponse.json({
        ok: true, matched: false, reason: 'no_sale_match',
        debug: { infCpl: infCpl.slice(0, 200), canal, numeroPedido, vNF: vNF2, dhEmi: dhEmi2 },
      })
    }

    // Salva em paralelo
    const updates: Record<string, unknown> = { nfe_saida_key: chave }
    if (frete > 0) updates.marketplace_shipping_fee = frete

    await Promise.all([
      db.from('sales').update(updates).eq('id', saleId),
      db.from('sale_taxes').upsert({
        sale_id: saleId, nfe_key: chave,
        pis, cofins, icms, icms_difal: difal, ipi,
      }, { onConflict: 'sale_id' }),
    ])

    return NextResponse.json({ ok: true, matched: true, chave })
  } catch (err) {
    return NextResponse.json({ ok: true, matched: false, reason: String(err) })
  }
}
