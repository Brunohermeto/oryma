/**
 * POST /api/sync/bling/products
 *
 * Importa produtos do Bling ERP para a tabela products do Oryma.
 * Usa GET /produtos com paginação (até 500 produtos).
 *
 * Mapeamento:
 *   bling.id     → products.bling_id
 *   bling.codigo → products.sku
 *   bling.nome   → products.name
 *   bling estoque.saldoVirtualTotal → products.stock_quantity
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGet } from '@/lib/integrations/bling'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface BlingProduto {
  id: number
  nome: string
  codigo?: string | null          // SKU — pode vir null em variações
  situacao?: string               // 'A' = ativo, 'I' = inativo
  tipo?: string                   // 'P' = produto, 'S' = serviço, etc.
  estoque?: {
    saldoVirtualTotal?: number
    saldoFisicoTotal?: number
  }
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  try {
    const allProdutos: BlingProduto[] = []

    // Pagina até 500 produtos (5 páginas × 100)
    for (let page = 1; page <= 5; page++) {
      await sleep(200)
      const res = await blingGet<{ data: BlingProduto[] }>('/produtos', {
        pagina: String(page),
        limite: '100',
        situacao: 'A',   // só ativos
      }, 1)
      const items = res.data ?? []
      allProdutos.push(...items)
      if (items.length < 100) break
    }

    // Filtra: só produtos com SKU (codigo) definido
    const validos = allProdutos.filter(p => p.codigo && p.codigo.trim() !== '')

    if (validos.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: 'Nenhum produto com código encontrado no Bling' })
    }

    // Upsert em lotes de 20
    let synced = 0
    for (let i = 0; i < validos.length; i += 20) {
      const batch = validos.slice(i, i + 20)
      const rows = batch.map(p => ({
        bling_id:       String(p.id),
        sku:            p.codigo!.trim().toUpperCase(),
        name:           p.nome,
        stock_quantity: p.estoque?.saldoVirtualTotal ?? p.estoque?.saldoFisicoTotal ?? 0,
        updated_at:     new Date().toISOString(),
      }))

      const { error } = await db
        .from('products')
        .upsert(rows, { onConflict: 'sku' })

      if (!error) synced += batch.length
    }

    return NextResponse.json({
      ok: true,
      synced,
      total_bling: allProdutos.length,
      message: `${synced} produtos sincronizados do Bling`,
    })

  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
