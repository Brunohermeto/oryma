/** GET /api/integrations/magalu/callback — recebe o code e salva os tokens. */
import { NextRequest, NextResponse } from 'next/server'
import { exchangeMagaluCode } from '@/lib/integrations/magalu'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'
  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    // o ID Magalu devolve ?error=invalid_scope etc. — mostrar o motivo real
    const err = request.nextUrl.searchParams.get('error') ?? 'sem_code'
    return NextResponse.redirect(`${base}/dashboard/configuracoes?magalu=erro_${encodeURIComponent(err)}`)
  }
  try {
    await exchangeMagaluCode(code, `${base}/api/integrations/magalu/callback`)
    return NextResponse.redirect(`${base}/dashboard/configuracoes?magalu=conectada`)
  } catch (e) {
    return NextResponse.redirect(`${base}/dashboard/configuracoes?magalu=erro_${encodeURIComponent(String(e).slice(0, 80))}`)
  }
}
