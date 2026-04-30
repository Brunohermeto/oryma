import { TopBar } from '@/components/layout/TopBar'
import { DRETable } from '@/components/dre/DRETable'
import { buildDRE } from '@/lib/dre/engine'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function DREPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  const period = params.month ? new Date(`${params.month}-01`) : new Date()
  const rows = await buildDRE(period)
  const currentMonth = period.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <>
      <TopBar
        title="DRE Gerencial"
        subtitle={`Demonstração de Resultado — ${currentMonth}`}
        actions={
          <div className="flex items-center gap-2">
            <a href={`/dashboard/dre?month=${formatMonth(prevMonth(period))}`}>
              <Button variant="outline" size="sm">← Mês anterior</Button>
            </a>
            <a href={`/dashboard/dre?month=${formatMonth(nextMonth(period))}`}>
              <Button variant="outline" size="sm">Próximo mês →</Button>
            </a>
          </div>
        }
      />
      <div className="px-8 py-6">
        <DRETable rows={rows} />
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
