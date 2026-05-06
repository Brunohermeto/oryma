/**
 * GET /api/debug/bling-endpoints
 * Testa múltiplos endpoints do Bling para encontrar NF-e de entrada.
 * Remove após resolver.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getValidBlingToken } from '@/lib/integrations/bling'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

const BLING_BASE = 'https://www.bling.com.br/Api/v3'

async function tryEndpoint(token: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${BLING_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = text.slice(0, 200) }
    return { status: res.status, ok: res.ok, data }
  } catch (err) {
    return { status: 0, ok: false, data: String(err) }
  }
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = await getValidBlingToken()
  if (!token) return NextResponse.json({ error: 'Bling não conectado' }, { status: 401 })

  const chaveEntrada = '31260308072288000111550000000000081253481690'

  const results = await Promise.all([
    // Testa endpoint de NF-e de entrada
    tryEndpoint(token, '/nfe/entrada',          { pagina: '1', limite: '5' }).then(r => ({ path: '/nfe/entrada', ...r })),
    tryEndpoint(token, '/compras',              { pagina: '1', limite: '5' }).then(r => ({ path: '/compras', ...r })),
    tryEndpoint(token, '/compras/notas-fiscais',{ pagina: '1', limite: '5' }).then(r => ({ path: '/compras/notas-fiscais', ...r })),
    tryEndpoint(token, '/notasfiscaiscompra',   { pagina: '1', limite: '5' }).then(r => ({ path: '/notasfiscaiscompra', ...r })),
    // Testa se consegue baixar XML da NF-e de entrada pela chave
    tryEndpoint(token, `/nfe/documento/${chaveEntrada}`, { formato: 'xml' }).then(r => ({ path: `/nfe/documento/${chaveEntrada}?formato=xml`, ...r })),
  ])

  return NextResponse.json({
    note: 'Testando endpoints para NF-e de entrada do Bling',
    chave_testada: chaveEntrada,
    results: results.map(r => ({
      path:   r.path,
      status: r.status,
      ok:     r.ok,
      // Resumo da resposta sem expor dados sensíveis
      summary: r.ok
        ? (typeof r.data === 'object' && r.data !== null && 'data' in (r.data as object)
            ? `${(r.data as any).data?.length ?? 0} registros` : 'ok mas sem data[]')
        : String((r.data as any)?.error?.type ?? (r.data as any)?.message ?? r.data).slice(0, 100),
    })),
  })
}
