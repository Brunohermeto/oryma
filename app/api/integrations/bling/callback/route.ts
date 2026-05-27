import { NextRequest, NextResponse } from 'next/server'
import { exchangeBlingCode } from '@/lib/integrations/bling'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'

export async function GET(request: NextRequest) {
  const code  = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')

  // Bling negou a autorização (ex: usuário cancelou)
  if (error) {
    const msg = encodeURIComponent(`Bling negou a autorização: ${error}`)
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?oauth_error=${msg}`)
  }

  if (!code) {
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?oauth_error=bling_sem_code`)
  }

  try {
    await exchangeBlingCode(code)
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?connected=bling`)
  } catch (err) {
    const msg = encodeURIComponent(String(err).replace('Error: ', ''))
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?oauth_error=${msg}`)
  }
}
