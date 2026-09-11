/**
 * POST /api/sync/amazon/nfe-vendas   (multipart: files = XMLs e/ou .zip)
 *
 * Importa as NF-e de VENDA da Amazon FBA (o "faturador") e vincula às vendas.
 * A Amazon não emite essas notas pelo Bling nem expõe na API de pedidos — o
 * único jeito (até a Tax Invoicing API sair) é o export manual de XMLs.
 *
 * Para cada XML de VENDA: casa pelo número do pedido Amazon (formato 3-7-7 que
 * está no próprio XML) e grava chave + impostos (rateado por item) + UF destino.
 * Só preenche vendas SEM NF (idempotente). Ignora remessas/retornos simbólicos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { unzipSync, strFromU8 } from 'fflate'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const tagIn = (block: string, t: string) => {
  const m = block.match(new RegExp(`<${t}>([^<]+)</${t}>`))
  return m ? parseFloat(m[1]) : 0
}

export async function POST(request: NextRequest) {
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createSupabaseServiceClient()

  // 1. Coleta todos os XMLs (aceita .xml soltos e/ou .zip)
  const form = await request.formData()
  const files = form.getAll('files') as File[]
  const xmls: string[] = []
  for (const f of files) {
    const name = (f.name || '').toLowerCase()
    if (name.endsWith('.zip')) {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()))
      for (const [n, u8] of Object.entries(entries)) {
        if (n.toLowerCase().endsWith('.xml')) xmls.push(strFromU8(u8))
      }
    } else if (name.endsWith('.xml')) {
      xmls.push(await f.text())
    }
  }
  if (!xmls.length) return NextResponse.json({ ok: false, error: 'Nenhum XML encontrado (envie os .xml ou o .zip do faturador).' }, { status: 400 })

  // 2. Processa só as notas de VENDA e casa pelo pedido
  let vendas = 0, vinculadas = 0, jaTinham = 0, semVenda = 0, naoVenda = 0
  for (const xml of xmls) {
    const nat = xml.match(/<natOp>([^<]+)<\/natOp>/)?.[1] ?? ''
    if (!/venda/i.test(nat)) { naoVenda++; continue }
    vendas++
    const chave = xml.match(/Id="NFe(\d{44})"/)?.[1]
    const order = xml.match(/\d{3}-\d{7}-\d{7}/)?.[0]
    if (!chave || !order) { semVenda++; continue }
    const uf = xml.match(/<dest>[\s\S]*?<UF>([A-Z]{2})<\/UF>/)?.[1] ?? null

    // impostos: dos totais da nota (ICMSTot)
    const tb = xml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/)?.[1] ?? xml
    const icms = tagIn(tb, 'vICMS'), pis = tagIn(tb, 'vPIS'), cofins = tagIn(tb, 'vCOFINS'), ipi = tagIn(tb, 'vIPI')
    const difal = tagIn(tb, 'vICMSUFDest') + tagIn(tb, 'vICMSUFRemet')

    const { data: rows } = await db.from('sales')
      .select('id, gross_price, nfe_saida_key')
      .eq('marketplace', 'amazon')
      .ilike('external_order_id', `%${order}%`)
    if (!rows?.length) { semVenda++; continue }
    const todo = rows.filter(r => !r.nfe_saida_key)
    if (!todo.length) { jaTinham++; continue }

    const total = todo.reduce((s, r) => s + Number(r.gross_price ?? 0), 0) || 1
    for (const r of todo) {
      const share = total > 0 ? Number(r.gross_price ?? 0) / total : 1 / todo.length
      await db.from('sales').update({
        nfe_saida_key: chave,
        ...(uf && /^[A-Z]{2}$/.test(uf) ? { uf_destino: uf } : {}),
      }).eq('id', r.id)
      await db.from('sale_taxes').upsert({
        sale_id: r.id, nfe_key: chave,
        pis: Math.round(pis * share * 100) / 100, cofins: Math.round(cofins * share * 100) / 100,
        icms: Math.round(icms * share * 100) / 100, icms_difal: Math.round(difal * share * 100) / 100,
        ipi: Math.round(ipi * share * 100) / 100,
      }, { onConflict: 'sale_id' })
      vinculadas++
    }
  }

  return NextResponse.json({
    ok: true, xmls: xmls.length, notas_venda: vendas,
    vendas_vinculadas: vinculadas, pedidos_ja_com_nf: jaTinham,
    sem_venda_casada: semVenda, ignoradas_nao_venda: naoVenda,
  })
}
