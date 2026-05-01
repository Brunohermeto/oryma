import { getCredential, saveCredential, isTokenExpired } from './credentials'

const BLING_BASE = 'https://www.bling.com.br/Api/v3'
const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token'

export function getBlingAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.BLING_CLIENT_ID!,
    redirect_uri: process.env.BLING_REDIRECT_URI!,
    state: crypto.randomUUID(),
  })
  return `https://www.bling.com.br/Api/v3/oauth/authorize?${params}`
}

function blingAuthHeader(): string {
  return `Basic ${Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64')}`
}

export async function exchangeBlingCode(code: string): Promise<void> {
  const res = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: blingAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.BLING_REDIRECT_URI! }),
  })
  if (!res.ok) throw new Error(`Bling token exchange failed: ${res.status}`)
  const data = await res.json()
  await saveCredential('bling', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  })
}

export async function getValidBlingToken(): Promise<string | null> {
  const cred = await getCredential('bling')
  if (!cred?.access_token) return null
  if (!isTokenExpired(cred.expires_at)) return cred.access_token

  const res = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: blingAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cred.refresh_token! }),
  })
  if (!res.ok) return null
  const data = await res.json()
  await saveCredential('bling', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  })
  return data.access_token
}

export async function blingGet<T>(path: string, params?: Record<string, string>, retries = 3): Promise<T> {
  const token = await getValidBlingToken()
  if (!token) throw new Error('Bling não conectado')
  const url = new URL(`${BLING_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    })

    // Rate limit — espera e tenta novamente
    if (res.status === 429) {
      if (attempt === retries) throw new Error(`Bling API error 429: ${path}`)
      const wait = Math.pow(2, attempt) * 1000 + Math.random() * 500 // 1s, 2s, 4s + jitter
      await new Promise(r => setTimeout(r, wait))
      continue
    }

    if (!res.ok) throw new Error(`Bling API error ${res.status}: ${path}`)
    return res.json()
  }

  throw new Error(`Bling API error: max retries exceeded for ${path}`)
}
