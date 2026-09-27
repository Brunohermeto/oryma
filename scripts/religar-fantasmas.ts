// Religa itens de NF de entrada presos a PRODUTOS-FANTASMA (criados pelo parser
// antigo da rota do Bling, com SKU = EAN/código do fornecedor) ao produto real,
// usando o resolvedor oficial (lib/nfe/import-processor) + nome idêntico ao do
// cadastro. Recalcula o custo dos lotes afetados e apaga fantasmas sem uso.
// Rodar: npx tsx --env-file=.env.local scripts/religar-fantasmas.ts [--aplicar]
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { resolveVariantSkus } from '@/lib/nfe/import-processor'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'

const aplicar = process.argv.includes('--aplicar')
const db = createSupabaseServiceClient()
const norm = (t: string) => (t ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

async function todos<T>(tabela: string, cols: string): Promise<T[]> {
  const out: T[] = []
  for (let o = 0; ; o += 1000) {
    const { data, error } = await db.from(tabela).select(cols).order('id').range(o, o + 999)
    if (error) throw new Error(error.message)
    out.push(...(data as T[]))
    if (!data || data.length < 1000) return out
  }
}

type P = { id: string; sku: string; name: string; bling_id: string | null; archived: boolean | null }
type I = { id: string; sku: string; description: string; product_id: string | null; import_order_id: string }

async function main() {
const prods = await todos<P>('products', 'id, sku, name, bling_id, archived')
const reais = prods.filter(p => p.bling_id && !p.archived)
const fantasmas = new Set(prods.filter(p => !p.bling_id).map(p => p.id))
const porSku = new Map(reais.map(p => [p.sku.toUpperCase(), p]))
const porNome = new Map<string, P[]>()
for (const p of reais) porNome.set(norm(p.name), [...(porNome.get(norm(p.name)) ?? []), p])

const skuDe = new Map(prods.map(p => [p.id, p.sku.toUpperCase()]))
// TODOS os itens: presos a fantasma OU ligados a um produto diferente do que o
// resolvedor oficial manda (ex.: EAN 7908488105732 -> MOVEDUO pelo SKU_MAP)
const itens = await todos<I>('import_items', 'id, sku, description, product_id, import_order_id')

let religados = 0
const lotes = new Set<string>()
const naoResolvidos = new Map<string, number>()
for (const it of itens) {
  const ehFantasma = !!it.product_id && fantasmas.has(it.product_id)
  const skus = resolveVariantSkus(it.sku, it.description)
  let alvo = skus.length === 1 ? porSku.get(skus[0].toUpperCase()) : undefined
  if (!alvo && ehFantasma) {
    // nome idêntico ao do cadastro, com ou sem o código do fornecedor no início
    const semCodigo = norm(it.description).replace(/^\d+ /, '')
    const nome = porNome.get(norm(it.description)) ?? porNome.get(semCodigo)
    if (nome?.length === 1) alvo = nome[0]
  }
  if (alvo && alvo.id === it.product_id) continue          // já está certo
  if (!alvo && !ehFantasma) continue                        // não-fantasma sem regra: não mexe
  if (!alvo) { naoResolvidos.set(it.description.slice(0, 60), (naoResolvidos.get(it.description.slice(0, 60)) ?? 0) + 1); continue }
  religados++
  lotes.add(it.import_order_id)
  if (aplicar) await db.from('import_items').update({ product_id: alvo.id, sku: alvo.sku }).eq('id', it.id)
}
console.log(`itens analisados: ${itens.length} | religados: ${religados} | lotes afetados: ${lotes.size}`)
console.log('não resolvidos (top 15):', [...naoResolvidos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))

if (aplicar) {
  let n = 0
  for (const o of lotes) { await recalculateLandedCost(o); n++ }
  console.log(`custo recalculado em ${n} lotes`)
  // fantasmas que ficaram sem nenhum uso: apaga (custos antes)
  const usados = new Set((await todos<{ product_id: string }>('import_items', 'product_id')).map(i => i.product_id))
  const vendidos = new Set((await todos<{ product_id: string }>('sales', 'product_id')).map(s => s.product_id))
  let apagados = 0
  for (const id of fantasmas) {
    if (usados.has(id) || vendidos.has(id)) continue
    await db.from('unit_costs').delete().eq('product_id', id)
    await db.from('cmp_costs').delete().eq('product_id', id)
    const { error } = await db.from('products').delete().eq('id', id)
    if (!error) apagados++
  }
  console.log(`fantasmas sem uso apagados: ${apagados}`)
}
}

main().catch(e => { console.error(e); process.exit(1) })
