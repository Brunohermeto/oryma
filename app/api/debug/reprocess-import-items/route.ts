/**
 * POST /api/debug/reprocess-import-items
 *
 * Re-processa import_items com product_id=null ou cujo produto não tem CMP.
 * Usa o catálogo do Bling para resolver o SKU correto e recalcula o landed cost.
 *
 * Execução segura: não apaga nada — apenas atualiza product_id onde está null/errado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { buildBlingProductIndex, resolveSkuFromBling } from '@/lib/bling/product-index'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'

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
  let fixed = 0
  let skipped = 0

  // 1. Produtos existentes (índice sku→id)
  const { data: products } = await db.from('products').select('id, sku, name')
  const productMap: Record<string, string> = {}
  for (const p of (products ?? []) as { id: string; sku: string; name: string }[]) {
    productMap[p.sku.toUpperCase()] = p.id
  }

  // Produtos com CMP
  const { data: cmps } = await db.from('cmp_costs').select('product_id')
  const prodWithCmp = new Set((cmps ?? []).map((c: { product_id: string }) => c.product_id))

  // 2. Catálogo Bling
  log.push('Carregando catálogo Bling…')
  let blingIndex = null
  try {
    blingIndex = await buildBlingProductIndex()
    log.push(`Catálogo: ${blingIndex.total} produtos, ${Object.keys(blingIndex.byFabricante).length} com codigoFabricante`)
  } catch (e) {
    log.push(`ERRO ao carregar catálogo Bling: ${String(e)}`)
    return NextResponse.json({ error: 'Falha ao carregar catálogo Bling', log }, { status: 500 })
  }

  // 3. import_items com product_id=null
  const { data: nullItems } = await db
    .from('import_items')
    .select('id, import_order_id, sku, description, product_id')
    .is('product_id', null)

  log.push(`${nullItems?.length ?? 0} itens com product_id=null`)

  // 4. import_orders SEM items (importados pelo sync antigo — só cabeçalho, sem itens)
  const { count: ordersWithoutItems } = await db
    .from('import_orders')
    .select('id', { count: 'exact', head: true })
    .not('id', 'in',
      (await db.from('import_items').select('import_order_id')).data
        ?.map((r: { import_order_id: string }) => r.import_order_id)
        .filter(Boolean) ?? []
    )

  if ((ordersWithoutItems ?? 0) > 0) {
    log.push(`⚠ ${ordersWithoutItems} NF-e sem itens (importadas pelo sync antigo — clique em "Bling → NF-e e Produtos" para reimportar)`)
  }

  // 5. import_items cujo produto não tem CMP
  const { data: allItems } = await db
    .from('import_items')
    .select('id, import_order_id, sku, description, product_id')
    .not('product_id', 'is', null)

  const noCmpItems = (allItems ?? []).filter((item: { product_id: string | null }) =>
    item.product_id && !prodWithCmp.has(item.product_id)
  )

  log.push(`${noCmpItems.length} itens com produto sem CMP`)

  const toProcess = [
    ...(nullItems ?? []),
    ...noCmpItems,
  ]

  // Evita duplicatas
  const seen = new Set<string>()
  const unique = toProcess.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  log.push(`Total a reprocessar: ${unique.length}`)

  // 5. Tenta resolver o SKU e atualizar product_id
  const ordersToRecalculate = new Set<string>()

  for (const item of unique as { id: string; import_order_id: string; sku: string; description: string; product_id: string | null }[]) {
    const rawSku = item.sku ?? ''

    // Tenta resolver via Bling catalog
    const resolvedSku = resolveSkuFromBling(rawSku, blingIndex!) ?? rawSku
    const skuUp = resolvedSku.toUpperCase()

    let productId = productMap[skuUp] ?? null

    // Cria produto se não existir
    if (!productId && resolvedSku !== rawSku) {
      const blingName = blingIndex!.byCodigo[resolvedSku]?.nome ?? item.description
      const { data: newProd } = await db
        .from('products')
        .insert({ sku: resolvedSku, name: blingName })
        .select('id').maybeSingle()
      productId = newProd?.id ?? null
      if (productId) productMap[skuUp] = productId
    }

    // Tenta também pela SKU original (pode já existir com o nome errado)
    if (!productId) {
      const rawUp = rawSku.toUpperCase()
      productId = productMap[rawUp] ?? null
    }

    if (!productId) {
      log.push(`SKIP ${rawSku}: não encontrado no catálogo nem na base`)
      skipped++
      continue
    }

    // product_id já está correto mas pode não ter CMP → marca para recalcular mesmo assim
    if (productId === item.product_id) {
      if (!prodWithCmp.has(productId)) {
        // CMP ausente: agenda recálculo sem mudar o product_id
        ordersToRecalculate.add(item.import_order_id)
        log.push(`~ ${rawSku}: product_id correto mas sem CMP → recalcular NF-e`)
        fixed++
      } else {
        skipped++
      }
      continue
    }

    // Atualiza o product_id do item
    const { error: updErr } = await db
      .from('import_items')
      .update({ product_id: productId, sku: resolvedSku })
      .eq('id', item.id)

    if (updErr) {
      log.push(`ERRO ${rawSku}: ${updErr.message}`)
    } else {
      log.push(`✓ ${rawSku} → ${resolvedSku} (${productId.slice(0, 8)})`)
      ordersToRecalculate.add(item.import_order_id)
      fixed++
    }
  }

  // 6. Recalcula landed cost para cada import_order afetado
  if (ordersToRecalculate.size > 0) {
    log.push(`Recalculando landed cost para ${ordersToRecalculate.size} NF-e…`)
    for (const orderId of ordersToRecalculate) {
      try {
        await recalculateLandedCost(orderId)
      } catch (e) {
        log.push(`ERRO recalc ${orderId.slice(0, 8)}: ${String(e)}`)
      }
    }
    log.push('Recálculo concluído')
  }

  return NextResponse.json({
    ok: true,
    fixed,
    skipped,
    orders_recalculated: ordersToRecalculate.size,
    message: fixed > 0
      ? `${fixed} itens corrigidos, ${ordersToRecalculate.size} NF-e recalculadas`
      : 'Nenhum item precisou de correção',
    log,
  })
}
