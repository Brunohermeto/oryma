import { NextRequest, NextResponse } from 'next/server'
import { getCredential } from '@/lib/integrations/credentials'
import { isTokenExpired } from '@/lib/integrations/credentials'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cred = await getCredential('bling')

  // Testa token refresh se estiver expirado
  let refreshResult: string | null = null
  if (cred?.access_token && isTokenExpired(cred.expires_at)) {
    try {
      const authHeader = `Basic ${Buffer.from(
        `${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`
      ).toString('base64')}`

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: cred.refresh_token ?? '',
        }),
      })
      clearTimeout(timeout)
      refreshResult = `HTTP ${res.status} ${res.statusText}`
    } catch (e) {
      refreshResult = `ERRO: ${String(e)}`
    }
  }

  // Testa múltiplos endpoints para identificar qual módulo está bloqueado
  async function testEndpoint(path: string): Promise<string> {
    if (!cred?.access_token || isTokenExpired(cred.expires_at)) return 'token inválido'
    const t0 = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(`https://www.bling.com.br/Api/v3${path}`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${cred!.access_token}` },
      })
      clearTimeout(timeout)
      let body = ''
      try { const j = await res.json(); body = JSON.stringify(j).slice(0, 100) } catch {}
      return `HTTP ${res.status} — ${Date.now() - t0}ms${body ? ` — ${body}` : ''}`
    } catch (e) {
      return `ERRO: ${String(e)} (${Date.now() - t0}ms)`
    }
  }

  // Pega primeiro NF-e completo para ver todos os campos retornados
  let nfeFullObject: unknown = null
  if (cred?.access_token && !isTokenExpired(cred.expires_at)) {
    try {
      const now = new Date()
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
      const startDate = yesterday.toISOString().slice(0, 10)
      const endDate = now.toISOString().slice(0, 10)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(
        `https://www.bling.com.br/Api/v3/nfe?pagina=1&limite=1&dataEmissaoInicio=${startDate}&dataEmissaoFim=${endDate}`,
        { signal: controller.signal, headers: { Authorization: `Bearer ${cred.access_token}` } }
      )
      clearTimeout(timeout)
      const json = await res.json()
      nfeFullObject = json?.data?.[0] ?? null  // objeto completo do primeiro NF-e
    } catch {}
  }

  const [usuariosMe, nfeList, nfeCategoria] = await Promise.all([
    testEndpoint('/usuarios/me'),
    testEndpoint('/nfe?pagina=1&limite=1'),
    testEndpoint('/situacoes/modulos'),
  ])

  return NextResponse.json({
    credentials: {
      has_access_token: !!cred?.access_token,
      has_refresh_token: !!cred?.refresh_token,
      expires_at: cred?.expires_at,
      is_expired: isTokenExpired(cred?.expires_at ?? null),
      updated_at: cred?.updated_at,
    },
    token_refresh_test: isTokenExpired(cred?.expires_at ?? null) ? refreshResult : 'não necessário (token válido)',
    api_tests: {
      '/usuarios/me': usuariosMe,
      '/nfe?pagina=1&limite=1': nfeList,
      '/situacoes/modulos': nfeCategoria,
    },
    nfe_first_object: nfeFullObject,  // todos os campos do primeiro NF-e
  })
}
