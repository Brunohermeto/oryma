/**
 * GET /api/debug/bling-endpoints
 *
 * Diagnóstico: testa /pedidos/compras (caminho correto para NF-e entrada no Bling v3)
 * e valida se /nfe/documento/{chave}?formato=xml funciona para notas de entrada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getValidBlingToken } from '@/lib/integrations/bling'
import { gunzipSync } from 'zlib'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

const BLING_BASE = 'https://www.bling.com.br/Api/v3'

async function blingFetch(token: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${BLING_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, ok: res.ok, json, raw: text.slice(0, 300) }
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = await getValidBlingToken()
  if (!token) return NextResponse.json({ error: 'Bling não conectado' }, { status: 401 })

  const chaveEntrada = '31260308072288000111550000000000081253481690'

  // 1. Lista pedidos de compra (endpoint correto segundo documentação v3)
  const listaCompras = await blingFetch(token, '/pedidos/compras', { pagina: '1', limite: '5' })

  // 2. Detalhe do primeiro pedido de compra (se existir)
  let detalheCompra: unknown = null
  let camposDetalhe: string[] = []
  const compras = (listaCompras.json as any)?.data ?? []
  if (compras.length > 0) {
    const primeiroId = compras[0]?.id
    if (primeiroId) {
      const det = await blingFetch(token, `/pedidos/compras/${primeiroId}`)
      detalheCompra = det.status
      camposDetalhe = det.ok && det.json ? Object.keys((det.json as any)?.data ?? {}) : []
    }
  }

  // 3. Testa download XML da NF-e de entrada pela chave
  const xmlRes = await blingFetch(token, `/nfe/documento/${chaveEntrada}`, { formato: 'xml' })
  let xmlOk = false
  let xmlPreview = ''
  if (xmlRes.ok && xmlRes.json) {
    const conteudo = (xmlRes.json as any)?.data?.[0]?.conteudo
    if (conteudo) {
      try {
        const buf = Buffer.from(conteudo, 'base64')
        const xml = gunzipSync(buf).toString('utf-8')
        xmlOk = xml.includes('<')
        xmlPreview = xml.slice(0, 150)
      } catch {
        xmlOk = conteudo.includes('<')
        xmlPreview = conteudo.slice(0, 150)
      }
    }
  }

  return NextResponse.json({
    pedidos_compras: {
      status:   listaCompras.status,
      ok:       listaCompras.ok,
      total:    compras.length,
      // Mostra campos do primeiro registro (sem dados sensíveis)
      campos_listagem: compras.length > 0 ? Object.keys(compras[0]) : [],
      amostra_ids: compras.slice(0, 3).map((c: any) => c.id),
    },
    detalhe_primeiro_pedido: {
      status:  detalheCompra,
      campos:  camposDetalhe,
    },
    xml_entrada_por_chave: {
      chave:   chaveEntrada,
      status:  xmlRes.status,
      ok:      xmlOk,
      preview: xmlOk ? xmlPreview : xmlRes.raw,
    },
  })
}
