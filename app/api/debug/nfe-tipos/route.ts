/**
 * GET /api/debug/nfe-tipos
 * Mostra os tipos e situações reais das NF-e no Bling (sem filtrar nada).
 * Usado para diagnosticar por que NF-e de entrada não estão sendo encontradas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGet } from '@/lib/integrations/bling'
import { brazilToday, brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

interface BlingNFeRaw {
  id: number
  tipo: number
  situacao: number
  dataEmissao: string
  chaveAcesso: string | null
  numero?: string
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const days      = Number(request.nextUrl.searchParams.get('days') ?? '180')
  const startDate = brazilDaysAgo(days)
  const endDate   = brazilToday()

  const allNfe: BlingNFeRaw[] = []
  for (let page = 1; page <= 5; page++) {
    const res = await blingGet<{ data: BlingNFeRaw[] }>('/nfe', {
      pagina: String(page), limite: '100',
      dataEmissaoInicio: startDate, dataEmissaoFim: endDate,
    }, 1)
    const items = res.data ?? []
    allNfe.push(...items)
    if (items.length < 100) break
  }

  // Agrupa por tipo e situação para diagnóstico
  const byTipo: Record<string, number>     = {}
  const bySituacao: Record<string, number> = {}
  for (const n of allNfe) {
    const t = `tipo_${n.tipo}`
    const s = `situacao_${n.situacao}`
    byTipo[t]     = (byTipo[t]     ?? 0) + 1
    bySituacao[s] = (bySituacao[s] ?? 0) + 1
  }

  // Mostra amostra de NF-e tipo=2 (entrada)
  const entradas = allNfe.filter(n => n.tipo === 2)

  return NextResponse.json({
    total:      allNfe.length,
    periodo:    { startDate, endDate, days },
    byTipo,
    bySituacao,
    entradas_count: entradas.length,
    entradas_amostra: entradas.slice(0, 10).map(n => ({
      id:         n.id,
      tipo:       n.tipo,
      situacao:   n.situacao,
      data:       n.dataEmissao,
      chave:      n.chaveAcesso?.slice(-12) ?? null,
    })),
  })
}
