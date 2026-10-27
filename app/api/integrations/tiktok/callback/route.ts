/** GET /api/integrations/tiktok/callback?code=&state= — troca o código, salva tokens e descobre a loja. */
import { NextRequest, NextResponse } from 'next/server'
import { tiktokTrocaCodigo, tiktokDescobreLoja } from '@/lib/integrations/tiktok'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.oryma.com.br'
  const sp = request.nextUrl.searchParams
  const code = sp.get('code')
  const volta = (q: string) => NextResponse.redirect(`${base}/dashboard/configuracoes?tiktok=${encodeURIComponent(q)}`)
  if (!code) return volta(`erro_${sp.get('error') ?? 'sem_code'}`)
  // só aceita a autorização de quem está logado no Oryma (mesmo navegador do /authorize)
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD) return NextResponse.redirect(`${base}/login`)
  // state confere com o cookie gravado no /authorize (proteção contra CSRF)
  if (!sp.get('state') || sp.get('state') !== request.cookies.get('tt_state')?.value) return volta('erro_state_invalido')
  try {
    await tiktokTrocaCodigo(code)
    const loja = await tiktokDescobreLoja()
    const r = volta(`conectada_${loja.name}`)
    r.cookies.delete('tt_state')
    return r
  } catch (e) {
    return volta(`erro_${String(e).slice(0, 80)}`)
  }
}
