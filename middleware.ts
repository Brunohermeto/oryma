import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const isLoggedIn = request.cookies.get('mi_auth')?.value === process.env.APP_PASSWORD
  const isLoginPage = request.nextUrl.pathname === '/login'
  const isApiAuth = request.nextUrl.pathname.startsWith('/api/auth')

  if (!isLoggedIn && !isLoginPage && !isApiAuth) {
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
