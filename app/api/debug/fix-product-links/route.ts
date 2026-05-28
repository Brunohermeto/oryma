/**
 * POST /api/debug/fix-product-links
 * Corrige sales que usam SKU do ML mas o produto correto (com CMP) está cadastrado
 * com o EAN/código diferente no Bling.
 *
 * Caso mais comum: MOVEDUO (ML) → 7908488105732 (EAN na NF-e de entrada).
 * Mesclamos as vendas para o produto que tem CMP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const log: string[] = []
  let totalFixed = 0

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Carrega todos os produtos e seus CMPs
  // ──────────────────────────────────────────────────────────────────────────
  const { data: products, error: prodErr } = await db
    .from('products')
    .select('id, sku, name')

  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })

  // Produtos que têm pelo menos 1 CMP
  const { data: cmps, error: cmpErr } = await db
    .from('cmp_costs')
    .select('product_id')

  if (cmpErr) return NextResponse.json({ error: cmpErr.message }, { status: 500 })

  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))
  const prodMap = Object.fromEntries((products ?? []).map((p: { id: string; sku: string; name: string }) => [p.sku, p]))

  log.push(`${products?.length ?? 0} produtos, ${prodWithCmp.size} com CMP`)

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Mapeamento manual de SKU ML → EAN/SKU Bling (base inicial, expansível)
  // ──────────────────────────────────────────────────────────────────────────
  const SKU_MAPPING: Record<string, string> = {
    'MOVEDUO': '7908488105732',
    // Adicione outros conforme necessário:
    // 'SKU_ML': 'SKU_BLING_COM_CMP',
  }

  for (const [mlSku, blingSku] of Object.entries(SKU_MAPPING)) {
    const mlProduct  = prodMap[mlSku]
    const blingProduct = prodMap[blingSku]

    if (!mlProduct) {
      log.push(`SKIP ${mlSku}: produto não encontrado`)
      continue
    }
    if (!blingProduct) {
      log.push(`SKIP ${mlSku}: produto Bling ${blingSku} não encontrado`)
      continue
    }
    if (mlProduct.id === blingProduct.id) {
      log.push(`SKIP ${mlSku}: já aponta para o mesmo produto`)
      continue
    }
    if (!prodWithCmp.has(blingProduct.id)) {
      log.push(`SKIP ${mlSku}: produto Bling ${blingSku} também não tem CMP`)
      continue
    }

    // Quantas vendas serão afetadas?
    const { count: salesCount } = await db
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', mlProduct.id)

    log.push(`${mlSku} → ${blingSku}: ${salesCount ?? 0} vendas para atualizar`)

    if (!salesCount || salesCount === 0) continue

    // Atualiza sales.product_id para o produto com CMP
    const { error: updErr } = await db
      .from('sales')
      .update({ product_id: blingProduct.id })
      .eq('product_id', mlProduct.id)

    if (updErr) {
      log.push(`ERRO ao atualizar ${mlSku}: ${updErr.message}`)
    } else {
      log.push(`✓ ${salesCount} vendas de ${mlSku} atualizadas → ${blingSku} (id: ${blingProduct.id.slice(0, 8)})`)
      totalFixed += salesCount
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Dispara relink automático se corrigiu algo
  // ──────────────────────────────────────────────────────────────────────────
  let relinkResult = null
  if (totalFixed > 0) {
    try {
      const relinkRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/landed-cost/relink`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `mi_auth=${process.env.APP_PASSWORD}`,
          },
        }
      )
      relinkResult = await relinkRes.json()
      log.push(`Relink: ${relinkResult?.message ?? 'concluído'}`)
    } catch (e) {
      log.push(`Relink ERRO: ${String(e)}`)
    }
  }

  return NextResponse.json({
    ok: true,
    fixed: totalFixed,
    message: totalFixed > 0
      ? `${totalFixed} vendas corrigidas e CMV recalculado`
      : 'Nenhuma venda precisou de correção',
    log,
    relink: relinkResult,
  })
}
