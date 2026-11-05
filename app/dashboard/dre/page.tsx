import { TopBar } from '@/components/layout/TopBar'
import { brazilToday } from '@/lib/utils/brazil-time'
import { DRETable } from '@/components/dre/DRETable'
import { buildDRE } from '@/lib/dre/engine'
import { buildDREComparativo } from '@/lib/dre/comparativo'
import { unstable_cache } from 'next/cache'
import { DREComparativo } from '@/components/dre/DREComparativo'
import { Button } from '@/components/ui/button'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ContaAzulUpload } from '@/components/despesas/ContaAzulUpload'
import type { Despesa } from '@/components/despesas/DespesasTable'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

export default async function DREPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  // sem mês escolhido → comparativo de 12 meses (visão principal, 03/11/2026)
  if (!params.month) {
    const hoje = new Date(brazilToday() + 'T12:00:00')
    // 12 meses de vendas = ~17s; cache de 30 min (ciclo de vendas é diário)
    const { meses, linhas, semDespesas } = await unstable_cache(
      () => buildDREComparativo(hoje), ['dre-12m-v2', formatMonth(hoje)], { revalidate: 1800, tags: ['dre-12m'] })()
    return (
      <>
        <TopBar
          title="DRE & Despesas"
          subtitle="Comparativo dos últimos 12 meses"
          actions={
            <div className="flex items-center gap-2">
              <a href="#despesas"><Button variant="outline" size="sm">Enviar relatório Conta Azul ↓</Button></a>
              <a href={`/dashboard/dre?month=${formatMonth(hoje)}`}><Button variant="outline" size="sm">Mês atual por marketplace →</Button></a>
            </div>
          }
        />
        <div className="px-4 md:px-8 py-6 space-y-6">
          <DREComparativo meses={meses} linhas={linhas} semDespesas={semDespesas} />
          <div id="despesas"><ContaAzulUpload /></div>
        </div>
      </>
    )
  }
  const period = new Date(`${params.month}-01T12:00:00`)
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
            <a href="/dashboard/dre">
              <Button variant="outline" size="sm">← Comparativo 12 meses</Button>
            </a>
            <a href="#despesas">
              <Button variant="outline" size="sm">Enviar relatório Conta Azul ↓</Button>
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
        <DRETable rows={rows} despesas={(despesas ?? []) as Despesa[]} />
        <div id="despesas" className="space-y-4">
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
