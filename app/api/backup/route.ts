/**
 * GET /api/backup?list=1            → nomes das tabelas
 * GET /api/backup?table=X&offset=N  → até 1000 linhas da tabela
 *
 * Usado pelo backup diário (.github/workflows/backup.yml), que guarda uma cópia
 * de TODO o banco FORA do Supabase. Motivo: em 22/09/2026 o projeto foi
 * excluído e os backups do próprio Supabase foram junto.
 * `credentials` (tokens OAuth) fica de fora: reconectar é possível; vazar não.
 */
import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const FORA = new Set(['credentials'])

export async function GET(request: NextRequest) {
  // rota exporta o banco inteiro: fecha se a senha não estiver configurada e
  // compara em tempo constante
  const expected = process.env.APP_PASSWORD
  const provided = request.cookies.get('mi_auth')?.value
  if (!expected || !provided || provided.length !== expected.length
      || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (request.nextUrl.searchParams.get('list') === '1') {
    const spec = await (await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json()
    const tabelas = Object.keys(spec.definitions ?? {}).filter(t => !FORA.has(t)).sort()
    return NextResponse.json({ tabelas })
  }

  const table = request.nextUrl.searchParams.get('table') ?? ''
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || FORA.has(table)) {
    return NextResponse.json({ error: 'tabela inválida' }, { status: 400 })
  }
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get('offset') ?? 0))
  const db = createSupabaseServiceClient()
  // ordem fixa por id (paginação estável); tabela sem id cai sem ordenação
  let r = await db.from(table).select('*').order('id').range(offset, offset + 999)
  if (r.error) r = await db.from(table).select('*').range(offset, offset + 999)
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  return NextResponse.json({ rows: r.data ?? [] })
}
