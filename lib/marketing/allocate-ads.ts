/**
 * Rateio do gasto de anúncios de UM canal num dia (regra do Bruno, 02/10/2026):
 *  1. gasto do anúncio do produto X no dia D → vendas de X no dia D (pelo bruto);
 *  2. gasto de produto que NÃO vendeu no dia → rateado entre TODAS as vendas do
 *     canal no dia (pelo bruto) — o total do dia fica 100% dentro da margem.
 * Grava sales.ads_cost (substitui o valor anterior das vendas do dia).
 * Sem nenhuma venda no canal no dia → o gasto não tem onde cair (fica de fora).
 */
import type { createSupabaseServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createSupabaseServiceClient>
type Sale = { id: string; external_order_id: string; gross_price: number | string | null }

/** Função pura (testável): devolve ads_cost por venda. */
export function rateiaAds(
  sales: Sale[],
  custoPorChave: Map<string, number>,
  chaveDaVenda: (s: Sale) => string | null,
): { porVenda: Map<string, number>; semVenda: number } {
  const porVenda = new Map<string, number>(sales.map(s => [s.id, 0]))
  const g = (s: Sale) => Number(s.gross_price ?? 0)
  const reparte = (alvo: Sale[], valor: number) => {
    const soma = alvo.reduce((a, s) => a + g(s), 0)
    for (const s of alvo) porVenda.set(s.id, porVenda.get(s.id)! + valor * (soma > 0 ? g(s) / soma : 1 / alvo.length))
  }
  let sobra = 0
  for (const [chave, custo] of custoPorChave) {
    if (!(custo > 0)) continue
    const alvo = sales.filter(s => chaveDaVenda(s) === chave)
    if (alvo.length) reparte(alvo, custo); else sobra += custo
  }
  if (sobra > 0 && sales.length) reparte(sales, sobra)
  return { porVenda, semVenda: sales.length ? 0 : sobra }
}

/**
 * Versão por GRUPO (relatório de um PERÍODO, Shopee/Amazon): cada linha do
 * relatório (anúncio/campanha) tem um custo e um conjunto de produtos; o custo
 * vai p/ as vendas desses produtos no período (pelo bruto). Linha sem produto
 * ou sem venda → sobra rateada em todas as vendas do canal no período.
 */
export function rateiaAdsGrupos(
  sales: Array<Sale & { product_id: string | null }>,
  grupos: Array<{ custo: number; produtos: Set<string> }>,
): { porVenda: Map<string, number>; semVenda: number } {
  const porVenda = new Map<string, number>(sales.map(s => [s.id, 0]))
  const g = (s: Sale) => Number(s.gross_price ?? 0)
  const reparte = (alvo: Sale[], valor: number) => {
    const soma = alvo.reduce((a, s) => a + g(s), 0)
    for (const s of alvo) porVenda.set(s.id, porVenda.get(s.id)! + valor * (soma > 0 ? g(s) / soma : 1 / alvo.length))
  }
  let sobra = 0
  for (const { custo, produtos } of grupos) {
    if (!(custo > 0)) continue
    const alvo = produtos.size ? sales.filter(s => s.product_id && produtos.has(s.product_id)) : []
    if (alvo.length) reparte(alvo, custo); else sobra += custo
  }
  if (sobra > 0 && sales.length) reparte(sales, sobra)
  return { porVenda, semVenda: sales.length ? 0 : sobra }
}

export async function gravaAdsDoPeriodo(
  db: Db, marketplace: string, de: string, ate: string,
  grupos: Array<{ custo: number; produtos: Set<string> }>,
) {
  const sales: Array<Sale & { product_id: string | null }> = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from('sales').select('id, external_order_id, gross_price, product_id')
      .eq('marketplace', marketplace).gte('sale_date', de).lte('sale_date', ate).order('id').range(off, off + 999)
    if (error) throw new Error(error.message)
    sales.push(...((data ?? []) as typeof sales))
    if ((data ?? []).length < 1000) break
  }
  const { porVenda, semVenda } = rateiaAdsGrupos(sales, grupos)
  const ups = [...porVenda]
  for (let i = 0; i < ups.length; i += 20) {
    await Promise.all(ups.slice(i, i + 20).map(([id, v]) =>
      db.from('sales').update({ ads_cost: Math.round(v * 100) / 100 }).eq('id', id)))
  }
  return { vendas: sales.length, semVenda }
}

export async function gravaAdsDoDia(
  db: Db, marketplace: string, dia: string,
  custoPorChave: Map<string, number>, chaveDaVenda: (s: Sale) => string | null,
) {
  const { data } = await db.from('sales').select('id, external_order_id, gross_price')
    .eq('marketplace', marketplace).eq('sale_date', dia)
  const sales = (data ?? []) as Sale[]
  const { porVenda, semVenda } = rateiaAds(sales, custoPorChave, chaveDaVenda)
  const ups = [...porVenda]
  for (let i = 0; i < ups.length; i += 20) {
    await Promise.all(ups.slice(i, i + 20).map(([id, v]) =>
      db.from('sales').update({ ads_cost: Math.round(v * 100) / 100 }).eq('id', id)))
  }
  return { vendas: sales.length, semVenda }
}
