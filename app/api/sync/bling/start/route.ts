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

  const db = createSupabaseServiceClient()

  // Suporte a janela explícita (daysFrom=30&daysTo=60) ou padrão (days=30)
  const daysFrom = Number(request.nextUrl.searchParams.get('daysFrom') ?? '0')
  const daysTo   = Number(request.nextUrl.searchParams.get('daysTo')   ?? request.nextUrl.searchParams.get('days') ?? '30')
  const limit    = Number(request.nextUrl.searchParams.get('limit') ?? '50')

  // skip: chaveAcesso já tentadas nesta sessão (separadas por vírgula)
  // Evita reprocessar as mesmas NF-e que falharam no match
  const skipParam  = request.nextUrl.searchParams.get('skip') ?? ''
  const skipChaves = new Set(skipParam.split(',').filter(Boolean))

  const startDate = brazilDaysAgo(daysTo)
  const endDate   = daysFrom === 0 ? brazilToday() : brazilDaysAgo(daysFrom)

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

    // Bling retorna NF-e em ordem DECRESCENTE de data e ignora os filtros de data.
    // Paginamos até encontrar NF-e dentro da janela [startDate, endDate],
    // parando quando a data da NF-e for anterior ao startDate.
    const allNfe: BlingNFeSaidaItem[] = []
    const MAX_PAGES = 30  // máx 3000 NF-e (cobre ~200 dias a 15 NF/dia)

    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await blingGet<{ data: BlingNFeSaidaItem[] }>('/nfe', {
        pagina: String(page), limite: '100',
      }, 1)
      const items = list.data ?? []
      if (!items.length) break

      let foundInWindow = false
      let allBeforeWindow = true

      for (const nfe of items) {
        const nfeDate = (nfe.dataEmissao ?? '').slice(0, 10)
        if (nfeDate >= startDate && nfeDate <= endDate) {
          allNfe.push(nfe)
          foundInWindow = true
          allBeforeWindow = false
        } else if (nfeDate > endDate) {
          // NF-e mais recente que a janela — ainda não chegamos no período
          allBeforeWindow = false
        } else if (nfeDate < startDate) {
          // NF-e mais antiga que a janela — passamos, podemos parar
          break
        }
      }

      // Se TODAS as NF-e desta página são anteriores ao startDate, paramos
      if (allBeforeWindow || (items.length > 0 && (items[items.length-1].dataEmissao ?? '').slice(0, 10) < startDate)) {
        break
      }

      if (items.length < 100) break  // última página da API
    }

    // Filtra: só séries válidas, não processadas e não tentadas nesta sessão
    const pending = allNfe
      .filter(nfe => nfe.tipo === 1)
      .filter(nfe => nfe.situacao === 5)
      .filter(nfe => isSerieValida(nfe.chaveAcesso))
      .filter(nfe => !nfe.chaveAcesso || !linkedChaves.has(nfe.chaveAcesso))
      .filter(nfe => !nfe.chaveAcesso || !skipChaves.has(nfe.chaveAcesso))  // pula tentadas nesta sessão
      .slice(0, limit)
      .map(nfe => ({ id: nfe.id, chaveAcesso: nfe.chaveAcesso }))

    return NextResponse.json({
      ok: true, sync_id: syncId, pending, startDate, endDate,
      total_in_window: allNfe.filter(n => n.tipo === 1 && n.situacao === 5).length,
    })
  } catch (err) {
    await db.from('sync_logs').update({
      status: 'error', error_message: String(err), finished_at: new Date().toISOString(),
    }).eq('id', syncId)
    return NextResponse.json({ ok: false, sync_id: syncId, error: String(err) }, { status: 500 })
  }
}
