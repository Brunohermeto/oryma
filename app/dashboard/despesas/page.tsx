import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { EXPENSE_CATEGORY_LABELS } from '@/types'
import { DespesaForm } from '@/components/despesas/DespesaForm'

export const dynamic = 'force-dynamic'

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
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="font-semibold text-gray-800 text-sm">Despesas Lançadas</div>
            <div className="text-sm text-gray-500">Total: <span className="font-semibold text-gray-900">{fmtR(total)}</span></div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3">Competência</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-left px-4 py-3">Fornecedor</th>
                <th className="text-right px-5 py-3">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(expenses ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400 text-sm">Nenhuma despesa lançada ainda.</td></tr>
              )}
              {(expenses ?? []).map(exp => (
                <tr key={exp.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-500 text-xs">{exp.period?.slice(0, 7)}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      {(EXPENSE_CATEGORY_LABELS as any)[exp.dre_category] ?? exp.dre_category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{exp.description ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{exp.supplier ?? '—'}</td>
                  <td className="px-5 py-3 text-right font-semibold text-gray-900">{fmtR(Number(exp.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
