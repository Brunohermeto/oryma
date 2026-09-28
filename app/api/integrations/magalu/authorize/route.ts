/** GET /api/integrations/magalu/authorize[?simples=1] — redireciona para o login da Magalu. */
import { NextRequest, NextResponse } from 'next/server'
import { magaluAuthUrl } from '@/lib/integrations/magalu'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'
  const simples = request.nextUrl.searchParams.get('simples') === '1'
  return NextResponse.redirect(magaluAuthUrl(`${base}/api/integrations/magalu/callback`, !simples))
}
