/**
 * POST /api/debug/fix-product-links
 * Corrige sales que usam SKU do ML mas o produto correto (com CMP) está cadastrado
 * com o EAN/código diferente no Bling.
 *
 * Body (opcional):
 *   { mapping: { "SKU_ML": "SKU_BLING" } }
 *   Se não enviado, usa o mapeamento padrão conhecido.
 *
 * Fluxo:
 *   1. Usa mapeamento do body (se enviado) ou o padrão
 *   2. Para cada par, atualiza sales.product_id para o produto com CMP
 *   3. Dispara relink automático ao final
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

// Mapeamento padrão (atualizar conforme novos casos forem descobertos)
const DEFAULT_MAPPING: Record<string, string> = {
  'MOVEDUO': '7908488105732',
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()
  const body = await request.json().catch(() => ({}))

  // Aceita mapeamento do body ou usa o padrão
  const SKU_MAPPING: Record<string, string> = (body.mapping && typeof body.mapping === 'object')
    ? { ...DEFAULT_MAPPING, ...body.mapping }
    : DEFAULT_MAPPING

  const log: string[] = []
  let totalFixed = 0

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Carrega todos os produtos e seus CMPs
  // ──────────────────────────────────────────────────────────────────────────
  const { data: products, error: prodErr } = await db
    .from('products')
    .select('id, sku, name')

  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })

  const { data: cmps, error: cmpErr } = await db
    .from('cmp_costs')
    .select('product_id')

  if (cmpErr) return NextResponse.json({ error: cmpErr.message }, { status: 500 })

  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))
  const prodMap = Object.fromEntries((products ?? []).map((p: { id: string; sku: string; name: string }) => [p.sku, p]))

  log.push(`${products?.length ?? 0} produtos, ${prodWithCmp.size} com CMP`)
  log.push(`Mapeamentos a processar: ${Object.keys(SKU_MAPPING).length}`)

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Processa cada mapeamento
  // ──────────────────────────────────────────────────────────────────────────
  for (const [mlSku, blingSku] of Object.entries(SKU_MAPPING)) {
    const mlProduct    = prodMap[mlSku]
    const blingProduct = prodMap[blingSku]

    if (!mlProduct) {
      log.push(`SKIP ${mlSku}: produto não encontrado no banco`)
      continue
    }
    if (!blingProduct) {
      log.push(`SKIP ${mlSku}: produto Bling "${blingSku}" não encontrado`)
      continue
    }
    if (mlProduct.id === blingProduct.id) {
      log.push(`OK ${mlSku}: já aponta para o mesmo produto (sem mudança)`)
      continue
    }
    if (!prodWithCmp.has(blingProduct.id)) {
      log.push(`SKIP ${mlSku}: produto Bling "${blingSku}" também não tem CMP — verifique NF-e de entrada`)
      continue
    }

    const { count: salesCount } = await db
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', mlProduct.id)

    if (!salesCount || salesCount === 0) {
      log.push(`SKIP ${mlSku}: nenhuma venda com esse product_id`)
      continue
    }

    log.push(`${mlSku} → ${blingSku}: ${salesCount} vendas`)

    const { error: updErr } = await db
      .from('sales')
      .update({ product_id: blingProduct.id })
      .eq('product_id', mlProduct.id)

    if (updErr) {
      log.push(`ERRO ${mlSku}: ${updErr.message}`)
    } else {
      log.push(`✓ ${salesCount} vendas migradas — "${mlProduct.name}" → "${blingProduct.name}"`)
      totalFixed += salesCount
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Relink automático se corrigiu algo
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
    mapping_used: SKU_MAPPING,
    log,
    relink: relinkResult,
  })
}
