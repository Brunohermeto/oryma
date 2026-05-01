import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default async function ProdutosPage() {
  const db = createSupabaseServiceClient()

  const { data: products } = await db.from('products').select('*').order('name')

  const productData = await Promise.all(
    (products ?? []).map(async product => {
      const { data: cmp } = await db
        .from('cmp_costs').select('*')
        .eq('product_id', product.id)
        .order('calculated_at', { ascending: false })
        .limit(1).single()

      const { data: latestBatch } = await db
        .from('unit_costs').select('*')
        .eq('product_id', product.id)
        .order('calculated_at', { ascending: false })
        .limit(1).single()

      return { product, cmp, latestBatch }
    })
  )

  return (
    <>
      <TopBar title="Custo por Produto" subtitle="Landed cost real — FOB + impostos + despesas de importação" />
      <div className="px-8 py-6 space-y-4">

        {productData.length === 0 && (
          <div className="bg-white rounded-xl p-8 text-center text-sm" style={{ border: `1px solid ${B.border}`, color: B.muted }}>
            Nenhum produto cadastrado ainda. Sincronize com o Bling ou importe NF-e de importação.
          </div>
        )}

        {productData.map(({ product, cmp, latestBatch }) => (
          <div key={product.id} className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>

            {/* Header */}
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${B.border}` }}>
              <div>
                <div className="font-semibold" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
                  {product.name}
                </div>
                <div className="text-xs mt-0.5" style={{ color: B.muted }}>
                  SKU: {product.sku} · Estoque: {Number(product.stock_quantity).toFixed(0)} un.
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: B.muted }}>
                  CMP Atual
                </div>
                <div className="text-xl font-bold num" style={{
                  color: cmp ? B.brand : B.muted,
                  fontFamily: 'var(--font-geist-mono)',
                }}>
                  {cmp ? fmtR(Number(cmp.cmp_value)) : 'Sem dados'}
                </div>
              </div>
            </div>

            {/* Cost breakdown */}
            {latestBatch && (
              <div className="px-6 py-4" style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}>
                <div className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: B.muted }}>
                  Composição do Custo — Último Lote
                </div>
                <div className="grid grid-cols-5 gap-3 text-xs">
                  {[
                    { label: 'FOB',              value: latestBatch.fob_unit_cost,           kind: 'normal' },
                    { label: 'Impostos NF',       value: latestBatch.taxes_unit_cost,         kind: 'normal' },
                    { label: 'Desp. Adicionais',  value: latestBatch.additional_unit_cost,    kind: 'normal' },
                    { label: 'Total Lote',         value: latestBatch.total_unit_cost,         kind: 'highlight' },
                    { label: 'Crédito PIS+COFINS', value: Number(latestBatch.pis_credit_unit) + Number(latestBatch.cofins_credit_unit), kind: 'credit' },
                  ].map(({ label, value, kind }) => (
                    <div
                      key={label}
                      className="rounded-lg p-3"
                      style={{
                        background: kind === 'highlight' ? 'oklch(0.94 0.06 258)'
                          : kind === 'credit' ? 'oklch(0.96 0.08 145)'
                          : 'white',
                        border: `1px solid ${kind === 'highlight' ? 'oklch(0.86 0.10 258)'
                          : kind === 'credit' ? 'oklch(0.88 0.12 145)'
                          : B.border}`,
                      }}
                    >
                      <div style={{ color: kind === 'credit' ? '#16a34a' : B.muted }}>{label}</div>
                      <div className="font-bold mt-1 num" style={{
                        color: kind === 'highlight' ? B.brand : kind === 'credit' ? '#15803d' : B.text,
                        fontFamily: 'var(--font-geist-mono)',
                      }}>
                        {kind === 'credit' ? `(${fmtR(Number(value))})` : fmtR(Number(value))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!latestBatch && (
              <div className="px-6 py-3 text-xs" style={{ color: B.muted }}>
                Nenhum lote de importação calculado para este produto ainda.
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
