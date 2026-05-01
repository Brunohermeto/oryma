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

function extractTotal(xml: string, tag: string): number {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  return parseFloat(m?.[1] ?? '0')
}

export async function syncNFeSaida(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  let page = 1
  let synced = 0

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

      try {
        await sleep(80)
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`)
        const xml = xmlRes.data?.xml
        if (!xml) continue

        // NÃO faz upload para Storage — só extrai os dados em memória
        // (Storage é lento demais: ~300ms extra por NF-e com 300 notas/dia)

        const chave = nfe.chaveAcesso ?? xml.match(/<chNFe>([^<]+)<\/chNFe>/)?.[1] ?? null
        if (!chave) continue

        const pisTot    = extractTotal(xml, 'vPIS')
        const cofinsTot = extractTotal(xml, 'vCOFINS')
        const icmsTot   = extractTotal(xml, 'vICMS')
        const difalTot  = extractTotal(xml, 'vICMSUFDest') + extractTotal(xml, 'vICMSUFRemet')
        const ipiTot    = extractTotal(xml, 'vIPI')
        const vNF       = extractTotal(xml, 'vNF')
        const dhEmi     = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? nfe.dataEmissao.slice(0, 10)

        // 1. Tenta vincular pela chave NF-e já cadastrada na venda
        const { data: saleByKey } = await db
          .from('sales')
          .select('id')
          .eq('nfe_saida_key', chave)
          .maybeSingle()

        if (saleByKey) {
          await db.from('sale_taxes').upsert({
            sale_id: saleByKey.id, nfe_key: chave,
            pis: pisTot, cofins: cofinsTot, icms: icmsTot,
            icms_difal: difalTot, ipi: ipiTot,
          }, { onConflict: 'sale_id' })
          synced++
          continue
        }

        // 2. Fallback: match por data + valor total (vNF próximo ao gross_price)
        if (vNF > 0) {
          const tolerance = vNF * 0.02 // 2% de tolerância
          const { data: saleByValue } = await db
            .from('sales')
            .select('id')
            .eq('sale_date', dhEmi)
            .is('nfe_saida_key', null)
            .gte('gross_price', vNF - tolerance)
            .lte('gross_price', vNF + tolerance)
            .maybeSingle()

          if (saleByValue) {
            await db.from('sales').update({ nfe_saida_key: chave }).eq('id', saleByValue.id)
            await db.from('sale_taxes').upsert({
              sale_id: saleByValue.id, nfe_key: chave,
              pis: pisTot, cofins: cofinsTot, icms: icmsTot,
              icms_difal: difalTot, ipi: ipiTot,
            }, { onConflict: 'sale_id' })
            synced++
          }
        }
      } catch {
        continue
      }
    }

    if (list.data.length < 100) break
    page++
  }

  return synced
}
