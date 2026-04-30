import { NextRequest, NextResponse } from 'next/server'
import { saveAmazonCredentials } from '@/lib/integrations/amazon'
export async function POST(request: NextRequest) {
  const { seller_id, refresh_token } = await request.json()
  if (!seller_id || !refresh_token) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
  }
  await saveAmazonCredentials(seller_id, refresh_token)
  return NextResponse.json({ ok: true })
}
