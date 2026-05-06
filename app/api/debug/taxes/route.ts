import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseServiceClient()

  // Vendas com nfe_saida_key setada
  const { data: linkedSales, error: e1 } = await db
    .from('sales')
    .select('id, external_order_id, sale_date, nfe_saida_key')
    .not('nfe_saida_key', 'is', null)
    .order('sale_date', { ascending: false })
    .limit(20)

  // sale_taxes dessas vendas
  const saleIds = (linkedSales ?? []).map(s => s.id)
  const { data: taxes, error: e2 } = saleIds.length > 0
    ? await db.from('sale_taxes').select('*').in('sale_id', saleIds)
    : { data: [], error: null }

  // Tenta inserir um registro de teste para ver se total_taxes é gerada
  const testSaleId = linkedSales?.[0]?.id
  let upsertTest: string = 'não testado'
  if (testSaleId) {
    // Testa upsert SEM total_taxes
    const { error: errSem } = await db.from('sale_taxes').upsert({
      sale_id: testSaleId,
      nfe_key: linkedSales![0].nfe_saida_key,
      pis: 0.01, cofins: 0.01, icms: 0, icms_difal: 0, ipi: 0,
    }, { onConflict: 'sale_id' })

    // Testa upsert COM total_taxes
    const { error: errCom } = await db.from('sale_taxes').upsert({
      sale_id: testSaleId,
      nfe_key: linkedSales![0].nfe_saida_key,
      pis: 0.01, cofins: 0.01, icms: 0, icms_difal: 0, ipi: 0,
      total_taxes: 0.02,
    }, { onConflict: 'sale_id' })

    upsertTest = `sem total_taxes: ${errSem ? errSem.message : 'OK'} | com total_taxes: ${errCom ? errCom.message : 'OK'}`
  }

  return NextResponse.json({
    linked_sales_count: linkedSales?.length ?? 0,
    linked_sales: linkedSales ?? [],
    sale_taxes_records: taxes ?? [],
    sale_taxes_count: taxes?.length ?? 0,
    upsert_test: upsertTest,
    errors: { e1: e1?.message, e2: e2?.message },
  })
}
