/**
 * POST /api/sync/shopee/full-taxes?days=20
 *
 * Impostos das NF-e do Shopee Full (FBS) — 100% automático, via a API oficial
 * de faturamento do Full (não passa pelo Bling; antes exigia exportar o pacote
 * de XML na mão). Fluxo FBS (exclusivo Brasil):
 *   generate_fbs_invoices → download_fbs_invoices → ZIP de XMLs → aplica impostos.
 * document_type 4 = NF de VENDA · file_type 1 = XML · document_status 1 = autorizadas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { unzipSync, strFromU8 } from 'fflate'
import { shopeePost } from '@/lib/integrations/shopee'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const num = (xml: string, t: string) => parseFloat(xml.match(new RegExp(`<${t}>([^<]+)</${t}>`))?.[1] ?? '0')
const ymd = (d: Date) => Number(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`)

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Number(request.nextUrl.searchParams.get('days') ?? 20)
  const db = createSupabaseServiceClient()
  const now = new Date()
  const start = new Date(now.getTime() - days * 864e5)

  // 1. gera o lote (assíncrono)
  const gen = await shopeePost<{ result_list?: Array<{ request_id: number }>; error?: string; message?: string }>(
    '/order/generate_fbs_invoices',
    { batch_download: { start: ymd(start), end: ymd(now), document_type: 4, file_type: 1, document_status: 1 } }
  )
  const reqId = gen.result_list?.[0]?.request_id
  if (!reqId) return NextResponse.json({ ok: false, step: 'generate', resp: gen }, { status: 502 })

  // 2. espera ficar disponível (costuma ser imediato)
  let link: string | null = null
  for (let i = 0; i < 10; i++) {
    await sleep(3000)
    const dl = await shopeePost<{ response?: Array<{ file_link?: string }> }>(
      '/order/download_fbs_invoices', { request_id_list: { request_id: [reqId] } }
    )
    link = dl.response?.[0]?.file_link ?? null
    if (link) break
  }
  if (!link) return NextResponse.json({ ok: false, step: 'download', request_id: reqId }, { status: 504 })

  // 3. baixa o ZIP e descompacta
  const zipBuf = new Uint8Array(await (await fetch(link)).arrayBuffer())
  const files = unzipSync(zipBuf)

  // vendas Shopee para casar (por chave ou por pedido)
  const sales: Array<{ id: string; external_order_id: string; nfe_saida_key: string | null; gross_price: number; sale_taxes: unknown }> = []
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('sales')
      .select('id, external_order_id, nfe_saida_key, gross_price, sale_taxes(sale_id)')
      .eq('marketplace', 'shopee').range(off, off + 999)
    if (!data?.length) break
    sales.push(...(data as any))
    if (data.length < 1000) break
  }
  const one = (x: unknown) => Array.isArray(x) ? x[0] : x
  const byChave = new Map<string, typeof sales>()
  const byOrder = new Map<string, typeof sales>()
  for (const s of sales) {
    if (s.nfe_saida_key) { if (!byChave.has(s.nfe_saida_key)) byChave.set(s.nfe_saida_key, []); byChave.get(s.nfe_saida_key)!.push(s) }
    const sn = s.external_order_id.replace(/^shopee_/, '').split('_')[0]
    if (!byOrder.has(sn)) byOrder.set(sn, []); byOrder.get(sn)!.push(s)
  }

  let aplicadas = 0, jaTinha = 0, semVenda = 0, naoVenda = 0
  for (const [name, u8] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith('.xml')) continue
    const xml = strFromU8(u8)
    const natOp = xml.match(/<natOp>([^<]+)<\/natOp>/)?.[1] ?? ''
    if (!/venda/i.test(natOp)) { naoVenda++; continue }
    const chave = name.match(/(\d{44})/)?.[1] ?? xml.match(/Id="NFe(\d{44})"/)?.[1]
    const sn = name.match(/NFe_([A-Z0-9]+)_/i)?.[1]
    const group = (chave && byChave.get(chave)) || (sn && byOrder.get(sn)) || []
    if (!group.length) { semVenda++; continue }
    if (group.every(s => one(s.sale_taxes))) { jaTinha++; continue }
    const pis = num(xml, 'vPIS'), cofins = num(xml, 'vCOFINS'), icms = num(xml, 'vICMS')
    const difal = num(xml, 'vICMSUFDest') + num(xml, 'vICMSUFRemet'), ipi = num(xml, 'vIPI')
    // UF do destinatário (pega carona no mesmo XML)
    const uf = xml.match(/<dest>[\s\S]*?<UF>([A-Z]{2})<\/UF>/)?.[1] ?? null
    const total = group.reduce((a, s) => a + Number(s.gross_price), 0)
    for (const s of group) {
      const share = total > 0 ? Number(s.gross_price) / total : 1 / group.length
      await db.from('sale_taxes').upsert({
        sale_id: s.id, nfe_key: chave, pis: pis * share, cofins: cofins * share,
        icms: icms * share, icms_difal: difal * share, ipi: ipi * share,
      }, { onConflict: 'sale_id' })
      const patch: Record<string, unknown> = {}
      if (!s.nfe_saida_key && chave) { patch.nfe_saida_key = chave; patch.fulfillment_type = 'full_shopee' }
      if (uf) patch.uf_destino = uf
      if (Object.keys(patch).length) await db.from('sales').update(patch).eq('id', s.id)
    }
    aplicadas++
  }

  return NextResponse.json({ ok: true, periodo: `${ymd(start)}-${ymd(now)}`, xmls: Object.keys(files).length, aplicadas, jaTinha, semVenda, naoVenda })
}
