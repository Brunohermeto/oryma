import { blingGet } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

interface BlingNFeListItem {
  id: number
  numero: string
  serie: string
  dataEmissao: string
  contato: { nome: string }
  situacao: { id: number }
}

interface BlingNFeList {
  data: BlingNFeListItem[]
}

export async function syncNFeEntrada(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  let page = 1
  let synced = 0

  while (true) {
    const list = await blingGet<BlingNFeList>('/notasfiscaiscompras', {
      pagina: String(page),
      limite: '100',
      dataEmissaoInicio: startDate,
      dataEmissaoFim: endDate,
    })

    if (!list.data?.length) break

    for (const nfe of list.data) {
      // Only process CFOP 3102 (import entries) — filter after fetching
      // We'll check via XML; skip others at XML parse stage
      try {
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/notasfiscaiscompras/${nfe.id}/xml`)
        const xml = xmlRes.data?.xml
        if (!xml) continue

        // Check CFOP 3102 in XML
        if (!xml.includes('3102') && !xml.includes('3.102')) continue

        const storagePath = `nfe-entrada/${nfe.id}.xml`

        // Store XML in Supabase Storage
        await db.storage
          .from('nfe-xml')
          .upload(storagePath, new Blob([xml], { type: 'text/xml' }), { upsert: true })

        // Extract NF key from XML
        const chaveMatch = xml.match(/<chNFe>([^<]+)<\/chNFe>/) || xml.match(/Id="NFe([^"]+)"/)
        const chave = chaveMatch?.[1] ?? null

        // Extract total FOB (vProd total)
        const vNFMatch = xml.match(/<vNF>([^<]+)<\/vNF>/)
        const totalNfeValue = parseFloat(vNFMatch?.[1] ?? '0')

        await db.from('import_orders').upsert({
          nfe_number: nfe.numero,
          nfe_key: chave,
          supplier: nfe.contato.nome,
          issue_date: nfe.dataEmissao.slice(0, 10),
          cfop: '3102',
          total_nfe_value: totalNfeValue,
          source: 'bling',
          xml_storage_path: storagePath,
          costs_complete: false,
        }, { onConflict: 'nfe_key' })

        synced++
      } catch {
        // Skip individual NF errors — continue batch
        continue
      }
    }

    if (list.data.length < 100) break
    page++
  }

  return synced
}
