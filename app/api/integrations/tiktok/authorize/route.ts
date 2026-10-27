/** GET /api/integrations/tiktok/authorize — leva o vendedor para autorizar a loja (só logado). */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { tiktokAuthUrl, tiktokCred } from '@/lib/integrations/tiktok'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD) return NextResponse.redirect(`${base}/login`)
  const { extra } = await tiktokCred()
  if (!extra.service_id) return NextResponse.redirect(`${base}/dashboard/configuracoes?tiktok=erro_cadastre_as_chaves`)
  const state = crypto.randomBytes(16).toString('hex')
  const res = NextResponse.redirect(tiktokAuthUrl(extra.service_id, state))
  res.cookies.set('tt_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 900, path: '/' })
  return res
}
