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
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'
import { buildBlingProductIndex, resolveSkuFromBling } from '@/lib/bling/product-index'

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

/**
 * NF-e de importação (CFOP 3102): PIS e COFINS ficam nos totais do cabeçalho,
 * não nos <det> individuais. II e IPI estão em cada <det>.
 * Distribuímos PIS/COFINS proporcionalmente ao FOB de cada item.
 */
function extractDets(xml: string): Array<{
  sku: string; description: string
  qty: number; unitValue: number; totalValue: number
  ii: number; ipi: number; pis: number; cofins: number
}> {
  // Totais globais de PIS e COFINS (no bloco <ICMSTot> ou <infAdic>/<infCpl>)
  const totalPis    = extractNum(xml, 'vPIS')
  const totalCofins = extractNum(xml, 'vCOFINS')

  const dets = xml.match(/<det[^>]*>([\s\S]*?)<\/det>/g) ?? []
  const items = dets.map(det => ({
    sku:        extractStr(det, 'cProd') ?? '',
    description:extractStr(det, 'xProd') ?? '',
    qty:        extractNum(det, 'qCom'),
    unitValue:  extractNum(det, 'vUnCom'),
    totalValue: extractNum(det, 'vProd'),
    ii:         extractNum(det, 'vII'),
    ipi:        extractNum(det, 'vIPI'),
    pis:        0,    // preenchido abaixo
    cofins:     0,
  })).filter(d => d.sku !== '' && d.qty > 0)

  // Distribui PIS/COFINS proporcionalmente ao FOB de cada item
  const totalFob = items.reduce((s, i) => s + i.totalValue, 0)
  if (totalFob > 0 && (totalPis > 0 || totalCofins > 0)) {
    for (const item of items) {
      const share  = item.totalValue / totalFob
      item.pis    = totalPis    * share
      item.cofins = totalCofins * share
    }
  }

  return items
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
    // 1. Lista NF-e do Bling — o endpoint /nfe não filtra por tipo na query,
    //    então buscamos tudo e filtramos client-side
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

    // tipo=2 → entrada | situacao=5 → Autorizada
    // Também aceita tipo=0 que é o indicador de entrada no próprio XML (tpNF)
    const entradas = allNfe.filter(n =>
      n.chaveAcesso && (n.tipo === 2 || n.tipo === 0) && n.situacao === 5
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

    // 4. Constrói índice do catálogo Bling (codigoFabricante + gtin → SKU interno)
    //    Permite resolver cProd do fornecedor para o SKU correto mesmo sem match exato
    let blingIndex = null
    try {
      blingIndex = await buildBlingProductIndex()
    } catch { /* não bloqueia o sync se o catálogo falhar */ }

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
          const itemRows = await Promise.all(dets.map(async d => {
            // Resolve SKU: 1) catálogo Bling (codigoFabricante/gtin) 2) cProd direto
            const resolvedSku = (blingIndex ? resolveSkuFromBling(d.sku, blingIndex) : null) ?? d.sku
            const skuUp = resolvedSku.toUpperCase()

            // Busca product_id — cria o produto automaticamente se não existir
            let productId = productMap[skuUp] ?? null
            if (!productId) {
              const { data: existing } = await db.from('products').select('id').eq('sku', resolvedSku).maybeSingle()
              if (existing) {
                productId = existing.id
                productMap[skuUp] = productId  // atualiza cache local
              } else {
                // Cria produto novo a partir dos dados da NF-e
                const blingName = blingIndex?.byCodigo[resolvedSku]?.nome ?? d.description
                const { data: newProd } = await db.from('products')
                  .insert({ sku: resolvedSku, name: blingName })
                  .select('id').maybeSingle()
                productId = newProd?.id ?? null
                if (productId) productMap[skuUp] = productId
              }
            }

            return {
              import_order_id:  order.id,
              product_id:       productId,
              sku:              resolvedSku,
              description:      d.description,
              quantity:         d.qty,
              unit_fob_value:   d.qty > 0 ? d.unitValue : 0,
              total_fob_value:  d.totalValue,
              unit_ii:          d.qty > 0 ? d.ii / d.qty : 0,
              unit_ipi:         d.qty > 0 ? d.ipi / d.qty : 0,
              unit_pis_imp:     d.qty > 0 ? d.pis / d.qty : 0,
              unit_cofins_imp:  d.qty > 0 ? d.cofins / d.qty : 0,
            }
          }))
          await db.from('import_items').insert(itemRows)
        }

        // Calcula custo landed inicial (FOB + impostos da NF-e; sem fretes ainda)
        // Isso já popula unit_costs e cmp_costs, que aparecem em /produtos
        try {
          await recalculateLandedCost(order.id)
        } catch { /* não bloqueia o sync se cálculo falhar */ }

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
