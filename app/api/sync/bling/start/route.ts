/**
 * POST /api/sync/bling/start
 *
 * Fase 1: cria o sync_log e devolve a fila de NF-e pendentes.
 * Não baixa nenhum XML — só lista + filtra pelo que já foi processado.
 * Tempo: ~500ms (2 queries DB + 1 chamada Bling)
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGet } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilToday, brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

interface BlingNFeSaidaItem {
  id: number
  tipo: number          // 1 = saída | 2 = entrada
  situacao: number      // 5 = Autorizada | outros = cancelada/pendente
  dataEmissao: string
  chaveAcesso: string | null
}

// A API de listagem do Bling NÃO retorna o campo "serie".
// A série está codificada na chaveAcesso (posições 22-24 do código de 44 dígitos).
// Exemplo: "31260508072288000111550020000267461323092135" → posições 22-24 = "002" = série 2
// Série >= 100 = remessa Full ML/FBA (excluir)
function isSerieValida(chaveAcesso: string | null): boolean {
  if (!chaveAcesso || chaveAcesso.length !== 44) return true  // sem chave: inclui, o process filtra
  const serie = parseInt(chaveAcesso.slice(22, 25), 10)
  return !isNaN(serie) && serie < 100
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createSupabaseServiceClient()
  const days      = Number(request.nextUrl.searchParams.get('days') ?? '30')
  const limit     = Number(request.nextUrl.searchParams.get('limit') ?? '50')
  // Usa fuso Brasil (UTC-3) para que o período reflita dias corretos para o usuário
  const startDate = brazilDaysAgo(days)
  const endDate   = brazilToday()

  // Cria sync_log
  const { data: log } = await db.from('sync_logs').insert({
    source: 'bling', sync_type: 'nfe', status: 'running', started_at: new Date().toISOString(),
  }).select().single()

  const syncId = log?.id

  try {
    // Chaves já vinculadas (para pular sem baixar XML)
    const { data: linked } = await db
      .from('sales').select('nfe_saida_key').not('nfe_saida_key', 'is', null)
    const linkedChaves = new Set((linked ?? []).map(s => s.nfe_saida_key as string))

    // Lista de NF-e do Bling com paginação (máx. 5 páginas = 500 NF-e)
    const allNfe: BlingNFeSaidaItem[] = []
    for (let page = 1; page <= 5; page++) {
      const list = await blingGet<{ data: BlingNFeSaidaItem[] }>('/nfe', {
        pagina: String(page), limite: '100',
        dataEmissaoInicio: startDate, dataEmissaoFim: endDate,
      }, 1)
      const items = list.data ?? []
      allNfe.push(...items)
      if (items.length < 100) break  // última página
    }

    // Filtra: só séries válidas e não processadas ainda
    const pending = allNfe
      .filter(nfe => nfe.tipo === 1)                           // só NF-e saída (não entrada/compras)
      .filter(nfe => nfe.situacao === 5)                       // só Autorizadas (não canceladas/pendentes)
      .filter(nfe => isSerieValida(nfe.chaveAcesso))           // série via chaveAcesso (< 100, exclui remessa Full)
      .filter(nfe => !nfe.chaveAcesso || !linkedChaves.has(nfe.chaveAcesso)) // pula já processadas
      .slice(0, limit)  // máximo `limit` por rodada
      .map(nfe => ({ id: nfe.id, chaveAcesso: nfe.chaveAcesso }))

    return NextResponse.json({ ok: true, sync_id: syncId, pending, startDate, endDate })
  } catch (err) {
    await db.from('sync_logs').update({
      status: 'error', error_message: String(err), finished_at: new Date().toISOString(),
    }).eq('id', syncId)
    return NextResponse.json({ ok: false, sync_id: syncId, error: String(err) }, { status: 500 })
  }
}
