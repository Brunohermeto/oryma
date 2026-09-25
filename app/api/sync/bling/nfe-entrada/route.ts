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
import { resolveVariantSkus } from '@/lib/nfe/import-processor'

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
  naturezaOperacao?: { id?: number }
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
  sku: string; cean: string; description: string
  qty: number; unitValue: number; totalValue: number
  ii: number; ipi: number; pis: number; cofins: number; icms: number
}> {
  // Compra NACIONAL (Dorel, Grupo Multi...): PIS/COFINS/ICMS vêm POR ITEM dentro
  // do <det>. O extrator antigo pegava o PRIMEIRO <vPIS> do XML (= o do 1º item)
  // e rateava entre todos — crédito errado. Agora lê por item; só quando nenhum
  // item traz o valor (NF de importação) usa os totais do <ICMSTot> rateados por FOB.
  const dets = xml.match(/<det[^>]*>([\s\S]*?)<\/det>/g) ?? []
  const items = dets.map(det => ({
    sku:        extractStr(det, 'cProd') ?? '',
    cean:       extractStr(det, 'cEAN') ?? '',
    description:extractStr(det, 'xProd') ?? '',
    qty:        extractNum(det, 'qCom'),
    unitValue:  extractNum(det, 'vUnCom'),
    totalValue: extractNum(det, 'vProd'),
    ii:         extractNum(det, 'vII'),
    ipi:        extractNum(det, 'vIPI'),
    pis:        extractNum(det, 'vPIS'),
    cofins:     extractNum(det, 'vCOFINS'),
    icms:       extractNum(det, 'vICMS'),
  })).filter(d => d.sku !== '' && d.qty > 0)

  const tot = xml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/)?.[1] ?? ''
  const totalFob = items.reduce((s, i) => s + i.totalValue, 0)
  for (const campo of ['pis', 'cofins', 'icms'] as const) {
    if (items.some(i => i[campo] > 0) || totalFob <= 0) continue
    const total = extractNum(tot, campo === 'pis' ? 'vPIS' : campo === 'cofins' ? 'vCOFINS' : 'vICMS')
    if (total > 0) for (const item of items) item[campo] = total * (item.totalValue / totalFob)
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
  // A listagem do Bling é mista (saída+entrada) e ordenada DESC — 5 páginas
  // cobrem só ~38 dias de operação. Para histórico, aumente ?pages= (máx 30).
  const maxPages = Math.min(Number(request.nextUrl.searchParams.get('pages') ?? '5'), 30)
  const batchLimit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '10'), 30)
  // ?situacoes= — 5=Autorizada, 6=Emitida DANFE, 7=Registrada (padrão: as três;
  // as compras de fornecedor ficam em 6/7, a 5 era só devolução)
  const situacoes = new Set((request.nextUrl.searchParams.get('situacoes') ?? '5,6,7').split(',').map(Number))
  const startDate = brazilDaysAgo(days)
  const endDate   = brazilToday()
  // body.skip: chaves já examinadas e descartadas (não-compra / sem XML) —
  // senão elas ficam sempre no início da fila e consomem as tentativas
  const body = await request.json().catch(() => ({}))
  const skip = new Set<string>(Array.isArray(body?.skip) ? body.skip : [])
  const ignoradas: string[] = []

  try {
    // 1. Lista NF-e do Bling — o endpoint /nfe não filtra por tipo na query,
    //    então buscamos tudo e filtramos client-side
    const allNfe: BlingNFeItem[] = []
    for (let page = 1; page <= maxPages; page++) {
      await sleep(250)
      // tipo=0 é OBRIGATÓRIO: sem ele a API do Bling devolve só NF-e de SAÍDA,
      // e a filtragem client-side abaixo nunca achava nada ("Nenhuma NF-e de
      // entrada encontrada no período", mesmo com 2.001 entradas no Bling).
      const res = await blingGet<{ data: BlingNFeItem[] }>('/nfe', {
        pagina: String(page), limite: '100', tipo: '0',
        dataEmissaoInicio: startDate, dataEmissaoFim: endDate,
      }, 1)
      const items = res.data ?? []
      allNfe.push(...items)
      if (items.length < 100) break
    }

    // ?debug=1: como as NF-e do período estão registradas no Bling (por mês ×
    // tipo × situação × chave). Diagnóstico do buraco set/2025–mar/2026.
    const dbg = request.nextUrl.searchParams.get('debug')
    if (dbg === '1' || dbg === '2') {
      const porMes: Record<string, Record<string, number>> = {}
      for (const n of allNfe) {
        const mes = (n.dataEmissao ?? '').slice(0, 7) || '?'
        const k = `tipo=${n.tipo} sit=${n.situacao} chave=${n.chaveAcesso ? 'sim' : 'nao'}`
        porMes[mes] = porMes[mes] ?? {}
        porMes[mes][k] = (porMes[mes][k] ?? 0) + 1
      }
      const mes = request.nextUrl.searchParams.get('mes')
      const brutos = mes ? allNfe.filter(n => (n.dataEmissao ?? '').startsWith(mes)).slice(0, 60) : undefined
      return NextResponse.json({ total_listadas: allNfe.length, paginas: maxPages, porMes, brutos })
    }

    // ?debug=4&id=<id Bling>: itens crus do XML (cProd/xProd/cEAN/NCM) e como
    // cada um seria resolvido — diagnóstico do vínculo NF → SKU (23/09/2026)
    if (request.nextUrl.searchParams.get('debug') === '4') {
      const id = request.nextUrl.searchParams.get('id')
      const det = await blingGet<{ data?: { xml?: string; chaveAcesso?: string } }>(`/nfe/${id}`, undefined, 0)
      let xml = det.data?.xml ?? ''
      if (!xml.includes('<') && /^https?:/.test(xml)) xml = await (await fetch(xml)).text()
      if (!xml.includes('<') && det.data?.chaveAcesso) xml = (await blingGetDocumentoXml(det.data.chaveAcesso)) ?? ''
      const idx = await buildBlingProductIndex().catch(() => null)
      const dets = (xml.match(/<det[^>]*>([\s\S]*?)<\/det>/g) ?? []).map(d => ({
        cProd: extractStr(d, 'cProd'), xProd: extractStr(d, 'xProd'), cEAN: extractStr(d, 'cEAN'),
        cEANTrib: extractStr(d, 'cEANTrib'), NCM: extractStr(d, 'NCM'), CFOP: extractStr(d, 'CFOP'), qCom: extractStr(d, 'qCom'),
        resolvido: idx ? (resolveSkuFromBling(extractStr(d, 'cProd') ?? '', idx) ?? (extractStr(d, 'cEAN') ? resolveSkuFromBling(extractStr(d, 'cEAN')!, idx) : null)) : 'sem índice',
      }))
      return NextResponse.json({ id, emit: extractStr(xml, 'xNome'), natOp: extractStr(xml, 'natOp'), dets, catalogo: idx ? { total: idx.total, gtins: Object.keys(idx.byGtin).length, fabricantes: Object.keys(idx.byFabricante).length } : null })
    }

    // tipo=2 → entrada | situacao=5 → Autorizada
    // Também aceita tipo=0 que é o indicador de entrada no próprio XML (tpNF)
    // DEVOLUÇÃO NÃO É COMPRA. As NF-e de entrada de situação 5 eram, na
    // prática, devoluções de clientes emitidas pela própria MCL (CFOP 1202/2202,
    // destinatário CPF) — 22/09/2026 elas entraram como compra e o CMP virou o
    // preço de venda (699). As compras reais (fornecedores) ficam em situação
    // 6/7. Filtra pela natureza de operação (1 chamada) e, na dúvida, pelo CFOP do XML.
    const devolucaoNat = new Set<number>()
    try {
      const nat = await blingGet<{ data?: Array<{ id: number; descricao?: string }> }>('/naturezas-operacoes', { limite: '100' }, 1)
      // tudo que não é compra sai AQUI, sem baixar XML (transferência, bonificação,
      // remessa, devolução, retorno) — baixar XML de cada uma dava 504
      for (const x of nat.data ?? []) if (/devolu|retorno|bonific|brinde|remessa|conserto|demonstra/i.test(x.descricao ?? '')) devolucaoNat.add(x.id)
    } catch { /* sem a lista, o CFOP do XML segura */ }
    const entradas = allNfe.filter(n =>
      n.chaveAcesso && (n.tipo === 2 || n.tipo === 0) && situacoes.has(n.situacao)
      && !(n.naturezaOperacao?.id && devolucaoNat.has(n.naturezaOperacao.id))
    )

    if (entradas.length === 0) {
      return NextResponse.json({
      ignoradas,
      ok: true, synced: 0, message: 'Nenhuma NF-e de entrada encontrada no período' })
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

    // Descarta as JÁ importadas ANTES de cortar o lote: cortando antes, as 30
    // primeiras da lista (sempre as mesmas, já importadas) consumiam o lote
    // inteiro e a rota nunca avançava no histórico. Agora é retomável: chame
    // de novo até `synced` voltar 0.
    const pendentes = entradas.filter(n => !existingKeys.has(n.chaveAcesso!) && !skip.has(n.chaveAcesso!))
    skipped = entradas.length - pendentes.length

    // ?limit= por chamada (cada nota baixa o XML; 30 estoura os 60s da Vercel).
    // Nota sem XML NÃO consome o lote (senão as mesmas travavam a fila para sempre).
    let processadas = 0, tentativas = 0
    for (const nfe of pendentes) {
      // cada nota examinada baixa XML (~2-3s com os fallbacks): 12 por chamada
      // cabe nos 60s; 40 dava 504 e perdia a lista de ignoradas
      if (processadas >= batchLimit || tentativas >= 6) break
      tentativas++
      const chave = nfe.chaveAcesso!

      try {
        await sleep(300)

        // Baixa XML. /nfe/documento/{chave} só serve as notas EMITIDAS pela MCL;
        // a NF do FORNECEDOR (importada no Bling) vem em GET /nfe/{id} → data.xml
        // (XML cru ou URL no S3) — sem isso nenhuma compra entrava (22/09/2026).
        // GET /nfe/{id} PRIMEIRO: serve nota própria e de fornecedor (o /documento
        // demora muito para falhar na nota de fornecedor e dava 504)
        let xml: string | null = null
        try {
          const det = await blingGet<{ data?: { xml?: string } }>(`/nfe/${nfe.id}`, undefined, 0)
          const raw = det.data?.xml ?? ''
          if (raw.includes('<')) xml = raw
          else if (/^https?:\/\//.test(raw)) {
            const r = await fetch(raw, { signal: AbortSignal.timeout(8000) })
            const t = r.ok ? await r.text() : ''
            if (t.includes('<')) xml = t
          }
        } catch { /* tenta o próximo caminho */ }
        if (!xml) xml = await blingGetDocumentoXml(chave)
        if (!xml) {
          try {
            const r = await blingGet<{ data?: { xml?: string } }>(`/nfe/${nfe.id}/xml`, undefined, 0)
            if (r.data?.xml?.includes('<')) xml = r.data.xml
          } catch { /* sem XML */ }
        }
        if (!xml) { errors.push(`${chave.slice(-8)}: xml null`); ignoradas.push(chave); continue }
        processadas++

        // Extrai cabeçalho
        const supplier = extractStr(xml, 'xNome') ?? 'Fornecedor não identificado'
        const nfeNum   = extractStr(xml, 'nNF') ?? '0'
        const dhEmi    = extractStr(xml, 'dhEmi')?.slice(0, 10) ?? nfe.dataEmissao?.slice(0, 10)
        const vNF      = extractNum(xml, 'vNF')
        const cfop     = extractStr(xml, 'CFOP') ?? ''
        const vFOB     = extractNum(xml, 'vProd')  // total dos produtos (FOB = sem impostos adicionais)

        if (!dhEmi || vNF <= 0) { errors.push(`${chave.slice(-8)}: data/valor inválido`); continue }
        // O CFOP do XML é o do EMITENTE. Compra de verdade:
        //  - nota da própria MCL (emit = dest): só IMPORTAÇÃO (3xxx). As demais
        //    são devolução de cliente (1202/2202) ou TRANSFERÊNCIA entre
        //    estabelecimentos (5152 — uma de R$ 969 mil entrou como compra em 23/09);
        //  - nota de fornecedor: só VENDA (x101–x119, x401–x405). Fora remessa/
        //    bonificação (x910/x949), devolução (x20x) e transferência (x15x).
        const emitCnpj = xml.match(/<emit>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/)?.[1] ?? ''
        const destCnpj = xml.match(/<dest>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/)?.[1] ?? ''
        const natOp = extractStr(xml, 'natOp') ?? ''
        // mesma empresa = mesma RAIZ de CNPJ (8 dígitos): matriz e filial têm CNPJ
        // completo diferente (0001 × 000x) — comparar o CNPJ inteiro recusava as transferências
        const propria = emitCnpj.length >= 8 && emitCnpj.slice(0, 8) === destCnpj.slice(0, 8)
        // importação (3xxx) é compra SEMPRE — no XML de importação o <dest> não
        // bate com o emitente e a nota caía na regra de fornecedor
        // TRANSFERÊNCIA matriz→filial (5151/5152/6151/6152) É lote de custo: a
        // filial vende o que recebeu por ela (commit 5d9c1f5 — créditos da filial
        // entram depois por /api/import-orders/filial-credits). Descartá-la em
        // 23/09 foi erro, corrigido no mesmo dia.
        const ehCompra = /^3\d{3}$/.test(cfop)
          || (propria && /^[56]15[12]$/.test(cfop))
          || (!propria && /^[1256](1[01]\d|40[1-5])$/.test(cfop) && !/devolu|retorno|transfer|bonific|brinde/i.test(natOp))
        if (!ehCompra) {
          errors.push(`${chave.slice(-8)}: não é compra (CFOP ${cfop} ${propria ? 'própria' : supplier.slice(0, 18)} ${natOp.slice(0, 25)}) — ignorada`); ignoradas.push(chave); continue
        }

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
          // Resolvedor OFICIAL (lib/nfe/import-processor): mapa de códigos do
          // fornecedor, famílias Ragaluma por código/cor na descrição, EAN e
          // catálogo do Bling. [] = peça/caixa → item sem produto (nunca criar
          // produto-lixo "CFOP…"); vários = família sem cor, qtd dividida.
          const itemRows: Record<string, unknown>[] = []
          for (const d of dets) {
            const skus = resolveVariantSkus(d.sku, d.description, blingIndex ?? undefined, d.cean)
            const alvos: Array<string | null> = skus.length ? skus : [null]
            for (const sku of alvos) {
              let productId: string | null = null
              if (sku) {
                productId = productMap[sku.toUpperCase()] ?? null
                if (!productId) {
                  const { data: existing } = await db.from('products').select('id').eq('sku', sku).maybeSingle()
                  productId = existing?.id ?? null
                  if (!productId) {
                    const nome = blingIndex?.byCodigo[sku]?.nome ?? d.description
                    const { data: novo } = await db.from('products').insert({ sku, name: nome }).select('id').maybeSingle()
                    productId = novo?.id ?? null
                  }
                  if (productId) productMap[sku.toUpperCase()] = productId
                }
              }
              const n = alvos.length
              itemRows.push({
                import_order_id:  order.id,
                product_id:       productId,
                sku:              sku ?? d.sku,
                description:      d.description,
                quantity:         d.qty / n,
                unit_fob_value:   d.qty > 0 ? d.unitValue : 0,
                total_fob_value:  d.totalValue / n,
                unit_ii:          d.qty > 0 ? d.ii / d.qty : 0,
                unit_ipi:         d.qty > 0 ? d.ipi / d.qty : 0,
                unit_pis_imp:     d.qty > 0 ? d.pis / d.qty : 0,
                unit_cofins_imp:  d.qty > 0 ? d.cofins / d.qty : 0,
                // crédito de ICMS da compra (nacional: abate do custo; importação: só informação)
                unit_icms_gnre:   d.qty > 0 ? d.icms / d.qty : 0,
              })
            }
          }
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
      ignoradas,  // chaves descartadas — o chamador manda de volta em body.skip
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      message: `${synced} NF-e de entrada importadas`,
    })

  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
