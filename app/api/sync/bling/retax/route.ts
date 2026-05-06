/**
 * POST /api/sync/bling/retax
 *
 * Re-extrai impostos das NF-e já vinculadas mas com sale_taxes zeradas.
 * Útil quando o XML não estava disponível no momento do sync inicial.
 *
 * Fluxo:
 *   1. Busca vendas com nfe_saida_key setada mas sale_taxes com PIS+COFINS+ICMS = 0
 *   2. Lista NF-e do Bling para montar mapa chaveAcesso → blingId
 *   3. Para cada NF-e sem impostos, baixa o XML e atualiza sale_taxes
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGet, blingGetDocumentoXml } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo, brazilToday } from '@/lib/utils/brazil-time'
// BlingNFeListItem mantido para o fallback de blingId

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractTag(xml: string, tag: string): number {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  return parseFloat(m?.[1] ?? '0')
}

interface BlingNFeListItem {
  id: number
  chaveAcesso: string | null
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // 1. Vendas com NF-e vinculada mas sem sale_taxes ou com impostos todos zerados
  const { data: salesLinked } = await db
    .from('sales')
    .select('id, nfe_saida_key, sale_taxes(pis, cofins, icms, icms_difal, ipi)')
    .not('nfe_saida_key', 'is', null)

  const needsRetax = (salesLinked ?? []).filter(s => {
    const arr = s.sale_taxes as any
    // Supabase retorna array para has-many; se vazio = sem registro
    if (!arr || (Array.isArray(arr) && arr.length === 0)) return true
    const t = Array.isArray(arr) ? arr[0] : arr
    if (!t) return true
    // Verifica se todos os valores individuais são zero
    const soma = Number(t.pis??0) + Number(t.cofins??0) + Number(t.icms??0) + Number(t.icms_difal??0) + Number(t.ipi??0)
    return soma === 0
  })

  if (needsRetax.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, message: 'Nenhuma NF-e com impostos zerados encontrada' })
  }

  // 2. Para cada venda com impostos pendentes, baixa o XML via chaveAcesso diretamente
  // Usa novo endpoint mar/2026 (não precisa de blingId)
  let updated = 0
  for (const sale of needsRetax.slice(0, 30)) {
    const chave = sale.nfe_saida_key as string

    try {
      await sleep(200)

      // Novo endpoint (mar/2026): JSON { data[0].conteudo = base64(gzip(xml)) }
      let xml: string | null = null
      try {
        xml = await blingGetDocumentoXml(chave)
      } catch { xml = null }

      // Fallback: busca blingId via lista e usa endpoint antigo
      if (!xml) {
        try {
          const startDate = brazilDaysAgo(60)
          const endDate   = brazilToday()
          const list = await blingGet<{ data: BlingNFeListItem[] }>('/nfe', {
            pagina: '1', limite: '100',
            dataEmissaoInicio: startDate, dataEmissaoFim: endDate,
          }, 1)
          const nfe = (list.data ?? []).find(n => n.chaveAcesso === chave)
          if (nfe?.id) {
            const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`, undefined, 0)
            const c = xmlRes.data?.xml ?? null
            xml = c && c.includes('<') ? c : null
          }
        } catch { xml = null }
      }

      if (!xml) continue

      const pis    = extractTag(xml, 'vPIS')
      const cofins = extractTag(xml, 'vCOFINS')
      const icms   = extractTag(xml, 'vICMS')
      const difal  = extractTag(xml, 'vICMSUFDest') + extractTag(xml, 'vICMSUFRemet')
      const ipi    = extractTag(xml, 'vIPI')
      const frete  = extractTag(xml, 'vFrete')

      // sale_taxes não tem UNIQUE constraint em sale_id — usa delete+insert
      await db.from('sale_taxes').delete().eq('sale_id', sale.id)
      await db.from('sale_taxes').insert({
        sale_id: sale.id, nfe_key: chave,
        pis, cofins, icms, icms_difal: difal, ipi,
      })

      // Atualiza frete se disponível
      if (frete > 0) {
        await db.from('sales').update({ marketplace_shipping_fee: frete }).eq('id', sale.id)
      }

      updated++
    } catch {
      continue
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    total_sem_imposto: needsRetax.length,
    message: `${updated} NF-e atualizadas com impostos`,
  })
}
