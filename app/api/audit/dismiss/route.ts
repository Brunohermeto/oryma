/**
 * POST /api/audit/dismiss  body {ids: string[]}
 * Dispensa avisos da auditoria (some da Visão Geral e NÃO volta nas próximas
 * rodadas — a reconciliação preserva a dispensa por venda+regra).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { ids } = await request.json().catch(() => ({}))
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'ids é obrigatório' }, { status: 400 })
  }
  const db = createSupabaseServiceClient()
  const now = new Date().toISOString()
  let updated = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db.from('audit_findings')
      .update({ dismissed_at: now })
      .in('id', ids.slice(i, i + 200))
    if (!error) updated += Math.min(200, ids.length - i)
  }
  return NextResponse.json({ ok: true, dispensados: updated })
}
