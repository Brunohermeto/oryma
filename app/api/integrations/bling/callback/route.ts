import { NextRequest, NextResponse } from 'next/server'
import { exchangeBlingCode } from '@/lib/integrations/bling'
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/dashboard/configuracoes?error=bling_no_code', request.url))
  try {
    await exchangeBlingCode(code)
    return NextResponse.redirect(new URL('/dashboard/configuracoes?connected=bling', request.url))
  } catch {
    return NextResponse.redirect(new URL('/dashboard/configuracoes?error=bling_failed', request.url))
  }
}
