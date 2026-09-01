/**
 * POST /api/sync/nfe-taxes — impostos por CHAVE, sem listagem.
 *
 * Vendas que JÁ conhecem sua NF (nfe_saida_key preenchida — ex: Magalu galpão,
 * cuja chave vem da API do marketplace) ganham sale_taxes direto do XML via
 * GET /nfe/documento/{chave} do Bling. Rápido e fatiado (?limit=), ao contrário
 * da rota síncrona /api/sync/bling que estoura o timeout.
 * NFs que não existem no Bling (fulfillment Magalu série 6, Amazon série 420)
 * são puladas — têm outras fontes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGetDocumentoXml } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const tag = (xml: string, t: string) => parseFloat(xml.match(new RegExp(`<${t}>([^<]+)</${t}>`))?.[1] ?? '0')

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days  = Number(request.nextUrl.searchParams.get('days') ?? 7)
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 20)
  const db = createSupabaseServiceClient()
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

  // vendas com chave, do Bling (não-Amazon), no período
  const { data: sales } = await db.from('sales')
    .select('id, nfe_saida_key, gross_price, marketplace, fulfillment_type, uf_destino')
    .not('nfe_saida_key', 'is', null)
    .neq('marketplace', 'amazon')
    .gte('sale_date', since)

  // pula quem já tem impostos
  const ids = (sales ?? []).map(s => s.id)
  const taxed = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('sale_taxes').select('sale_id').in('sale_id', ids.slice(i, i + 200))
    for (const t of data ?? []) taxed.add(t.sale_id as string)
  }
  const byChave = new Map<string, Array<{ id: string; gross_price: number }>>()
  for (const s of sales ?? []) {
    // pula só quem já tem imposto E já tem UF — a venda com imposto mas sem UF
    // (extração de UF falhou numa rodada antiga) precisa reentrar pra pegar o UF
    if (taxed.has(s.id) && s.uf_destino) continue
    if (s.marketplace === 'magalu' && s.fulfillment_type === 'full_magalu') continue // NF série 6 não está no Bling
    // Shopee emite pela própria plataforma desde ~10/07 (série 005) — XML não está no Bling
    if (s.marketplace === 'shopee' && s.nfe_saida_key.slice(22, 25) === '005') continue
    if (!byChave.has(s.nfe_saida_key)) byChave.set(s.nfe_saida_key, [])
    byChave.get(s.nfe_saida_key)!.push({ id: s.id, gross_price: Number(s.gross_price) })
  }

  let processed = 0
  let updated = 0
  for (const [chave, group] of byChave) {
    if (processed >= limit) break
    processed++
    await sleep(250)
    let xml: string | null = null
    try { xml = await blingGetDocumentoXml(chave) } catch { continue }
    if (!xml) continue
    // só NF de VENDA — retorno simbólico/remessa nunca é venda
    const natOp = xml.match(/<natOp>([^<]+)<\/natOp>/)?.[1] ?? ''
    if (!/venda/i.test(natOp)) continue

    const pis = tag(xml, 'vPIS'), cofins = tag(xml, 'vCOFINS'), icms = tag(xml, 'vICMS')
    const difal = tag(xml, 'vICMSUFDest') + tag(xml, 'vICMSUFRemet'), ipi = tag(xml, 'vIPI')
    const uf = xml.match(/<dest>[\s\S]*?<UF>([A-Z]{2})<\/UF>/)?.[1] ?? null
    const total = group.reduce((a, s) => a + s.gross_price, 0)
    for (const s of group) {
      const share = total > 0 ? s.gross_price / total : 1 / group.length
      await db.from('sale_taxes').upsert({
        sale_id: s.id, nfe_key: chave,
        pis: pis * share, cofins: cofins * share, icms: icms * share,
        icms_difal: difal * share, ipi: ipi * share,
      }, { onConflict: 'sale_id' })
      if (uf) await db.from('sales').update({ uf_destino: uf }).eq('id', s.id)
      updated++
    }
  }

  return NextResponse.json({ ok: true, processed, updated, remaining: byChave.size - processed })
}
