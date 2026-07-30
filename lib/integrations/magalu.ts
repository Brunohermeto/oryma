import { getCredential, saveCredential, isTokenExpired } from './credentials'

/**
 * Magalu (ID Magalu / Magalu Devs, OAuth 2.0).
 * Access token dura ~2h; refresh_token renova (e pode rotacionar — salvar
 * sempre os dois). magaluGet renova sozinho antes de expirar.
 */
const AUTH_URL = 'https://id.magalu.com/login'
const TOKEN_URL = 'https://id.magalu.com/oauth/token'
export const MAGALU_API = 'https://api.magalu.com'

const SCOPES = [
  'open:order-order-seller:read',
  'open:order-delivery-seller:read',
  'open:order-invoice-seller:read',
  'open:order-financial-report-seller:read',
  'open:portfolio-skus-seller:read',
  'open:portfolio-prices-seller:read',
].join(' ')

/** URL para o seller autorizar o app (tela de consentimento do ID Magalu). */
export function magaluAuthUrl(redirectUrl: string): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', process.env.MAGALU_CLIENT_ID!)
  url.searchParams.set('redirect_uri', redirectUrl)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('choose_tenants', 'true')
  return url.toString()
}

async function saveTokens(data: { access_token: string; refresh_token?: string; expires_in?: number }, prevRefresh?: string | null) {
  await saveCredential('magalu', {
    access_token: data.access_token,
    // nunca sobrescrever com vazio (mesma trava do ML/Shopee)
    refresh_token: data.refresh_token || prevRefresh || undefined,
    expires_at: new Date(Date.now() + (Number(data.expires_in ?? 7200) - 300) * 1000).toISOString(),
  })
}

/** Troca o code do callback por tokens e salva a credencial. */
export async function exchangeMagaluCode(code: string, redirectUri: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.MAGALU_CLIENT_ID,
      client_secret: process.env.MAGALU_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(`Magalu token: ${data.error ?? res.status} ${data.error_description ?? ''}`)
  await saveTokens(data)
}

async function refreshMagaluToken(): Promise<string> {
  const cred = await getCredential('magalu')
  if (!cred?.refresh_token) throw new Error('Magalu sem refresh_token — reconectar em Configurações')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.MAGALU_CLIENT_ID!,
      client_secret: process.env.MAGALU_CLIENT_SECRET!,
      refresh_token: cred.refresh_token,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(`Magalu refresh: ${data.error ?? res.status} ${data.error_description ?? ''}`)
  await saveTokens(data, cred.refresh_token)
  return data.access_token
}

export async function magaluGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const cred = await getCredential('magalu')
  if (!cred?.access_token) throw new Error('Magalu não conectado')
  let token: string = cred.access_token
  if (isTokenExpired(cred.expires_at)) token = await refreshMagaluToken()

  const call = async (t: string) => {
    const url = new URL(`${MAGALU_API}${path}`)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    return fetch(url.toString(), {
      headers: { Authorization: `Bearer ${t}` },
      next: { revalidate: 0 },
    })
  }

  let res = await call(token)
  if (res.status === 401) {
    token = await refreshMagaluToken()
    res = await call(token)
  }
  if (!res.ok) throw new Error(`Magalu API ${path}: ${res.status} ${await res.text().then(t => t.slice(0, 200))}`)
  return res.json()
}
