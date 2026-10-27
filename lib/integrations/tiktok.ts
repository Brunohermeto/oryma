/**
 * TikTok Shop Open API (versão 202309). App "Vendedor do TikTok Shop" criado pelo
 * Bruno em 27/10/2026. Credenciais na linha 'tiktok' de credentials:
 *   extra.app_key / extra.app_secret / extra.service_id (cadastrados em Configurações)
 *   access_token / refresh_token / expires_at (autorização da loja)
 *   extra.shop_cipher / extra.shop_name (descobertos no callback)
 * Assinatura: HMAC-SHA256(secret, secret + path + params ordenados (sem sign e
 * access_token) + body + secret), em hex.
 */
import crypto from 'crypto'
import { getCredential, saveCredential, isTokenExpired } from './credentials'

const API = 'https://open-api.tiktokglobalshop.com'
const AUTH = 'https://auth.tiktok-shops.com'

type Extra = { app_key?: string; app_secret?: string; service_id?: string; shop_cipher?: string; shop_name?: string; shop_id?: string }

export async function tiktokCred() {
  const c = await getCredential('tiktok')
  return { cred: c, extra: (c?.extra ?? {}) as Extra }
}

export function tiktokAuthUrl(serviceId: string, state: string) {
  return `https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(serviceId)}&state=${encodeURIComponent(state)}`
}

export function tiktokSign(secret: string, path: string, params: Record<string, string>, body = ''): string {
  const base = Object.keys(params).filter(k => k !== 'sign' && k !== 'access_token').sort().map(k => k + params[k]).join('')
  return crypto.createHmac('sha256', secret).update(secret + path + base + body + secret).digest('hex')
}

async function salvaTokens(d: { access_token: string; refresh_token: string; access_token_expire_in: number }, extra: Extra) {
  await saveCredential('tiktok', {
    access_token: d.access_token, refresh_token: d.refresh_token,
    // access_token_expire_in vem como timestamp (segundos); folga de 10 min
    expires_at: new Date((Number(d.access_token_expire_in) - 600) * 1000).toISOString(),
    extra: extra as Record<string, unknown>,
  })
}

/** Troca o auth_code do callback por tokens. */
export async function tiktokTrocaCodigo(code: string) {
  const { extra } = await tiktokCred()
  if (!extra.app_key || !extra.app_secret) throw new Error('App Key/Secret do TikTok não cadastrados')
  const u = new URL(`${AUTH}/api/v2/token/get`)
  u.search = new URLSearchParams({ app_key: extra.app_key, app_secret: extra.app_secret, auth_code: code, grant_type: 'authorized_code' }).toString()
  const j = await (await fetch(u)).json()
  if (j.code !== 0 || !j.data?.access_token) throw new Error(`TikTok token: ${j.code} ${j.message ?? ''}`)
  await salvaTokens(j.data, extra)
}

async function renova(): Promise<string> {
  const { cred, extra } = await tiktokCred()
  if (!cred?.refresh_token || !extra.app_key || !extra.app_secret) throw new Error('TikTok não conectado — conectar em Configurações')
  const u = new URL(`${AUTH}/api/v2/token/refresh`)
  u.search = new URLSearchParams({ app_key: extra.app_key, app_secret: extra.app_secret, refresh_token: cred.refresh_token, grant_type: 'refresh_token' }).toString()
  const j = await (await fetch(u)).json()
  if (j.code !== 0 || !j.data?.access_token) throw new Error(`TikTok refresh: ${j.code} ${j.message ?? ''} — reconectar em Configurações`)
  await salvaTokens(j.data, extra)
  return j.data.access_token
}

/** Chamada assinada à API da loja (GET ou POST JSON). shop_cipher entra sozinho. */
export async function tiktokApi<T>(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, body?: unknown, semLoja = false): Promise<T> {
  const { cred, extra } = await tiktokCred()
  if (!cred?.access_token || !extra.app_key || !extra.app_secret) throw new Error('TikTok não conectado')
  const token = isTokenExpired(cred.expires_at) ? await renova() : cred.access_token
  const q: Record<string, string> = { ...params, app_key: extra.app_key, timestamp: String(Math.floor(Date.now() / 1000)) }
  if (!semLoja && extra.shop_cipher) q.shop_cipher = extra.shop_cipher
  const b = body != null ? JSON.stringify(body) : ''
  q.sign = tiktokSign(extra.app_secret, path, q, b)
  const res = await fetch(`${API}${path}?${new URLSearchParams(q)}`, {
    method, headers: { 'x-tts-access-token': token, 'content-type': 'application/json' }, ...(b ? { body: b } : {}),
  })
  const j = await res.json().catch(() => ({}))
  if (j.code !== 0) throw new Error(`TikTok ${path}: ${j.code ?? res.status} ${j.message ?? ''}`)
  return j.data as T
}

/** Depois de autorizar: descobre a loja (shop_cipher) e guarda. */
export async function tiktokDescobreLoja() {
  const d = await tiktokApi<{ shops?: Array<{ cipher: string; name: string; id: string; region: string }> }>('GET', '/authorization/202309/shops', {}, undefined, true)
  const loja = (d.shops ?? []).find(s => s.region === 'BR') ?? d.shops?.[0]
  if (!loja) throw new Error('Nenhuma loja autorizada no TikTok')
  const { cred, extra } = await tiktokCred()
  await saveCredential('tiktok', { extra: { ...extra, shop_cipher: loja.cipher, shop_name: loja.name, shop_id: loja.id }, access_token: cred?.access_token ?? undefined })
  return loja
}
