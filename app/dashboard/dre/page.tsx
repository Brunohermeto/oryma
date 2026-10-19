import { TopBar } from '@/components/layout/TopBar'
import { brazilToday } from '@/lib/utils/brazil-time'
import { DRETable } from '@/components/dre/DRETable'
import { buildDRE } from '@/lib/dre/engine'
import { Button } from '@/components/ui/button'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ContaAzulUpload } from '@/components/despesas/ContaAzulUpload'
import { DespesasTable, type Despesa } from '@/components/despesas/DespesasTable'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

export default async function DREPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  const period = params.month ? new Date(`${params.month}-01`) : new Date(brazilToday() + 'T12:00:00')
  const rows = await buildDRE(period)
  const currentMonth = period.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  // despesas do mesmo mês, editáveis aqui mesmo (Bruno não achava a aba Despesas — 19/10/2026)
  const { data: despesas } = await createSupabaseServiceClient().from('operational_expenses').select('*')
    .eq('period', `${formatMonth(period)}-01`).order('dre_category').order('amount', { ascending: false })

  return (
    <>
      <TopBar
        title="DRE & Despesas"
        subtitle={`Demonstração de Resultado — ${currentMonth}`}
        actions={
          <div className="flex items-center gap-2">
            <a href="#despesas">
              <Button variant="outline" size="sm">Despesas e envio Conta Azul ↓</Button>
            </a>
            <a href={`/dashboard/dre?month=${formatMonth(prevMonth(period))}`}>
              <Button variant="outline" size="sm">← Mês anterior</Button>
            </a>
            <a href={`/dashboard/dre?month=${formatMonth(nextMonth(period))}`}>
              <Button variant="outline" size="sm">Próximo mês →</Button>
            </a>
          </div>
        }
      />
      <div className="px-4 md:px-8 py-6 space-y-6">
        <DRETable rows={rows} />
        <div id="despesas" className="space-y-4">
          <div className="text-sm font-semibold" style={{ color: '#0B1023' }}>Despesas de {currentMonth} — clique em ✎ editar para corrigir valor, excluir ou anotar</div>
          <DespesasTable despesas={(despesas ?? []) as Despesa[]} />
          <ContaAzulUpload />
        </div>
      </div>
    </>
  )
}

function prevMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1)
}
function nextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1)
}
function formatMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
