import crypto from 'crypto'
import { getCredential, saveCredential } from './credentials'

const SHOPEE_BASE = 'https://partner.shopeemobile.com'

function shopeeSign(path: string, timestamp: number, accessToken: string, shopId: string): string {
  const partnerId = process.env.SHOPEE_PARTNER_ID!
  const partnerKey = process.env.SHOPEE_PARTNER_KEY!
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

export async function saveShopeeCredentials(partnerId: string, shopId: string, accessToken: string): Promise<void> {
  await saveCredential('shopee', {
    access_token: accessToken,
    extra: { partner_id: partnerId, shop_id: shopId },
  })
}

export async function shopeeGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const cred = await getCredential('shopee')
  if (!cred?.access_token) throw new Error('Shopee não conectado')
  const partnerId = String((cred.extra as Record<string, unknown>)?.partner_id ?? process.env.SHOPEE_PARTNER_ID!)
  const shopId = String((cred.extra as Record<string, unknown>)?.shop_id ?? '')
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = shopeeSign(path, timestamp, cred.access_token, shopId)

  const url = new URL(`${SHOPEE_BASE}/api/v2${path}`)
  url.searchParams.set('partner_id', partnerId)
  url.searchParams.set('shop_id', shopId)
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('access_token', cred.access_token)
  url.searchParams.set('sign', sign)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url.toString(), { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`Shopee API error ${res.status}: ${path}`)
  return res.json()
}
