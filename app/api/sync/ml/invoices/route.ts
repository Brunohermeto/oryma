/**
 * POST /api/sync/ml/invoices
 *
 * Impostos das vendas cuja NF-e foi emitida VIA Mercado Livre (Full e afins):
 * essas notas não passam pelo Bling — vêm de /users/{uid}/invoices/orders/{oid},
 * com valores reais de PIS/COFINS/ICMS/DIFAL por item.
 *
 * Processa N pedidos por chamada (padrão das rotas de enriquecimento);
 * o chamador repete com `skip` até remaining = 0.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mlGet, getMercadoLivreSellerId } from '@/lib/integrations/mercado-livre'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface MLInvoiceItem {
  external_product_id?: string
  fiscal_data?: { rules?: Array<{ name?: string; attributes?: Record<string, unknown> | null }> }
}

interface MLInvoice {
  status?: string
  attributes?: { invoice_key?: string | null }
  items?: MLInvoiceItem[]
}

function taxesFromRules(rules: Array<{ name?: string; attributes?: Record<string, unknown> | null }>) {
  const num = (a: Record<string, unknown> | null | undefined, k: string) => Number((a as any)?.[k] ?? 0)
  let pis = 0, cofins = 0, icms = 0, difal = 0, ipi = 0
  for (const r of rules) {
    const a = r.attributes
    switch (r.name) {
      case 'PIS':    pis    += num(a, 'vpis');    break
      case 'COFINS': cofins += num(a, 'vcofins'); break
      case 'ICMS':
        icms  += num(a, 'vicms')
        // DIFAL + FCP destino — carga do estado de destino
        difal += num(a, 'vicmsufdest') + num(a, 'vicmsufremet') + num(a, 'vfcpufdest')
        break
      case 'IPI':    ipi    += num(a, 'vipi');    break
    }
  }
  return { pis, cofins, icms, difal, ipi }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body  = await request.json().catch(() => ({}))
  const days  = Number(body.days ?? 45)
  const limit = Number(body.limit ?? 15)
  const skip  = new Set<string>(Array.isArray(body.skip) ? body.skip : [])

  const db  = createSupabaseServiceClient()
  const uid = await getMercadoLivreSellerId()
  if (!uid) return NextResponse.json({ error: 'Seller ID ML não encontrado' }, { status: 500 })

  // Vendas ML sem NF-e vinculada, agrupadas por pedido
  const { data: rows } = await db.from('sales')
    .select('id, external_order_id')
    .eq('marketplace', 'mercado_livre')
    .is('nfe_saida_key', null)
    .gte('sale_date', brazilDaysAgo(days))
    .order('sale_date', { ascending: false })
    .limit(500)

  const orders = new Map<string, Array<{ saleId: string; mlb: string }>>()
  for (const r of rows ?? []) {
    const m = r.external_order_id?.match(/^ml_(\d+)_(\S+)$/)
    if (!m || skip.has(m[1])) continue
    if (!orders.has(m[1])) orders.set(m[1], [])
    orders.get(m[1])!.push({ saleId: r.id, mlb: m[2] })
  }

  const batch = [...orders.entries()].slice(0, limit)
  let linked = 0, notFound = 0
  const errors: string[] = []

  for (const [orderId, items] of batch) {
    try {
      await sleep(200)
      let inv: MLInvoice | null = null
      try {
        inv = await mlGet<MLInvoice>(`/users/${uid}/invoices/orders/${orderId}`)
      } catch { notFound++; continue }  // 404 = pedido sem nota via ML (galpão/Bling)

      const chave = inv?.attributes?.invoice_key
      if (inv?.status !== 'authorized' || !chave) { notFound++; continue }

      for (const sale of items) {
        // casa item da nota com a venda pelo MLB id; fallback: primeiro item
        const invItem = (inv.items ?? []).find(i => i.external_product_id === sale.mlb) ?? inv.items?.[0]
        const rules   = invItem?.fiscal_data?.rules ?? []
        const t       = taxesFromRules(rules)

        const [{ error: e1 }] = await Promise.all([
          db.from('sales').update({ nfe_saida_key: chave }).eq('id', sale.saleId),
          db.from('sale_taxes').delete().eq('sale_id', sale.saleId).then(() =>
            db.from('sale_taxes').insert({
              sale_id: sale.saleId, nfe_key: chave,
              pis: t.pis, cofins: t.cofins, icms: t.icms, icms_difal: t.difal, ipi: t.ipi,
            })
          ),
        ])
        if (e1) throw new Error(e1.message)
        linked++
      }
    } catch (err) {
      errors.push(`${orderId}: ${String(err).slice(0, 120)}`)
    }
  }

  return NextResponse.json({
    ok: true,
    processed_orders: batch.length,
    processed_ids: batch.map(([id]) => id),
    sales_linked: linked,
    invoices_not_found: notFound,
    remaining_orders: orders.size - batch.length,
    errors,
  })
}
