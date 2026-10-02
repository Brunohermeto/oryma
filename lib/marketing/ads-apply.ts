/**
 * Aplica um período de Ads (Shopee/Amazon, vindo de upload) nas vendas:
 * lê ads_metrics do período, rateia por produto (gravaAdsDoPeriodo) e
 * recalcula a margem só daquele período (runRelink from/until).
 */
import type { createSupabaseServiceClient } from '@/lib/supabase/server'
import { gravaAdsDoPeriodo } from './allocate-ads'
import { indiceSkus } from './ads-products'
import { runRelink } from '@/lib/landed-cost/relink'

type Db = ReturnType<typeof createSupabaseServiceClient>

export async function aplicaPeriodoAds(db: Db, marketplace: string, de: string, ate: string) {
  const { data, error } = await db.from('ads_metrics').select('cost, product_skus')
    .eq('marketplace', marketplace).eq('date_from', de).eq('date_to', ate)
  if (error) throw new Error(error.message)
  const { idPorSku } = await indiceSkus(db)
  const grupos = (data ?? []).map(r => ({
    custo: Number(r.cost ?? 0),
    produtos: new Set((r.product_skus as string[] ?? []).map(s => idPorSku.get(s)).filter(Boolean) as string[]),
  }))
  const r = await gravaAdsDoPeriodo(db, marketplace, de, ate, grupos)
  await runRelink({ from: de, until: ate, skipOrders: true })
  return { ...r, gasto: grupos.reduce((a, g) => a + g.custo, 0) }
}
