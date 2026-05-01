import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { EXPENSE_CATEGORY_LABELS } from '@/types'
import { DespesaForm } from '@/components/despesas/DespesaForm'

export const dynamic = 'force-dynamic'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  subtle:   'oklch(0.40 0.020 258)',
  brand:    '#125BFF',
}

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

export default async function DespesasPage() {
  const db = createSupabaseServiceClient()
  const { data: expenses } = await db
    .from('operational_expenses')
    .select('*')
    .order('period', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)

  const total = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)

  return (
    <>
      <TopBar title="Despesas Operacionais" subtitle="Lançamento manual de despesas por categoria" />
      <div className="px-8 py-6 space-y-6">
        <DespesaForm />

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${B.border}` }}>
            <div className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
              Despesas Lançadas
            </div>
            <div className="text-sm" style={{ color: B.muted }}>
              Total:{' '}
              <span className="font-semibold num" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                {fmtR(total)}
              </span>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}>
                {['Competência','Categoria','Descrição','Fornecedor','Valor'].map((h, i) => (
                  <th
                    key={h}
                    className={`py-3 text-[11px] font-semibold uppercase tracking-wide ${i === 4 ? 'text-right px-5' : 'text-left px-5'}`}
                    style={{ color: B.muted }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(expenses ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm" style={{ color: B.muted }}>
                    Nenhuma despesa lançada ainda.
                  </td>
                </tr>
              )}
              {(expenses ?? []).map(exp => (
                <tr
                  key={exp.id}
                  className="transition-colors"
                  style={{ borderBottom: `1px solid ${B.bgSubtle}` }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = B.bgSubtle }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  <td className="px-5 py-3 text-xs" style={{ color: B.muted }}>{exp.period?.slice(0, 7)}</td>
                  <td className="px-5 py-3 text-xs">
                    <span className="font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: 'oklch(0.94 0.06 258)', color: B.brand }}>
                      {(EXPENSE_CATEGORY_LABELS as any)[exp.dre_category] ?? exp.dre_category}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: B.subtle }}>{exp.description ?? '—'}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: B.muted }}>{exp.supplier ?? '—'}</td>
                  <td className="px-5 py-3 text-right font-semibold num" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                    {fmtR(Number(exp.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
