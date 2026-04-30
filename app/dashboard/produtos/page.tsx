import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default async function ProdutosPage() {
  const db = createSupabaseServiceClient()

  const { data: products } = await db
    .from('products')
    .select('*')
    .order('name')

  // For each product, get latest CMP and latest unit_cost breakdown
  const productData = await Promise.all(
    (products ?? []).map(async product => {
      const { data: cmp } = await db
        .from('cmp_costs')
        .select('*')
        .eq('product_id', product.id)
        .order('calculated_at', { ascending: false })
        .limit(1)
        .single()

      const { data: latestBatch } = await db
        .from('unit_costs')
        .select('*')
        .eq('product_id', product.id)
        .order('calculated_at', { ascending: false })
        .limit(1)
        .single()

      return { product, cmp, latestBatch }
    })
  )

  return (
    <>
      <TopBar title="Custo por Produto" subtitle="Landed cost real — FOB + impostos + despesas de importação" />
      <div className="px-8 py-6 space-y-4">
        {productData.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            Nenhum produto cadastrado ainda. Sincronize com o Bling ou importe NF-e de importação.
          </div>
        )}
        {productData.map(({ product, cmp, latestBatch }) => (
          <div key={product.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-900">{product.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">SKU: {product.sku} · Estoque: {Number(product.stock_quantity).toFixed(0)} un.</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">CMP Atual</div>
                <div className={`text-xl font-bold ${cmp ? 'text-gray-900' : 'text-gray-300'}`}>
                  {cmp ? fmtR(Number(cmp.cmp_value)) : 'Sem dados'}
                </div>
              </div>
            </div>

            {latestBatch && (
              <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Composição do Custo — Último Lote</div>
                <div className="grid grid-cols-5 gap-3 text-xs">
                  {[
                    { label: 'FOB', value: latestBatch.fob_unit_cost },
                    { label: 'Impostos NF', value: latestBatch.taxes_unit_cost },
                    { label: 'Desp. Adicionais', value: latestBatch.additional_unit_cost },
                    { label: 'Total Lote', value: latestBatch.total_unit_cost, highlight: true },
                    { label: 'Crédito PIS+COFINS', value: Number(latestBatch.pis_credit_unit) + Number(latestBatch.cofins_credit_unit), credit: true },
                  ].map(({ label, value, highlight, credit }) => (
                    <div key={label} className={`rounded-lg p-2 border ${highlight ? 'bg-blue-50 border-blue-100' : credit ? 'bg-green-50 border-green-100' : 'bg-white border-gray-100'}`}>
                      <div className={`text-xs ${credit ? 'text-green-500' : 'text-gray-400'}`}>{label}</div>
                      <div className={`font-bold mt-0.5 ${highlight ? 'text-blue-700' : credit ? 'text-green-700' : 'text-gray-800'}`}>
                        {credit ? `(${fmtR(Number(value))})` : fmtR(Number(value))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!latestBatch && (
              <div className="px-6 py-3 text-xs text-gray-400">
                Nenhum lote de importação calculado para este produto ainda.
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
