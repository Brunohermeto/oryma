import type { createSupabaseServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createSupabaseServiceClient>

// Campos que OUTRAS rotas preenchem DEPOIS da venda existir (tariffs, shipping,
// fees, returns, invoices, bling/process, relink, EAN). Um re-sync do mesmo dia
// (ciclo diário D-0..D-2, Amazon D-2..D-15, backfill) NUNCA pode zerá-los:
// aqui eles só preenchem lacuna (valor atual nulo/0/galpao), nunca sobrescrevem.
// Auditoria 22/09/2026: cada re-sync apagava comissão, devolução, frete, ads,
// estorno, Full da Shopee e vínculo de produto já corretos.
const FILL_ONLY: readonly string[] = [
  'marketplace_commission', 'marketplace_fixed_fee', 'marketplace_shipping_fee',
  'ads_cost', 'cancellation', 'rebate', 'discounts', 'fulfillment_type',
  'nfe_saida_key', 'product_id', 'uf_destino', 'payout_actual',
]

const vazio = (v: unknown) => v === null || v === undefined || v === 0 || v === 'galpao'

/** Insere a venda; se já existe, atualiza só os campos-base e preenche lacunas. */
export async function upsertSale(db: Db, row: Record<string, unknown>): Promise<{ id: string | null; error: { message: string } | null }> {
  const eid = String(row.external_order_id)
  const { data: cur } = await db.from('sales').select(['id', ...FILL_ONLY].join(', '))
    .eq('external_order_id', eid).maybeSingle()

  if (!cur) {
    const { data, error } = await db.from('sales').upsert(row, { onConflict: 'external_order_id' }).select('id').single()
    return { id: data?.id ?? null, error }
  }

  const atual = cur as unknown as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!FILL_ONLY.includes(k)) { patch[k] = v; continue }
    if (vazio(atual[k]) && !vazio(v)) patch[k] = v
  }
  const { error } = await db.from('sales').update(patch).eq('external_order_id', eid)
  return { id: String(atual.id), error }
}
