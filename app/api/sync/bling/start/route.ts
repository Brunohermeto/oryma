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
import { format, subDays } from 'date-fns'

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
  const now = new Date()
  const days      = Number(request.nextUrl.searchParams.get('days') ?? '1')
  const startDate = format(subDays(now, days), 'yyyy-MM-dd')
  const endDate   = format(now, 'yyyy-MM-dd')

  // Cria sync_log
  const { data: log } = await db.from('sync_logs').insert({
    source: 'bling', sync_type: 'nfe', status: 'running', started_at: now.toISOString(),
  }).select().single()

  const syncId = log?.id

  try {
    // Chaves já vinculadas (para pular sem baixar XML)
    const { data: linked } = await db
      .from('sales').select('nfe_saida_key').not('nfe_saida_key', 'is', null)
    const linkedChaves = new Set((linked ?? []).map(s => s.nfe_saida_key as string))

    // Lista de NF-e do Bling (sem baixar XMLs)
    const list = await blingGet<{ data: BlingNFeSaidaItem[] }>('/nfe', {
      pagina: '1', limite: '100',
      dataEmissaoInicio: startDate, dataEmissaoFim: endDate,
    }, 1)

    // Filtra: só séries válidas e não processadas ainda
    const pending = (list.data ?? [])
      .filter(nfe => nfe.tipo === 1)                           // só NF-e saída (não entrada/compras)
      .filter(nfe => nfe.situacao === 5)                       // só Autorizadas (não canceladas/pendentes)
      .filter(nfe => isSerieValida(nfe.chaveAcesso))           // série via chaveAcesso (< 100, exclui remessa Full)
      .filter(nfe => !nfe.chaveAcesso || !linkedChaves.has(nfe.chaveAcesso)) // pula já processadas
      .slice(0, 20)  // máximo 20 por rodada de clique
      .map(nfe => ({ id: nfe.id, chaveAcesso: nfe.chaveAcesso }))

    return NextResponse.json({ ok: true, sync_id: syncId, pending, startDate, endDate })
  } catch (err) {
    await db.from('sync_logs').update({
      status: 'error', error_message: String(err), finished_at: new Date().toISOString(),
    }).eq('id', syncId)
    return NextResponse.json({ ok: false, sync_id: syncId, error: String(err) }, { status: 500 })
  }
}
