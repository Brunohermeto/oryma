import { NextRequest, NextResponse } from 'next/server'
import { saveShopeeCredentials } from '@/lib/integrations/shopee'
export async function POST(request: NextRequest) {
  const { partner_id, shop_id, access_token } = await request.json()
  if (!partner_id || !shop_id || !access_token) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
  }
  await saveShopeeCredentials(partner_id, shop_id, access_token)
  return NextResponse.json({ ok: true })
}
