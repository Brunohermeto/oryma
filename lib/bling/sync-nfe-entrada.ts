import { blingGet } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

interface BlingNFeListItem {
  id: number
  numero: string
  serie: string
  dataEmissao: string
  contato: { nome: string }
  situacao: { id: number }
  tipo?: string | number
}

interface BlingNFeList {
  data: BlingNFeListItem[]
}

// Bling API v3 — NF-e de entrada usa o mesmo endpoint /nfe
// série 0 = entrada/importação; CFOP 3102 = importação direta
export async function syncNFeEntrada(startDate: string, endDate: string): Promise<number> {
  const db = createSupabaseServiceClient()
  let page = 1
  let synced = 0

  while (true) {
    // Bling v3: /nfe lista todas as NF-e. Filtramos série 0 (entrada) no loop.
    // Tentamos com tipo=E (entrada); se retornar erro, filtramos pela série
    const list = await blingGet<BlingNFeList>('/nfe', {
      pagina: String(page),
      limite: '100',
      dataEmissaoInicio: startDate,
      dataEmissaoFim: endDate,
      tipo: 'E',         // E = Entrada na API v3
    })

    if (!list.data?.length) break

    for (const nfe of list.data) {
      // Garantia extra: só série 0 (NF-e de entrada/importação)
      if (String(nfe.serie) !== '0') continue

      try {
        const xmlRes = await blingGet<{ data: { xml: string } }>(`/nfe/${nfe.id}/xml`)
        const xml = xmlRes.data?.xml
        if (!xml) continue

        // Só processa CFOP 3102 (importação direta)
        if (!xml.includes('3102') && !xml.includes('3.102')) continue

        const storagePath = `nfe-entrada/${nfe.id}.xml`

        await db.storage
          .from('nfe-xml')
          .upload(storagePath, new Blob([xml], { type: 'text/xml' }), { upsert: true })

        const chaveMatch = xml.match(/<chNFe>([^<]+)<\/chNFe>/) || xml.match(/Id="NFe([^"]+)"/)
        const chave = chaveMatch?.[1] ?? null

        const vNFMatch = xml.match(/<vNF>([^<]+)<\/vNF>/)
        const totalNfeValue = parseFloat(vNFMatch?.[1] ?? '0')

        await db.from('import_orders').upsert({
          nfe_number: nfe.numero,
          nfe_key: chave,
          supplier: nfe.contato?.nome ?? 'Fornecedor',
          issue_date: nfe.dataEmissao.slice(0, 10),
          cfop: '3102',
          total_nfe_value: totalNfeValue,
          source: 'bling',
          xml_storage_path: storagePath,
          costs_complete: false,
        }, { onConflict: 'nfe_key' })

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
