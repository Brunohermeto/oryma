/**
 * GET /api/debug/oauth-config
 * Diagnóstico: verifica se as env vars de OAuth estão configuradas no Vercel.
 * Não exibe valores completos — só se estão presentes e os primeiros/últimos chars.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAllCredentials } from '@/lib/integrations/credentials'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

function maskSecret(v: string | undefined): string {
  if (!v) return '❌ NÃO DEFINIDA'
  if (v.length <= 8) return '✓ definida (muito curta — verifique)'
  return `✓ ${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)`
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const credentials = await getAllCredentials()
  const credMap = Object.fromEntries(credentials.map(c => [c.id, c]))

  return NextResponse.json({
    env_vars: {
      BLING_CLIENT_ID:      maskSecret(process.env.BLING_CLIENT_ID),
      BLING_CLIENT_SECRET:  maskSecret(process.env.BLING_CLIENT_SECRET),
      BLING_REDIRECT_URI:   process.env.BLING_REDIRECT_URI ?? '❌ NÃO DEFINIDA',
      ML_CLIENT_ID:         maskSecret(process.env.ML_CLIENT_ID),
      ML_CLIENT_SECRET:     maskSecret(process.env.ML_CLIENT_SECRET),
      ML_REDIRECT_URI:      process.env.ML_REDIRECT_URI ?? '❌ NÃO DEFINIDA',
      NEXT_PUBLIC_APP_URL:  process.env.NEXT_PUBLIC_APP_URL ?? '❌ NÃO DEFINIDA (usando fallback https://www.oryma.com.br)',
    },
    saved_credentials: {
      bling: credMap['bling']
        ? { connected: true, expires_at: credMap['bling'].expires_at, updated_at: credMap['bling'].updated_at }
        : { connected: false },
      mercado_livre: credMap['mercado_livre']
        ? { connected: true, expires_at: credMap['mercado_livre'].expires_at, updated_at: credMap['mercado_livre'].updated_at }
        : { connected: false },
    },
    expected_callback_urls: {
      bling: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'}/api/integrations/bling/callback`,
      ml:    `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'}/api/integrations/ml/callback`,
    },
  })
}
