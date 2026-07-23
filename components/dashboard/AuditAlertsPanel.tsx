import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ShieldAlert, AlertTriangle, Info } from 'lucide-react'

const B = {
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  text:   '#0B1023',
}

const RULE_LABELS: Record<string, string> = {
  nf_icms_difal_duplicado: 'NF-e possivelmente emitida incorreta — ICMS + DIFAL duplicados',
  nf_difal_interno:        'NF-e possivelmente emitida incorreta — DIFAL em venda interna',
  nf_carga_alta:           'Carga tributária acima do esperado',
  sem_nf:                  'Vendas sem NF-e vinculada',
  sem_tarifas:             'Tarifas do canal ainda não capturadas',
  sem_frete:               'Frete do vendedor ainda não capturado',
  sem_produto:             'Vendas sem produto vinculado',
  sem_custo:               'Produtos sem custo (NF de entrada faltando)',
  custo_incompativel:      'Custo incompatível com o preço de venda',
  margem_negativa:         'Vendas com prejuízo relevante',
}

export async function AuditAlertsPanel() {
  const db = createSupabaseServiceClient()
  const { data: findings } = await db
    .from('audit_findings')
    .select('rule, severity, message')
    .order('detected_at', { ascending: false })
    .limit(500)

  if (!findings?.length) return null

  // Agrupa por regra, ordena por severidade
  const groups = new Map<string, { severity: string; msgs: string[] }>()
  for (const f of findings) {
    if (!groups.has(f.rule)) groups.set(f.rule, { severity: f.severity, msgs: [] })
    groups.get(f.rule)!.msgs.push(f.message)
  }
  const ord = { critical: 0, warn: 1, info: 2 } as Record<string, number>
  const sorted = [...groups.entries()].sort((a, b) => (ord[a[1].severity] ?? 9) - (ord[b[1].severity] ?? 9))

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert size={15} style={{ color: '#dc2626' }} />
        <span className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
          Auditoria automática — {findings.length} apontamento{findings.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-2">
        {sorted.map(([rule, g]) => {
          const Icon = g.severity === 'critical' ? ShieldAlert : g.severity === 'warn' ? AlertTriangle : Info
          const color = g.severity === 'critical' ? '#dc2626' : g.severity === 'warn' ? '#d97706' : B.muted
          return (
            <details key={rule} className="rounded-lg px-3 py-2" style={{ background: 'oklch(0.97 0.008 258)' }}>
              <summary className="cursor-pointer flex items-center gap-2 text-[13px] font-medium" style={{ color: B.text }}>
                <Icon size={13} style={{ color, flexShrink: 0 }} />
                {RULE_LABELS[rule] ?? rule}
                <span className="text-[11px] font-bold px-1.5 rounded-full" style={{ color, background: 'white' }}>{g.msgs.length}</span>
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
    </div>
  )
}
