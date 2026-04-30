import { NextRequest, NextResponse } from 'next/server'
import { exchangeMercadoLivreCode } from '@/lib/integrations/mercado-livre'
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/dashboard/configuracoes?error=ml_no_code', request.url))
  try {
    await exchangeMercadoLivreCode(code)
    return NextResponse.redirect(new URL('/dashboard/configuracoes?connected=ml', request.url))
  } catch {
    return NextResponse.redirect(new URL('/dashboard/configuracoes?error=ml_failed', request.url))
  }
}
