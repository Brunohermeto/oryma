/**
 * GET /api/debug/check-nfe-match?date=2026-03-23&sku=RAGA001-C
 *
 * Diagnóstico: verifica se existe NF-e de saída no Bling para
 * uma data/produto específicos e por que o matching falhou.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { blingGet } from '@/lib/integrations/bling'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic     = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateParam = request.nextUrl.searchParams.get('date') ?? ''  // ex: 2026-03-23
  const skuParam  = request.nextUrl.searchParams.get('sku')  ?? ''  // ex: RAGA001-C

  if (!dateParam) {
    return NextResponse.json({ error: 'Passe ?date=YYYY-MM-DD' }, { status: 400 })
  }

  const db = createSupabaseServiceClient()

  // 1. Vendas no banco para esse dia e SKU
  let salesQuery = db
    .from('sales')
    .select('id, external_order_id, sku, gross_price, sale_date, nfe_saida_key, marketplace')
    .eq('sale_date', dateParam)
  if (skuParam) salesQuery = salesQuery.eq('sku', skuParam)
  const { data: sales } = await salesQuery.limit(10)

  // 2. NF-e do Bling nessa janela de data (±3 dias)
  const dateObj  = new Date(dateParam + 'T12:00:00Z')
  const dateMinus3 = new Date(dateObj.getTime() - 3 * 86400000).toISOString().slice(0, 10)
  const datePlus3  = new Date(dateObj.getTime() + 3 * 86400000).toISOString().slice(0, 10)

  const blingNFe: Array<{
    id: number; numero: string; serie: string
    dataEmissao: string; situacao: { id: number }
    chaveAcesso: string | null; tipo: number
  }> = []

  try {
    for (let page = 1; page <= 3; page++) {
      const list = await blingGet<{ data: typeof blingNFe }>('/nfe', {
        pagina: String(page), limite: '100',
        dataEmissaoInicio: dateMinus3,
        dataEmissaoFim: datePlus3,
      }, 1)
      blingNFe.push(...(list.data ?? []))
      if ((list.data ?? []).length < 100) break
    }
  } catch (e) {
    return NextResponse.json({ error: `Erro ao buscar Bling: ${String(e)}` }, { status: 500 })
  }

  // 3. Filtra NF-e de saída autorizadas
  const nfeSaida = blingNFe.filter(n => n.tipo === 1 && n.situacao?.id === 5)

  // 4. Chaves já vinculadas no banco
  const { data: linked } = await db
    .from('sales').select('nfe_saida_key').not('nfe_saida_key', 'is', null)
  const linkedSet = new Set((linked ?? []).map(s => s.nfe_saida_key as string))

  // 5. Análise de matching para cada NF-e no período
  const nfeSaidaAnalysis = nfeSaida.map(nfe => {
    const alreadyLinked = nfe.chaveAcesso ? linkedSet.has(nfe.chaveAcesso) : false
    // série (da chaveAcesso, posições 22-24)
    const serie = nfe.chaveAcesso?.length === 44
      ? parseInt(nfe.chaveAcesso.slice(22, 25), 10)
      : null
    const serieValida = serie === null || serie < 100

    return {
      id: nfe.id,
      numero: nfe.numero,
      serie: nfe.serie,
      serie_chave: serie,
      serie_valida: serieValida,
      data_emissao: nfe.dataEmissao,
      ja_vinculada: alreadyLinked,
      chave: nfe.chaveAcesso?.slice(0, 12) + '…',
    }
  })

  return NextResponse.json({
    date_range: `${dateMinus3} a ${datePlus3}`,
    sales_in_db: (sales ?? []).map(s => ({
      id: s.id.slice(-8),
      sku: s.sku,
      gross: s.gross_price,
      nfe_linked: !!s.nfe_saida_key,
      marketplace: s.marketplace,
    })),
    nfe_bling_total: blingNFe.length,
    nfe_saida_autorizadas: nfeSaida.length,
    nfe_saida_detail: nfeSaidaAnalysis,
    diagnostic: nfeSaida.length === 0
      ? '⚠ Nenhuma NF-e de saída encontrada no Bling para este período — verifique se foi emitida'
      : nfeSaidaAnalysis.every(n => n.ja_vinculada)
      ? '✓ Todas as NF-e do período já estão vinculadas'
      : nfeSaidaAnalysis.some(n => !n.serie_valida)
      ? '⚠ Algumas NF-e têm série >= 100 (remessa Full ML) — excluídas do matching'
      : '⚠ NF-e encontrada mas não matchada — verifique valores e execute "Sincronizar NF-e Saída"',
  })
}
