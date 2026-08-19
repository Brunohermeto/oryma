import crypto from 'crypto'
import { getCredential, saveCredential, isTokenExpired } from './credentials'

/**
 * Shopee Open Platform v2.
 * Token de acesso expira em ~4h; refresh_token dura ~30 dias e ROTACIONA a
 * cada uso. shopeeGet renova sozinho antes de expirar — enquanto o ciclo
 * diário rodar, a conexão nunca morre (a antiga morreu por não renovar).
 */
const SHOPEE_BASE = 'https://partner.shopeemobile.com'

// Assinatura para APIs de LOJA: partner_id + path + timestamp + access_token + shop_id
function signShop(path: string, ts: number, accessToken: string, shopId: string): string {
  const base = `${process.env.SHOPEE_PARTNER_ID}${path}${ts}${accessToken}${shopId}`
  return crypto.createHmac('sha256', process.env.SHOPEE_PARTNER_KEY!).update(base).digest('hex')
}
// Assinatura PÚBLICA (autorização e troca de token): partner_id + path + timestamp
function signPublic(path: string, ts: number): string {
  const base = `${process.env.SHOPEE_PARTNER_ID}${path}${ts}`
  return crypto.createHmac('sha256', process.env.SHOPEE_PARTNER_KEY!).update(base).digest('hex')
}

/** URL para o lojista autorizar o app (abre a tela de login da Shopee). */
export function shopeeAuthUrl(redirectUrl: string): string {
  const path = '/api/v2/shop/auth_partner'
  const ts = Math.floor(Date.now() / 1000)
  const url = new URL(`${SHOPEE_BASE}${path}`)
  url.searchParams.set('partner_id', process.env.SHOPEE_PARTNER_ID!)
  url.searchParams.set('timestamp', String(ts))
  url.searchParams.set('sign', signPublic(path, ts))
  url.searchParams.set('redirect', redirectUrl)
  return url.toString()
}

async function tokenRequest(path: string, body: Record<string, unknown>): Promise<any> {
  const ts = Math.floor(Date.now() / 1000)
  const url = new URL(`${SHOPEE_BASE}${path}`)
  url.searchParams.set('partner_id', process.env.SHOPEE_PARTNER_ID!)
  url.searchParams.set('timestamp', String(ts))
  url.searchParams.set('sign', signPublic(path, ts))
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Shopee ${path}: ${data.error} ${data.message ?? ''}`)
  return data
}

/** Troca o code do callback por tokens e salva a credencial. */
export async function exchangeShopeeCode(code: string, shopId: string): Promise<void> {
  const data = await tokenRequest('/api/v2/auth/token/get', {
    code,
    shop_id: Number(shopId),
    partner_id: Number(process.env.SHOPEE_PARTNER_ID),
  })
  await saveCredential('shopee', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + (Number(data.expire_in ?? 14400) - 300) * 1000).toISOString(),
    extra: { partner_id: process.env.SHOPEE_PARTNER_ID, shop_id: shopId },
  })
}

/** Renova o access_token (o refresh_token TAMBÉM rotaciona — salvar os dois). */
async function refreshShopeeToken(): Promise<string> {
  const cred = await getCredential('shopee')
  if (!cred?.refresh_token) throw new Error('Shopee sem refresh_token — reconectar em Configurações')
  const shopId = String((cred.extra as Record<string, unknown>)?.shop_id ?? '')
  const data = await tokenRequest('/api/v2/auth/access_token/get', {
    refresh_token: cred.refresh_token,
    shop_id: Number(shopId),
    partner_id: Number(process.env.SHOPEE_PARTNER_ID),
  })
  await saveCredential('shopee', {
    access_token: data.access_token,
    // nunca sobrescrever com vazio (mesma trava do ML)
    refresh_token: data.refresh_token || cred.refresh_token,
    expires_at: new Date(Date.now() + (Number(data.expire_in ?? 14400) - 300) * 1000).toISOString(),
    extra: cred.extra,
  })
  return data.access_token
}

export async function shopeeGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const cred = await getCredential('shopee')
  if (!cred?.access_token) throw new Error('Shopee não conectado')
  let accessToken: string = cred.access_token
  if (isTokenExpired(cred.expires_at)) accessToken = await refreshShopeeToken()

  const shopId = String((cred.extra as Record<string, unknown>)?.shop_id ?? '')
  const call = async (token: string) => {
    const ts = Math.floor(Date.now() / 1000)
    const url = new URL(`${SHOPEE_BASE}/api/v2${path}`)
    url.searchParams.set('partner_id', process.env.SHOPEE_PARTNER_ID!)
    url.searchParams.set('shop_id', shopId)
    url.searchParams.set('timestamp', String(ts))
    url.searchParams.set('access_token', token)
    url.searchParams.set('sign', signShop(`/api/v2${path}`, ts, token, shopId))
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const res = await fetch(url.toString(), { next: { revalidate: 0 } })
    return res.json()
  }

  let data = await call(accessToken)
  // token invalidado no meio do caminho → renova uma vez e repete
  if (data?.error && String(data.error).includes('auth')) {
    accessToken = await refreshShopeeToken()
    data = await call(accessToken)
  }
  if (data?.error) throw new Error(`Shopee API ${path}: ${data.error} ${data.message ?? ''}`)
  return data as T
}

/** Versão POST (body JSON) — necessária para os endpoints FBS de nota fiscal do Full. */
export async function shopeePost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const cred = await getCredential('shopee')
  if (!cred?.access_token) throw new Error('Shopee não conectado')
  let accessToken: string = cred.access_token
  if (isTokenExpired(cred.expires_at)) accessToken = await refreshShopeeToken()
  const shopId = String((cred.extra as Record<string, unknown>)?.shop_id ?? '')
  const call = async (token: string) => {
    const ts = Math.floor(Date.now() / 1000)
    const url = new URL(`${SHOPEE_BASE}/api/v2${path}`)
    url.searchParams.set('partner_id', process.env.SHOPEE_PARTNER_ID!)
    url.searchParams.set('shop_id', shopId)
    url.searchParams.set('timestamp', String(ts))
    url.searchParams.set('access_token', token)
    url.searchParams.set('sign', signShop(`/api/v2${path}`, ts, token, shopId))
    const res = await fetch(url.toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), next: { revalidate: 0 },
    })
    return res.json()
  }
  let data = await call(accessToken)
  if (data?.error && String(data.error).includes('auth')) {
    accessToken = await refreshShopeeToken()
    data = await call(accessToken)
  }
  return data as T
}
