import { getCredential, saveCredential, isTokenExpired } from './credentials'

const AMAZON_BASE = 'https://sellingpartnerapi-na.amazon.com'
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

export async function saveAmazonCredentials(sellerId: string, refreshToken: string): Promise<void> {
  await saveCredential('amazon', {
    refresh_token: refreshToken,
    extra: { seller_id: sellerId },
  })
}

export async function getValidAmazonToken(): Promise<string | null> {
  const cred = await getCredential('amazon')
  if (!cred?.refresh_token) return null
  if (cred.access_token && !isTokenExpired(cred.expires_at)) return cred.access_token

  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cred.refresh_token,
      client_id: process.env.AMAZON_CLIENT_ID!,
      client_secret: process.env.AMAZON_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  await saveCredential('amazon', {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  })
  return data.access_token
}

export async function amazonGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getValidAmazonToken()
  if (!token) throw new Error('Amazon não conectado')
  const url = new URL(`${AMAZON_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), {
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Amazon API error ${res.status}: ${path}`)
  return res.json()
}
