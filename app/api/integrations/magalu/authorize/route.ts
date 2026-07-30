/** GET /api/integrations/magalu/authorize — redireciona para o login da Magalu. */
import { NextResponse } from 'next/server'
import { magaluAuthUrl } from '@/lib/integrations/magalu'

export const dynamic = 'force-dynamic'

export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'
  return NextResponse.redirect(magaluAuthUrl(`${base}/api/integrations/magalu/callback`))
}
