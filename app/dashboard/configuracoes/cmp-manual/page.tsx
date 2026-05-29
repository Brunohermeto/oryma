export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { CmpManualForm } from '@/components/configuracoes/CmpManualForm'

export default async function CmpManualPage() {
  const db = createSupabaseServiceClient()

  // Produtos com CMP
  const { data: cmps } = await db
    .from('cmp_costs')
    .select('product_id, cmp_value, effective_date')
    .order('effective_date', { ascending: false })

  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))
  const lastCmp: Record<string, { cmp_value: number; effective_date: string }> = {}
  for (const c of (cmps ?? []) as { product_id: string; cmp_value: number; effective_date: string }[]) {
    if (!lastCmp[c.product_id]) lastCmp[c.product_id] = c
  }

  // Vendas por produto
  const { data: salesRaw } = await db
    .from('sales')
    .select('product_id, sku')
    .not('product_id', 'is', null)

  const salesCount: Record<string, number> = {}
  for (const s of (salesRaw ?? []) as { product_id: string; sku: string }[]) {
    salesCount[s.product_id] = (salesCount[s.product_id] ?? 0) + 1
  }

  // Produtos
  const { data: products } = await db
    .from('products')
    .select('id, sku, name')
    .order('sku')

  // Produtos com vendas SEM CMP
  const withoutCmp = (products ?? [])
    .filter((p: { id: string }) => (salesCount[p.id] ?? 0) > 0 && !prodWithCmp.has(p.id))
    .map((p: { id: string; sku: string; name: string }) => ({
      id:          p.id,
      sku:         p.sku,
      name:        p.name,
      sales_count: salesCount[p.id] ?? 0,
    }))
    .sort((a, b) => b.sales_count - a.sales_count)

  // Produtos COM CMP (para referência)
  const withCmp = (products ?? [])
    .filter((p: { id: string }) => prodWithCmp.has(p.id))
    .map((p: { id: string; sku: string; name: string }) => ({
      id:             p.id,
      sku:            p.sku,
      name:           p.name,
      sales_count:    salesCount[p.id] ?? 0,
      cmp_value:      lastCmp[p.id]?.cmp_value ?? 0,
      effective_date: lastCmp[p.id]?.effective_date ?? '',
    }))
    .sort((a, b) => (b.sales_count - a.sales_count))

  return (
    <>
      <TopBar
        title="CMV Manual"
        subtitle="Informe o custo dos produtos que não têm NF-e de entrada importada"
      />
      <div className="px-4 md:px-8 py-6 max-w-4xl">
        <CmpManualForm withoutCmp={withoutCmp} withCmp={withCmp} />
      </div>
    </>
  )
}
