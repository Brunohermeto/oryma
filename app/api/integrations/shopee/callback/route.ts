/** GET /api/integrations/shopee/callback — recebe code + shop_id e salva os tokens. */
import { NextRequest, NextResponse } from 'next/server'
import { exchangeShopeeCode } from '@/lib/integrations/shopee'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'
  const code = request.nextUrl.searchParams.get('code')
  const shopId = request.nextUrl.searchParams.get('shop_id')
  if (!code || !shopId) {
    return NextResponse.redirect(`${base}/dashboard/configuracoes?shopee=erro_sem_code`)
  }
  try {
    await exchangeShopeeCode(code, shopId)
    return NextResponse.redirect(`${base}/dashboard/configuracoes?shopee=conectada`)
  } catch (e) {
    return NextResponse.redirect(`${base}/dashboard/configuracoes?shopee=erro_${encodeURIComponent(String(e).slice(0, 80))}`)
  }
}
