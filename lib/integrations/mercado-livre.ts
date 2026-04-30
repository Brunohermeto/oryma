import { getCredential, saveCredential, isTokenExpired } from './credentials'

const ML_BASE = 'https://api.mercadolibre.com'
const ML_AUTH_URL = 'https://auth.mercadolivre.com.br'

export function getMercadoLivreAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ML_CLIENT_ID!,
    redirect_uri: process.env.ML_REDIRECT_URI!,
  })
  return `${ML_AUTH_URL}/authorization?${params}`
}

export async function exchangeMercadoLivreCode(code: string): Promise<void> {
  const res = await fetch(`${ML_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI!,
    }),
  })
  if (!res.ok) throw new Error(`ML token exchange failed: ${res.status}`)
  const data = await res.json()
  await saveCredential('mercado_livre', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    extra: { seller_id: data.user_id },
  })
}

export async function getValidMercadoLivreToken(): Promise<string | null> {
  const cred = await getCredential('mercado_livre')
  if (!cred?.access_token) return null
  if (!isTokenExpired(cred.expires_at)) return cred.access_token

  const res = await fetch(`${ML_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      refresh_token: cred.refresh_token!,
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  await saveCredential('mercado_livre', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  })
  return data.access_token
}

export async function mlGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getValidMercadoLivreToken()
  if (!token) throw new Error('Mercado Livre não conectado')
  const url = new URL(`${ML_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`ML API error ${res.status}: ${path}`)
  return res.json()
}
