import { TopBar } from '@/components/layout/TopBar'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { DespesaForm } from '@/components/despesas/DespesaForm'
import { ContaAzulUpload } from '@/components/despesas/ContaAzulUpload'
import { DespesasTable, type Despesa } from '@/components/despesas/DespesasTable'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

export default async function DespesasPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const db = createSupabaseServiceClient()
  const params = await searchParams
  // mês mostrado: ?mes=AAAA-MM, senão o mais recente com despesa
  let mes = /^\d{4}-\d{2}$/.test(params.mes ?? '') ? params.mes! : ''
  if (!mes) {
    const { data } = await db.from('operational_expenses').select('period').order('period', { ascending: false }).limit(1)
    mes = data?.[0]?.period?.slice(0, 7) ?? new Date().toISOString().slice(0, 7)
  }
  const { data: despesas } = await db.from('operational_expenses').select('*')
    .eq('period', `${mes}-01`).order('dre_category').order('amount', { ascending: false })

  return (
    <>
      <TopBar title="Despesas Operacionais" subtitle="Importação mensal da Conta Azul + ajustes + lançamento manual" />
      <div className="px-4 md:px-8 py-6 space-y-6">
        <ContaAzulUpload />
        <form method="get" className="flex items-center gap-2 text-[12px]" style={{ color: 'oklch(0.50 0.025 258)' }}>
          Mês:
          <input type="month" name="mes" defaultValue={mes} className="h-8 px-2 rounded-md border text-[13px]" style={{ borderColor: 'oklch(0.88 0.016 258)' }} />
          <button type="submit" className="h-8 px-3 rounded-md text-[12px] font-bold" style={{ background: '#125BFF', color: 'white', border: 'none' }}>Ver</button>
        </form>
        <DespesasTable despesas={(despesas ?? []) as Despesa[]} />
        <DespesaForm />
      </div>
    </>
  )
}
