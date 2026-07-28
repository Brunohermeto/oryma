/**
 * Vistoria de taxas do ML — divergências entre o que foi cobrado e a tabela
 * oficial (comissão/tarifa fixa) ou o padrão histórico (frete), com o total
 * estimado cobrado a mais. Alimentado por /api/audit/fees (ciclo diário).
 */
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { Scale, AlertTriangle, Info } from 'lucide-react'
import { DismissFindingsButton } from './DismissFindingsButton'

const B = { border: 'oklch(0.88 0.016 258)', muted: 'oklch(0.50 0.025 258)', text: '#0B1023' }

const FEE_RULE_LABELS: Record<string, string> = {
  comissao_acima_tabela:  'Comissão acima da tabela oficial do ML',
  tarifa_fixa_divergente: 'Tarifa fixa diferente da regra oficial',
  frete_fora_padrao:      'Frete acima do padrão histórico do produto',
}

export async function FeeAuditPanel() {
  const db = createSupabaseServiceClient()
  const { data: findings } = await db
    .from('audit_findings')
    .select('id, rule, severity, message, details')
    .in('rule', Object.keys(FEE_RULE_LABELS))
    .is('dismissed_at', null)
    .order('detected_at', { ascending: false })
    .limit(500)

  const total = (findings ?? []).reduce((s, f) => s + Number((f.details as any)?.diff ?? 0), 0)

  const groups = new Map<string, { severity: string; msgs: string[]; diff: number; ids: string[] }>()
  for (const f of findings ?? []) {
    if (!groups.has(f.rule)) groups.set(f.rule, { severity: f.severity, msgs: [], diff: 0, ids: [] })
    const g = groups.get(f.rule)!
    g.msgs.push(f.message)
    g.ids.push(f.id)
    g.diff += Number((f.details as any)?.diff ?? 0)
  }
  const ord = { warn: 0, info: 1 } as Record<string, number>
  const sorted = [...groups.entries()].sort((a, b) => (ord[a[1].severity] ?? 9) - (ord[b[1].severity] ?? 9))

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Scale size={15} style={{ color: '#125BFF' }} />
        <span className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
          Vistoria de taxas do ML
        </span>
        {total > 0.5 && (
          <span className="text-[12px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: '#dc2626', background: 'oklch(0.95 0.03 25)' }}>
            ~R$ {total.toFixed(2)} cobrados a mais
          </span>
        )}
      </div>
      {!findings?.length ? (
        <div className="text-[13px]" style={{ color: B.muted }}>
          Nenhuma divergência encontrada — as taxas cobradas batem com a tabela oficial. ✓
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(([rule, g]) => {
            const Icon = g.severity === 'warn' ? AlertTriangle : Info
            const color = g.severity === 'warn' ? '#d97706' : B.muted
            return (
              <details key={rule} className="rounded-lg px-3 py-2" style={{ background: 'oklch(0.97 0.008 258)' }}>
                <summary className="cursor-pointer flex items-center gap-2 text-[13px] font-medium" style={{ color: B.text }}>
                  <Icon size={13} style={{ color, flexShrink: 0 }} />
                  {FEE_RULE_LABELS[rule] ?? rule}
                  <span className="text-[11px] font-bold px-1.5 rounded-full" style={{ color, background: 'white' }}>{g.msgs.length}</span>
                  {g.diff > 0.5 && (
                    <span className="text-[11px] font-semibold" style={{ color: '#dc2626' }}>R$ {g.diff.toFixed(2)}</span>
                  )}
                  <DismissFindingsButton ids={g.ids} />
                </summary>
                <div className="mt-2 space-y-1 pl-5">
                  {g.msgs.slice(0, 8).map((m, i) => (
                    <div key={i} className="text-[12px]" style={{ color: B.muted }}>• {m}</div>
                  ))}
                  {g.msgs.length > 8 && (
                    <div className="text-[11px] italic" style={{ color: B.muted }}>… e mais {g.msgs.length - 8}</div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}
