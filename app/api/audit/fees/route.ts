/**
 * POST /api/audit/fees  body {days?, limit?, skip?}
 *
 * Vistoria de taxas do ML: confere venda a venda se comissão + tarifa fixa
 * batem com a tabela oficial da categoria (listing_prices) e se o frete está
 * dentro do padrão histórico do produto. Divergência vira audit_finding com
 * details {cobrado, esperado, diff}; auto-cura igual à auditoria de vendas.
 * Fatiada por anúncio: limit=anúncios por chamada, skip=pular já feitos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { mlGet } from '@/lib/integrations/mercado-livre'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const FEE_RULES = ['comissao_acima_tabela', 'comissao_abaixo_tabela', 'tarifa_fixa_divergente', 'frete_fora_padrao']
const TOL = 0.10
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface SaleRow {
  id: string; external_order_id: string; sku: string; sale_date: string
  gross_price: number; quantity: number; product_id: string | null
  fulfillment_type: string | null
  marketplace_commission: number; marketplace_fixed_fee: number
  marketplace_shipping_fee: number
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body  = await request.json().catch(() => ({}))
  const days  = Number(body.days ?? 30)
  const limit = Number(body.limit ?? 25)
  const skip  = Number(body.skip ?? 0)
  const db    = createSupabaseServiceClient()

  const { data: sales } = await db.from('sales')
    .select('id, external_order_id, sku, sale_date, gross_price, quantity, product_id, fulfillment_type, marketplace_commission, marketplace_fixed_fee, marketplace_shipping_fee')
    .eq('marketplace', 'mercado_livre')
    .gt('marketplace_commission', 0)
    .gte('sale_date', brazilDaysAgo(days))
    .limit(2000) as { data: SaleRow[] | null }

  // Agrupa por anúncio (mlb) — a tabela oficial é por anúncio
  const byItem = new Map<string, SaleRow[]>()
  for (const s of sales ?? []) {
    const mlb = s.external_order_id?.match(/^ml_\d+_(\S+)$/)?.[1]
    if (!mlb) continue
    if (!byItem.has(mlb)) byItem.set(mlb, [])
    byItem.get(mlb)!.push(s)
  }
  const items = [...byItem.keys()].sort()
  const batch = items.slice(skip, skip + limit)

  // Mediana de frete unitário por produto+logística (90d) para o padrão histórico
  const { data: freightRows } = await db.from('sales')
    .select('product_id, fulfillment_type, marketplace_shipping_fee, quantity')
    .eq('marketplace', 'mercado_livre')
    .gt('marketplace_shipping_fee', 0)
    .gte('sale_date', brazilDaysAgo(90))
    .not('product_id', 'is', null)
    .limit(5000)
  const freightMap = new Map<string, number[]>()
  for (const r of freightRows ?? []) {
    const k = `${r.product_id}|${r.fulfillment_type}`
    if (!freightMap.has(k)) freightMap.set(k, [])
    freightMap.get(k)!.push(Number(r.marketplace_shipping_fee) / Math.max(1, Number(r.quantity)))
  }
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b)
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  }

  interface Finding {
    sale_id: string; rule: string; severity: string; message: string
    details: { cobrado: number; esperado: number; diff: number }
  }
  const findings: Finding[] = []
  const processedSaleIds: string[] = []
  const r2 = (v: number) => Math.round(v * 100) / 100

  for (const mlb of batch) {
    const itemSales = byItem.get(mlb)!
    let cat = '', lt = ''
    try {
      const it = await mlGet<{ category_id?: string; listing_type_id?: string }>(
        `/items/${mlb}?attributes=category_id,listing_type_id`)
      cat = it.category_id ?? ''
      lt  = it.listing_type_id ?? ''
    } catch { continue }  // anúncio removido — conta no skip do chamador, não trava o loop
    const expectedByPrice = new Map<number, { gross: number; fixed: number }>()

    for (const s of itemSales) {
      processedSaleIds.push(s.id)
      const unitPrice = Number(s.gross_price) / Math.max(1, Number(s.quantity))
      const key = r2(unitPrice)
      if (!expectedByPrice.has(key) && cat && lt) {
        try {
          await sleep(150)
          const res = await mlGet<any>(
            `/sites/MLB/listing_prices?price=${key}&listing_type_id=${lt}&category_id=${cat}`)
          const lp = Array.isArray(res) ? (res.find((r: any) => r.listing_type_id === lt) ?? res[0]) : res
          const det = lp?.sale_fee_details ?? {}
          expectedByPrice.set(key, {
            gross: Number(det.gross_amount ?? lp?.sale_fee_amount ?? 0),
            fixed: Number(det.fixed_fee ?? 0),
          })
        } catch { expectedByPrice.set(key, { gross: 0, fixed: 0 }) }
      }
      const exp = expectedByPrice.get(key)
      const nfLabel = `${s.sku} (${s.sale_date})`

      // ── Comissão + tarifa fixa vs tabela oficial (só cobrança A MAIS) ──
      if (exp && exp.gross > 0) {
        const cobrado  = Number(s.marketplace_commission) + Number(s.marketplace_fixed_fee ?? 0)
        const esperado = exp.gross * Number(s.quantity)
        const diff     = r2(cobrado - esperado)
        if (diff > TOL) {
          const fixedCobrada  = Number(s.marketplace_fixed_fee ?? 0)
          const fixedEsperada = exp.fixed * Number(s.quantity)
          const fixedDiff     = r2(fixedCobrada - fixedEsperada)
          const isFixed = Math.abs(fixedDiff) > TOL && Math.abs(diff - fixedDiff) <= TOL
          findings.push({
            sale_id: s.id,
            rule: isFixed ? 'tarifa_fixa_divergente' : 'comissao_acima_tabela',
            severity: 'warn',
            message: `${nfLabel}: ML cobrou R$${cobrado.toFixed(2)} de tarifa de venda, tabela oficial diz R$${esperado.toFixed(2)} — R$${diff.toFixed(2)} a mais.`,
            details: { cobrado: r2(cobrado), esperado: r2(esperado), diff },
          })
        } else if (diff < -5) {
          // Sentinela da regra "comissão BRUTA + estorno separado": comissão bem
          // ABAIXO da tabela é a assinatura de alguém ter gravado o valor LÍQUIDO
          // (bruta − estorno) — mascara a conta. Auto-cura quando corrigido.
          findings.push({
            sale_id: s.id,
            rule: 'comissao_abaixo_tabela',
            severity: 'warn',
            message: `${nfLabel}: comissão gravada R$${cobrado.toFixed(2)} bem abaixo da tabela (R$${esperado.toFixed(2)}) — possível gravação do valor líquido em vez de bruto + estorno.`,
            details: { cobrado: r2(cobrado), esperado: r2(esperado), diff },
          })
        }
      }

      // ── Frete vs padrão histórico do produto na mesma logística ──
      const freteUnit = Number(s.marketplace_shipping_fee) / Math.max(1, Number(s.quantity))
      const hist = s.product_id ? freightMap.get(`${s.product_id}|${s.fulfillment_type}`) : undefined
      if (freteUnit > 0 && hist && hist.length >= 5) {
        const med = median(hist)
        if (med > 0 && freteUnit > 1.25 * med) {
          const diff = r2((freteUnit - med) * Number(s.quantity))
          findings.push({
            sale_id: s.id, rule: 'frete_fora_padrao', severity: 'info',
            message: `${nfLabel}: frete de R$${freteUnit.toFixed(2)}/un — padrão do produto é R$${med.toFixed(2)} (${hist.length} vendas). R$${diff.toFixed(2)} acima.`,
            details: { cobrado: r2(freteUnit * Number(s.quantity)), esperado: r2(med * Number(s.quantity)), diff },
          })
        }
      }
    }
  }

  // Dispensas do usuário sobrevivem à regravação (venda+regra dispensada não volta)
  const dismissed = new Set<string>()
  for (let i = 0; i < processedSaleIds.length; i += 200) {
    const { data: dis } = await db.from('audit_findings')
      .select('sale_id, rule')
      .in('sale_id', processedSaleIds.slice(i, i + 200))
      .in('rule', FEE_RULES)
      .not('dismissed_at', 'is', null)
    for (const d of dis ?? []) dismissed.add(`${d.sale_id}|${d.rule}`)
  }

  // Auto-cura: apaga achados DESTAS regras para as vendas processadas, regrava
  for (let i = 0; i < processedSaleIds.length; i += 200) {
    await db.from('audit_findings').delete()
      .in('sale_id', processedSaleIds.slice(i, i + 200))
      .in('rule', FEE_RULES)
  }
  const nowIso = new Date().toISOString()
  const rows = findings.map(f => ({
    ...f,
    ...(dismissed.has(`${f.sale_id}|${f.rule}`) ? { dismissed_at: nowIso } : {}),
  }))
  let inserted = 0
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('audit_findings').insert(rows.slice(i, i + 200))
    if (!error) inserted += Math.min(200, rows.length - i)
  }

  return NextResponse.json({
    ok: true,
    processed_items: batch.length,
    processed_sales: processedSaleIds.length,
    achados: inserted,
    remaining_items: Math.max(0, items.length - skip - batch.length),
  })
}
