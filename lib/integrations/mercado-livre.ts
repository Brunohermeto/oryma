import { getCredential, saveCredential, isTokenExpired } from './credentials'

const ML_BASE = 'https://api.mercadolibre.com'
const ML_AUTH_URL = 'https://auth.mercadolivre.com.br'

export function getMercadoLivreAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ML_CLIENT_ID!,
    redirect_uri: process.env.ML_REDIRECT_URI!,
    scope: 'offline_access read write',  // offline_access = refresh token de longa duração
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

export async function getValidMercadoLivreToken(): Promise<string> {
  const cred = await getCredential('mercado_livre')
  if (!cred?.access_token) throw new Error('Mercado Livre não conectado — acesse Configurações e clique em Conectar')
  if (!isTokenExpired(cred.expires_at)) return cred.access_token

  // Proteção contra race condition: se o token foi atualizado nos últimos 30s
  // por outro processo, re-lê as credenciais em vez de renovar com o token antigo.
  // O ML invalida imediatamente o refresh_token após uso — duas renovações simultâneas
  // corrompem as credenciais.
  if (cred.updated_at) {
    const updatedAgoSec = (Date.now() - new Date(cred.updated_at).getTime()) / 1000
    if (updatedAgoSec < 30) {
      // Outro processo pode estar renovando — re-lê e usa o token mais recente
      const fresh = await getCredential('mercado_livre')
      if (fresh?.access_token && !isTokenExpired(fresh.expires_at)) {
        return fresh.access_token
      }
    }
  }

  // Token expirado — renova
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
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Token ML expirado — reconecte em Configurações (${res.status}: ${body.slice(0, 80)})`)
  }
  const data = await res.json()

  // Preserva extra (seller_id) ao salvar — o saveCredential sem extra limparia o campo
  const existingExtra = (cred as any).extra
  await saveCredential('mercado_livre', {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    new Date(Date.now() + data.expires_in * 1000).toISOString(),
    ...(existingExtra ? { extra: existingExtra } : {}),
  })
  return data.access_token
}

export async function getMercadoLivreSellerId(): Promise<string | null> {
  const cred = await getCredential('mercado_livre')
  const extra = cred?.extra as Record<string, unknown> | null
  return extra?.seller_id ? String(extra.seller_id) : null
}

export async function mlGet<T>(path: string, params?: Record<string, string>, retries = 3): Promise<T> {
  const token = await getValidMercadoLivreToken() // já lança erro se não conectado ou expirado
  const url = new URL(`${ML_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    })

    // Rate limit — espera e tenta novamente
    if (res.status === 429) {
      if (attempt === retries) throw new Error(`ML API error 429: ${path}`)
      const wait = Math.pow(2, attempt) * 1000 + Math.random() * 500
      await new Promise(r => setTimeout(r, wait))
      continue
    }

    if (!res.ok) throw new Error(`ML API error ${res.status}: ${path}`)
    return res.json()
  }

  throw new Error(`ML API error: max retries exceeded for ${path}`)
}
