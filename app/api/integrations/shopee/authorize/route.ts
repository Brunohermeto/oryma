/** GET /api/integrations/shopee/authorize — redireciona para o login da Shopee. */
import { NextResponse } from 'next/server'
import { shopeeAuthUrl } from '@/lib/integrations/shopee'

export const dynamic = 'force-dynamic'

export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'
  return NextResponse.redirect(shopeeAuthUrl(`${base}/api/integrations/shopee/callback`))
}
