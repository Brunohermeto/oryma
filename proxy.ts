import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const isLoggedIn = request.cookies.get('mi_auth')?.value === process.env.APP_PASSWORD
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
