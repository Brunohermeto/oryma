/** POST /api/integrations/tiktok/save { app_key, app_secret, service_id } — só logado.
 *  (/api/integrations fica fora do proxy de login por causa dos callbacks) */
import { NextRequest, NextResponse } from 'next/server'
import { saveCredential } from '@/lib/integrations/credentials'
import { tiktokCred } from '@/lib/integrations/tiktok'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { app_key, app_secret, service_id } = await request.json()
  const limpo = (v: unknown) => String(v ?? '').trim()
  if (!limpo(app_key) || !limpo(app_secret) || !/^\d+$/.test(limpo(service_id)))
    return NextResponse.json({ error: 'Preencha Service ID (só números), App Key e App Secret' }, { status: 400 })
  const { extra } = await tiktokCred()
  await saveCredential('tiktok', { extra: { ...extra, app_key: limpo(app_key), app_secret: limpo(app_secret), service_id: limpo(service_id) } })
  return NextResponse.json({ ok: true })
}
