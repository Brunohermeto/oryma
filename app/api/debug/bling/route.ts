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

  // Testa chamada simples à API do Bling com timeout de 8s
  let apiResult: string | null = null
  let apiMs: number | null = null
  if (cred?.access_token && !isTokenExpired(cred.expires_at)) {
    const t0 = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      const res = await fetch('https://www.bling.com.br/Api/v3/situacoes/modulos', {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${cred.access_token}` },
      })
      clearTimeout(timeout)
      apiMs = Date.now() - t0
      apiResult = `HTTP ${res.status} — ${apiMs}ms`
    } catch (e) {
      apiMs = Date.now() - t0
      apiResult = `ERRO: ${String(e)} (${apiMs}ms)`
    }
  }

  return NextResponse.json({
    credentials: {
      has_access_token: !!cred?.access_token,
      has_refresh_token: !!cred?.refresh_token,
      expires_at: cred?.expires_at,
      is_expired: isTokenExpired(cred?.expires_at ?? null),
      updated_at: cred?.updated_at,
    },
    token_refresh_test: isTokenExpired(cred?.expires_at ?? null) ? refreshResult : 'não necessário (token válido)',
    api_test: apiResult ?? 'não executado (token expirado)',
  })
}
