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

// Séries válidas para NF-e ao consumidor de marketplace
// Exclui série 4xx (remessa Full ML) e 420 (FBA) — não têm impostos ao consumidor
function isSerieValida(serie: string): boolean {
  const n = Number(serie)
  if (isNaN(n)) return false
  return n < 100 // série 1, 2, 3 = válidas; 4xx = remessa, excluir
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function syncNFeSaida(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  let page = 1
  let synced = 0

  while (true) {
    // Busca NF-e por data — sem filtro de situação ou série (filtramos no loop)
    const list = await blingGet<BlingNFeSaidaList>('/nfe', {
      pagina: String(page),
      limite: '100',
      dataEmissaoInicio: startDate,
      dataEmissaoFim: endDate,
    })

    if (!list.data?.length) break

    for (const nfe of list.data) {
      // Aceita série 1, 2, 3 — exclui série 4xx (Full ML/FBA remessa)
      if (!isSerieValida(nfe.serie)) continue

      try {
        await sleep(300) // 300ms entre chamadas — evita rate limit do Bling
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`)
        const xml = xmlRes.data?.xml
        if (!xml) continue

        // Guarda XML no Storage
        const storagePath = `nfe-saida/${nfe.id}.xml`
        await db.storage
          .from('nfe-xml')
          .upload(storagePath, new Blob([xml], { type: 'text/xml' }), { upsert: true })

        function extractTotal(tag: string): number {
          const m = xml.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`))
          return parseFloat(m?.[1] ?? '0')
        }

        const chave = nfe.chaveAcesso ?? xml.match(/<chNFe>([^<]+)<\/chNFe>/)?.[1] ?? null
        if (!chave) continue

        const pisTot    = extractTotal('vPIS')
        const cofinsTot = extractTotal('vCOFINS')
        const icmsTot   = extractTotal('vICMS')
        const difalTot  = extractTotal('vICMSUFDest') + extractTotal('vICMSUFRemet')
        const ipiTot    = extractTotal('vIPI')

        // Tenta vincular à venda pelo nfe_saida_key
        const { data: sale } = await db
          .from('sales')
          .select('id')
          .eq('nfe_saida_key', chave)
          .maybeSingle()

        if (sale) {
          await db.from('sale_taxes').upsert({
            sale_id: sale.id,
            nfe_key: chave,
            pis: pisTot,
            cofins: cofinsTot,
            icms: icmsTot,
            icms_difal: difalTot,
            ipi: ipiTot,
          }, { onConflict: 'sale_id' })
        } else {
          // Se não encontrou pela chave, tenta pelo número da NF-e + data
          // Extrai data de emissão e valor total do XML para matching aproximado
          const vNF = extractTotal('vNF')
          const dhEmi = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1]?.slice(0, 10) ?? nfe.dataEmissao.slice(0, 10)

          const { data: saleByDate } = await db
            .from('sales')
            .select('id')
            .eq('sale_date', dhEmi)
            .is('nfe_saida_key', null)
            .maybeSingle()

          if (saleByDate && vNF > 0) {
            // Atualiza a venda com a chave NF-e e insere os impostos
            await db.from('sales').update({ nfe_saida_key: chave }).eq('id', saleByDate.id)
            await db.from('sale_taxes').upsert({
              sale_id: saleByDate.id,
              nfe_key: chave,
              pis: pisTot,
              cofins: cofinsTot,
              icms: icmsTot,
              icms_difal: difalTot,
              ipi: ipiTot,
            }, { onConflict: 'sale_id' })
          }
        }

        synced++
      } catch {
        continue
      }
    }

    if (list.data.length < 100) break
    page++
  }

  return synced
}
