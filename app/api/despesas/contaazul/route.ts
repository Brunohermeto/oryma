/**
 * POST /api/despesas/contaazul
 *  - multipart (file): relatório "Visão Contas a Pagar" da Conta Azul → despesas
 *    do DRE. Substitui o que veio da Conta Azul nos meses do arquivo (reenviar é seguro).
 *  - JSON { categoria, destino }: grava o destino de uma categoria nova.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { classificar, lerXlsx, MAPA_PADRAO, type Lancamento } from '@/lib/despesas/contaazul'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createSupabaseServiceClient()

  if (request.headers.get('content-type')?.includes('application/json')) {
    const { categoria, destino } = await request.json()
    if (!categoria || !destino) return NextResponse.json({ error: 'categoria e destino obrigatórios' }, { status: 400 })
    const { error } = await db.from('contaazul_categorias')
      .upsert({ categoria: String(categoria).toLowerCase(), destino, updated_at: new Date().toISOString() })
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }

  const file = (await request.formData()).get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Envie o arquivo .xls da Conta Azul' }, { status: 400 })
  let rows
  try { rows = lerXlsx(new Uint8Array(await file.arrayBuffer())) }
  catch { return NextResponse.json({ error: 'Não consegui ler o arquivo — exporte de novo da Conta Azul (.xls)' }, { status: 400 }) }

  const { data: escolhas } = await db.from('contaazul_categorias').select('categoria, destino')
  const mapa = { ...MAPA_PADRAO, ...Object.fromEntries((escolhas ?? []).map(e => [e.categoria, e.destino])) }
  let lancs: Lancamento[]
  try { lancs = classificar(rows, mapa) } catch (e) { return NextResponse.json({ error: String((e as Error).message) }, { status: 400 }) }

  const pendentes = [...new Set(lancs.filter(l => !l.destino).map(l => l.categoria))]
  const meses = [...new Set(lancs.map(l => l.period))]
  const entra = lancs.filter(l => l.destino && l.destino !== 'ignorar')

  // substitui o envio anterior dos mesmos meses
  if (meses.length) {
    const { error } = await db.from('operational_expenses').delete().eq('source', 'contaazul').in('period', meses)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (entra.length) {
    const { error } = await db.from('operational_expenses').insert(entra.map(l => ({
      period: l.period, payment_date: l.payment_date, dre_category: l.destino, subcategory: l.categoria,
      description: l.description, supplier: l.supplier, amount: l.amount, source: 'contaazul',
    })))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const somaPor = (f: (l: Lancamento) => boolean) => {
    const m: Record<string, number> = {}
    for (const l of lancs.filter(f)) m[l.categoria] = Math.round(((m[l.categoria] ?? 0) + l.amount) * 100) / 100
    return m
  }
  return NextResponse.json({
    ok: true, meses, lancamentos: lancs.length,
    no_dre: Math.round(entra.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    ignorado: somaPor(l => l.destino === 'ignorar'),
    pendentes: pendentes.map(c => ({ categoria: c, valor: somaPor(l => l.categoria === c)[c] })),
  })
}
