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

export async function syncNFeSaida(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  let page = 1
  let synced = 0

  while (true) {
    const list = await blingGet<BlingNFeSaidaList>('/nfe', {
      pagina: String(page),
      limite: '100',
      situacao: '2', // authorized
      serie: '2',    // ONLY série 2 — excludes Full ML (4) and FBA (420)
      dataEmissaoInicio: startDate,
      dataEmissaoFim: endDate,
    })

    if (!list.data?.length) break

    for (const nfe of list.data) {
      // Double-check: skip anything not série 2
      if (String(nfe.serie) !== '2') continue

      try {
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`)
        const xml = xmlRes.data?.xml
        if (!xml) continue

        const storagePath = `nfe-saida/${nfe.id}.xml`
        await db.storage
          .from('nfe-xml')
          .upload(storagePath, new Blob([xml], { type: 'text/xml' }), { upsert: true })

        // Extract tax totals from XML (ICMSTot block)
        function extractTotal(tag: string): number {
          const m = xml.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`))
          return parseFloat(m?.[1] ?? '0')
        }

        const chave = nfe.chaveAcesso ?? xml.match(/<chNFe>([^<]+)<\/chNFe>/)?.[1] ?? null
        if (!chave) continue

        // Link taxes to the sale that has this NF-e key
        const { data: sale } = await db
          .from('sales')
          .select('id')
          .eq('nfe_saida_key', chave)
          .single()

        if (sale) {
          await db.from('sale_taxes').upsert({
            sale_id: sale.id,
            nfe_key: chave,
            pis: extractTotal('vPIS'),
            cofins: extractTotal('vCOFINS'),
            icms: extractTotal('vICMS'),
            icms_difal: extractTotal('vICMSUFDest') + extractTotal('vICMSUFRemet'),
            ipi: extractTotal('vIPI'),
          }, { onConflict: 'sale_id' })
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
