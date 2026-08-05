/**
 * Motor do Planejamento de Importação — funções puras (server e client).
 *
 * Âncoras: D0 = pedido · D1 = embarque China · D2 = chegada Santos ·
 * DG = chegada galpão. O perfil dá os prazos-padrão; datas REAIS informadas
 * no pedido substituem a âncora e RECASCATEIAM as seguintes (um atraso de
 * navio empurra Santos, galpão, estoque e parcelas automaticamente).
 */

export interface Parcela {
  pct: number                 // 0.2 = 20%
  ancora: 'D0' | 'D1' | 'D2' | 'DG'
  offset: number              // dias após a âncora
}

export interface ImportProfile {
  id: string
  root_sku: string
  name: string
  dias_producao: number
  dias_embarque: number
  dias_santos: number
  dias_galpao: number
  parcelas: Parcela[]
  imposto_frete_ancora: 'D0' | 'D1' | 'D2' | 'DG'
}

export interface ImportPlan {
  id: string
  invoice: string
  profile_id: string | null
  containers: number
  order_date: string          // D0 (yyyy-mm-dd)
  embarque_real: string | null
  santos_real: string | null
  galpao_real: string | null
  status_override: string | null
  valor_fornecedor: number
  valor_imposto_frete: number
  valor_pago?: number         // efetivamente pago até agora (histórico)
  parcelas: Parcela[] | null  // null = herda do perfil
  notes: string | null
  done: boolean
  compromissado?: boolean   // false = pedido PREVISTO (em estudo, ainda não fechado)
  extras?: PagamentoExtra[] // taxas avulsas (Siscomex, AFRMM, armazenagem, despachante…)
}

export interface PagamentoExtra {
  label: string
  valor: number
  ancora?: 'D0' | 'D1' | 'D2' | 'DG'  // quando por âncora da linha do tempo…
  offset?: number
  data?: string                        // …ou data fixa (vence sobre a âncora)
}

export interface PlanDates {
  d0: string
  fimProducao: string
  d1: string                  // embarque (real ou projetado)
  d2: string                  // Santos (real ou projetado, recascateado)
  dg: string                  // galpão (real ou projetado, recascateado)
  status: string
}

export interface Pagamento {
  label: string
  date: string
  amount: number
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Datas do pedido com cascata: data real substitui a projeção e empurra as seguintes. */
export function resolvePlanDates(plan: ImportPlan, profile: ImportProfile, hoje: string): PlanDates {
  const d0 = plan.order_date
  const fimProducao = addDays(d0, profile.dias_producao)

  const d1 = plan.embarque_real ?? addDays(d0, profile.dias_embarque)
  // trechos relativos do perfil: embarque→Santos e Santos→galpão
  const diasMar    = Math.max(0, profile.dias_santos - profile.dias_embarque)
  const diasTerra  = Math.max(0, profile.dias_galpao - profile.dias_santos)
  const d2 = plan.santos_real ?? addDays(d1, diasMar)
  const dg = plan.galpao_real ?? addDays(d2, diasTerra)

  let status: string
  if (plan.done || (plan.galpao_real && plan.galpao_real <= hoje)) status = 'No galpão'
  // Projeção vencida NÃO vira "No galpão" sozinha — chegada exige confirmação
  else if (hoje >= dg) status = 'Chegada prevista — confirmar'
  else if (hoje >= d2) status = 'Transporte terrestre'
  else if (hoje >= d1) status = 'Trânsito marítimo'
  else if (hoje >= fimProducao) status = 'Aguardando embarque'
  else status = 'Em produção'
  if (plan.status_override) status = plan.status_override

  return { d0, fimProducao, d1, d2, dg, status }
}

/** Parcelas do pedido resolvidas em datas e valores (regra do pedido ou do perfil). */
export function resolvePagamentos(plan: ImportPlan, profile: ImportProfile, dates: PlanDates): Pagamento[] {
  const ancoras: Record<string, string> = { D0: dates.d0, D1: dates.d1, D2: dates.d2, DG: dates.dg }
  const regras = (plan.parcelas && plan.parcelas.length ? plan.parcelas : profile.parcelas) ?? []
  const pags: Pagamento[] = regras.map((p, i) => ({
    label: `Parcela ${i + 1} (${Math.round(p.pct * 100)}% ${p.ancora}${p.offset ? `+${p.offset}d` : ''})`,
    date: addDays(ancoras[p.ancora] ?? dates.d0, p.offset ?? 0),
    amount: Math.round(plan.valor_fornecedor * p.pct * 100) / 100,
  }))
  if (plan.valor_imposto_frete > 0) {
    pags.push({
      label: `Impostos + frete (${profile.imposto_frete_ancora})`,
      date: ancoras[profile.imposto_frete_ancora] ?? dates.d2,
      amount: plan.valor_imposto_frete,
    })
  }
  // Taxas extras avulsas: data fixa ou âncora+offset — recascateiam junto
  for (const ex of plan.extras ?? []) {
    if (!ex?.label || !(Number(ex.valor) > 0)) continue
    const date = ex.data && /^\d{4}-\d{2}-\d{2}$/.test(ex.data)
      ? ex.data
      : addDays(ancoras[ex.ancora ?? 'D2'] ?? dates.d2, Number(ex.offset ?? 0))
    pags.push({ label: ex.label, date, amount: Number(ex.valor) })
  }
  return pags.sort((a, b) => (a.date < b.date ? -1 : 1))
}

export const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Em produção':                  { bg: 'oklch(0.96 0.08 70)',  color: '#92400e' },
  'Aguardando embarque':          { bg: 'oklch(0.94 0.06 258)', color: '#125BFF' },
  'Trânsito marítimo':            { bg: 'oklch(0.94 0.08 204)', color: '#0097b2' },
  'Transporte terrestre':         { bg: 'oklch(0.94 0.08 280)', color: '#7B61FF' },
  'Chegada prevista — confirmar': { bg: 'oklch(0.96 0.08 70)',  color: '#92400e' },
  'No galpão':                    { bg: 'oklch(0.94 0.10 145)', color: '#15803d' },
}
