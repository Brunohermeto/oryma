import { NextRequest, NextResponse } from 'next/server'
import { exchangeMercadoLivreCode } from '@/lib/integrations/mercado-livre'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'

// Notificações webhook do ML (POST) — responde 200 para parar os retries.
// O sync de vendas roda via cron; as notificações não são processadas aqui.
export async function POST() {
  return NextResponse.json({ ok: true })
}

export async function GET(request: NextRequest) {
  const code  = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')

  // ML negou a autorização (ex: usuário cancelou)
  if (error) {
    const msg = encodeURIComponent(`Mercado Livre negou: ${error}`)
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?oauth_error=${msg}`)
  }

  if (!code) {
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?oauth_error=ml_sem_code`)
  }

  try {
    await exchangeMercadoLivreCode(code)
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?connected=ml`)
  } catch (err) {
    const msg = encodeURIComponent(String(err).replace('Error: ', ''))
    return NextResponse.redirect(`${BASE}/dashboard/configuracoes?oauth_error=${msg}`)
  }
}
