/**
 * POST /api/sync/bling/nfe-entrada
 *
 * Importa NF-e de entrada (compras/importações) do Bling para o Oryma.
 * Cria registros em:
 *   - import_orders   (cabeçalho da NF-e)
 *   - import_items    (itens da NF-e com impostos unitários)
 *
 * As NF-e de entrada têm tipo=2 na listagem do Bling.
 * O XML é baixado via GET /nfe/documento/{chaveAcesso}?formato=xml
 *
 * Tags XML extraídas:
 *   <emit><xNome>    = fornecedor (supplier)
 *   <nNF>            = número da NF
 *   <dhEmi>          = data de emissão
 *   <vNF>            = valor total da NF
 *   <CFOP>           = CFOP do 1° item
 *   Por item (<det>):
 *     <cProd>        = código/SKU do produto
 *     <xProd>        = descrição
 *     <qCom>         = quantidade
 *     <vUnCom>       = valor unitário
 *     <vProd>        = valor total do item
 *     <vII>          = II (imposto de importação)
 *     <vIPI>         = IPI
 *     <vPIS>         = PIS
 *     <vCOFINS>      = COFINS
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGet, blingGetDocumentoXml } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilToday, brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface BlingNFeItem {
  id: number
  tipo: number           // 1=saída, 2=entrada
  situacao: number       // 5=Autorizada
  dataEmissao: string
  chaveAcesso: string | null
}

function extractStr(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
  return m?.[1] ?? null
}

function extractNum(xml: string, tag: string): number {
  return parseFloat(extractStr(xml, tag) ?? '0')
}

function extractDets(xml: string): Array<{
  sku: string; description: string
  qty: number; unitValue: number; totalValue: number
  ii: number; ipi: number; pis: number; cofins: number
}> {
  const dets = xml.match(/<det[^>]*>([\s\S]*?)<\/det>/g) ?? []
  return dets.map(det => ({
    sku:         extractStr(det, 'cProd') ?? '',
    description: extractStr(det, 'xProd') ?? '',
    qty:         extractNum(det, 'qCom'),
    unitValue:   extractNum(det, 'vUnCom'),
    totalValue:  extractNum(det, 'vProd'),
    ii:          extractNum(det, 'vII'),
    ipi:         extractNum(det, 'vIPI'),
    pis:         extractNum(det, 'vPIS'),
    cofins:      extractNum(det, 'vCOFINS'),
  })).filter(d => d.sku !== '' && d.qty > 0)
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db   = createSupabaseServiceClient()
  const days = Number(request.nextUrl.searchParams.get('days') ?? '180')
  const startDate = brazilDaysAgo(days)
  const endDate   = brazilToday()

  try {
    // 1. Lista NF-e do Bling (tipo=2 = entrada, mas a API retorna misturado — filtramos)
    const allNfe: BlingNFeItem[] = []
    for (let page = 1; page <= 5; page++) {
      await sleep(250)
      const res = await blingGet<{ data: BlingNFeItem[] }>('/nfe', {
        pagina: String(page), limite: '100',
        dataEmissaoInicio: startDate, dataEmissaoFim: endDate,
      }, 1)
      const items = res.data ?? []
      allNfe.push(...items)
      if (items.length < 100) break
    }

    // Filtra: só entradas autorizadas com chaveAcesso
    const entradas = allNfe.filter(n =>
      n.tipo === 2 && n.situacao === 5 && n.chaveAcesso
    )

    if (entradas.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: 'Nenhuma NF-e de entrada encontrada no período' })
    }

    // 2. Chaves já importadas (pula duplicatas)
    const { data: existing } = await db
      .from('import_orders').select('nfe_key').not('nfe_key', 'is', null)
    const existingKeys = new Set((existing ?? []).map(r => r.nfe_key as string))

    // 3. Pré-carrega produtos para linkar por SKU
    const { data: products } = await db.from('products').select('id, sku')
    const productMap = Object.fromEntries((products ?? []).map(p => [p.sku.toUpperCase(), p.id]))

    // 4. Processa cada NF-e de entrada
    let synced = 0
    let skipped = 0
    const errors: string[] = []

    for (const nfe of entradas.slice(0, 30)) {  // máx 30 por chamada
      const chave = nfe.chaveAcesso!
      if (existingKeys.has(chave)) { skipped++; continue }

      try {
        await sleep(300)

        // Baixa XML
        const xml = await blingGetDocumentoXml(chave)
        if (!xml) { errors.push(`${chave.slice(-8)}: xml null`); continue }

        // Extrai cabeçalho
        const supplier = extractStr(xml, 'xNome') ?? 'Fornecedor não identificado'
        const nfeNum   = extractStr(xml, 'nNF') ?? '0'
        const dhEmi    = extractStr(xml, 'dhEmi')?.slice(0, 10) ?? nfe.dataEmissao?.slice(0, 10)
        const vNF      = extractNum(xml, 'vNF')
        const cfop     = extractStr(xml, 'CFOP') ?? ''
        const vFOB     = extractNum(xml, 'vProd')  // total dos produtos (FOB = sem impostos adicionais)

        if (!dhEmi || vNF <= 0) { errors.push(`${chave.slice(-8)}: data/valor inválido`); continue }

        // Cria import_order
        const { data: order, error: orderErr } = await db
          .from('import_orders')
          .insert({
            nfe_number:       nfeNum,
            nfe_key:          chave,
            supplier,
            issue_date:       dhEmi,
            cfop,
            total_nfe_value:  vNF,
            total_fob_value:  vFOB > 0 ? vFOB : null,
            source:           'bling',
            costs_complete:   false,
          })
          .select('id')
          .single()

        if (orderErr || !order?.id) {
          errors.push(`${chave.slice(-8)}: ${orderErr?.message ?? 'insert falhou'}`)
          continue
        }

        // Extrai e insere itens
        const dets = extractDets(xml)
        if (dets.length > 0) {
          const itemRows = dets.map(d => {
            const skuUp = d.sku.toUpperCase()
            return {
              import_order_id:  order.id,
              product_id:       productMap[skuUp] ?? null,
              sku:              d.sku,
              description:      d.description,
              quantity:         d.qty,
              unit_fob_value:   d.qty > 0 ? d.unitValue : 0,
              total_fob_value:  d.totalValue,
              unit_ii:          d.qty > 0 ? d.ii / d.qty : 0,
              unit_ipi:         d.qty > 0 ? d.ipi / d.qty : 0,
              unit_pis_imp:     d.qty > 0 ? d.pis / d.qty : 0,
              unit_cofins_imp:  d.qty > 0 ? d.cofins / d.qty : 0,
            }
          })
          await db.from('import_items').insert(itemRows)
        }

        synced++
      } catch (err) {
        errors.push(`${chave.slice(-8)}: ${String(err).slice(0, 60)}`)
      }
    }

    return NextResponse.json({
      ok: true,
      synced,
      skipped_already_imported: skipped,
      total_entradas_found: entradas.length,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      message: `${synced} NF-e de entrada importadas`,
    })

  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
