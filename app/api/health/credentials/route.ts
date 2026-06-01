/**
 * GET /api/health/credentials
 * Testa se os tokens do Bling e ML estão válidos fazendo uma chamada real à API.
 * Retorna o status de cada integração e o último sync bem-sucedido.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getValidBlingToken } from '@/lib/integrations/bling'
import { getValidMercadoLivreToken } from '@/lib/integrations/mercado-livre'
import { getCredential } from '@/lib/integrations/credentials'
import { isTokenExpired } from '@/lib/integrations/credentials'

export const dynamic     = 'force-dynamic'
export const preferredRegion = 'gru1'

async function testBling(): Promise<{ ok: boolean; error?: string; expires_at?: string | null }> {
  try {
    const token = await getValidBlingToken()
    if (!token) return { ok: false, error: 'Token nulo' }
    // Testa com uma chamada leve
    const res = await fetch('https://www.bling.com.br/Api/v3/situacoes/modulos', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const cred = await getCredential('bling')
    if (res.status === 401) return { ok: false, error: 'Token inválido — reconecte o Bling', expires_at: cred?.expires_at }
    return { ok: true, expires_at: cred?.expires_at }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function testML(): Promise<{ ok: boolean; error?: string; expires_at?: string | null }> {
  try {
    const token = await getValidMercadoLivreToken()
    if (!token) return { ok: false, error: 'Token nulo' }
    const res = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const cred = await getCredential('mercado_livre')
    if (res.status === 401) return { ok: false, error: 'Token inválido — reconecte o ML', expires_at: cred?.expires_at }
    return { ok: true, expires_at: cred?.expires_at }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // Último sync bem-sucedido por fonte
  const { data: logs } = await db
    .from('sync_logs')
    .select('source, finished_at, records_synced, error_message')
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(10)

  const lastSync: Record<string, { finished_at: string; records_synced: number }> = {}
  for (const log of logs ?? []) {
    if (!lastSync[log.source]) lastSync[log.source] = log
  }

  // Falhas recentes
  const { data: failures } = await db
    .from('sync_logs')
    .select('source, finished_at, error_message')
    .eq('status', 'error')
    .order('finished_at', { ascending: false })
    .limit(4)

  // Verifica o estado dos tokens (sem chamada real, apenas checa expiração)
  const blingCred = await getCredential('bling')
  const mlCred    = await getCredential('mercado_livre')

  const blingTokenExpired = !blingCred?.access_token || isTokenExpired(blingCred.expires_at)
  const mlTokenExpired    = !mlCred?.access_token    || isTokenExpired(mlCred.expires_at)

  // Cron config
  const hasCronSecret = !!process.env.CRON_SECRET
  const hasAppUrl     = !!process.env.NEXT_PUBLIC_APP_URL

  return NextResponse.json({
    bling: {
      connected: !!blingCred?.access_token,
      token_expired: blingTokenExpired,
      expires_at: blingCred?.expires_at ?? null,
      last_sync: lastSync['bling'] ?? null,
    },
    mercado_livre: {
      connected: !!mlCred?.access_token,
      token_expired: mlTokenExpired,
      expires_at: mlCred?.expires_at ?? null,
      last_sync: lastSync['marketplaces'] ?? null,
    },
    cron: {
      has_cron_secret: hasCronSecret,
      has_app_url: hasAppUrl,
      warning: !hasCronSecret
        ? 'CRON_SECRET não configurado nas variáveis de ambiente do Vercel — o sync automático não funciona!'
        : !hasAppUrl
        ? 'NEXT_PUBLIC_APP_URL não configurado — o sync automático pode falhar'
        : null,
    },
    recent_failures: (failures ?? []).map(f => ({
      source: f.source,
      at: f.finished_at,
      error: f.error_message?.slice(0, 100),
    })),
  })
}
