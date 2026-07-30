import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const cookie = request.cookies.get('mi_auth')?.value
  const isLoggedIn = !!cookie &&
    (cookie === process.env.APP_PASSWORD ||
     (!!process.env.DEMO_PASSWORD && cookie === process.env.DEMO_PASSWORD))
  const isLoginPage = request.nextUrl.pathname === '/login'
  const path = request.nextUrl.pathname
  // Rotas públicas: auth, OAuth callbacks/webhooks (ML/Bling não têm cookie)
  // e cron do Vercel (autentica via CRON_SECRET dentro da rota)
  const isPublic =
    path.startsWith('/api/auth') ||
    path.startsWith('/api/integrations') ||
    path.startsWith('/api/cron')

  if (!isLoggedIn && !isLoginPage && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
