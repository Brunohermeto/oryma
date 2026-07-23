/**
 * POST /api/audit/sales?days=45
 *
 * Auditoria automática por venda: roda a bateria de regras sobre a janela,
 * grava achados em audit_findings e REMOVE os que deixaram de se reproduzir
 * (auto-cura — ex: NF chegou, frete preencheu). Roda no fim do ciclo do cron.
 *
 * Severidades: critical = NF possivelmente emitida incorreta / dinheiro em jogo;
 * warn = dado ainda incompleto; info = fora do padrão, olhar quando puder.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { brazilDaysAgo, brazilToday } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const UF_EMITENTE = 'MG'  // MCL é de Belo Horizonte

interface Finding { sale_id: string; rule: string; severity: string; message: string }

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Number(request.nextUrl.searchParams.get('days') ?? '45')
  const db   = createSupabaseServiceClient()
  const from = brazilDaysAgo(days)
  const hoje = brazilToday()
  const d = (n: number) => brazilDaysAgo(n)

  const { data: sales } = await db.from('sales')
    .select(`id, sku, sale_date, gross_price, quantity, product_id, nfe_saida_key, uf_destino,
      marketplace, fulfillment_type, marketplace_commission, marketplace_shipping_fee,
      marketplace_fixed_fee, rebate,
      sale_taxes(icms, icms_difal, pis, cofins, total_taxes),
      sale_costs(total_cost, margin_pct)`)
    .gte('sale_date', from)
    .limit(2000)

  const findings: Finding[] = []
  const add = (s: any, rule: string, severity: string, message: string) =>
    findings.push({ sale_id: s.id, rule, severity, message })

  for (const s of sales ?? []) {
    const g = Number(s.gross_price ?? 0)
    if (g <= 0) continue
    const t = Array.isArray(s.sale_taxes) ? s.sale_taxes[0] : s.sale_taxes
    const c = Array.isArray(s.sale_costs) ? s.sale_costs[0] : s.sale_costs
    const nf = s.nfe_saida_key && s.nfe_saida_key.length === 44
      ? `NF ${Number(s.nfe_saida_key.slice(25, 34))}/${Number(s.nfe_saida_key.slice(22, 25))}`
      : 'NF'
    const idade2d = s.sale_date <= d(2)
    const idade3d = s.sale_date <= d(3)

    if (t) {
      const icmsPct  = Number(t.icms ?? 0) / g * 100
      const difalPct = Number(t.icms_difal ?? 0) / g * 100
      const totPct   = Number(t.total_taxes ?? 0) / g * 100

      // ── NF possivelmente emitida INCORRETA ──
      if (icmsPct > 10 && difalPct > 5) {
        add(s, 'nf_icms_difal_duplicado', 'critical',
          `${nf} (${s.sku}): ICMS interestadual cheio (${icmsPct.toFixed(0)}%) + DIFAL (${difalPct.toFixed(0)}%) na mesma nota — produto importado deveria usar 4%. Corrigir regra de tributação no ML.`)
      }
      if (s.uf_destino === UF_EMITENTE && difalPct > 1) {
        add(s, 'nf_difal_interno', 'critical',
          `${nf} (${s.sku}): DIFAL cobrado em venda interna ${UF_EMITENTE}→${UF_EMITENTE} — não deveria existir.`)
      }
      if (totPct > 32 && !(icmsPct > 10 && difalPct > 5)) {
        add(s, 'nf_carga_alta', 'warn',
          `${nf} (${s.sku}): carga tributária de ${totPct.toFixed(0)}% do valor da venda — acima do esperado, conferir emissão.`)
      }
    } else if (idade3d) {
      add(s, 'sem_nf', 'warn',
        `Venda de ${s.sale_date} (${s.sku}) sem NF-e vinculada há 3+ dias — verificar emissão.`)
    }

    if (s.marketplace === 'mercado_livre' && idade2d) {
      if (Number(s.marketplace_commission ?? 0) === 0 && Number(s.rebate ?? 0) === 0)
        add(s, 'sem_tarifas', 'warn', `Venda de ${s.sale_date} (${s.sku}) sem tarifas do extrato há 2+ dias.`)
      if (Number(s.marketplace_shipping_fee ?? 0) === 0)
        add(s, 'sem_frete', 'warn', `Venda de ${s.sale_date} (${s.sku}) sem frete do vendedor há 2+ dias.`)
    }

    if (!s.product_id) {
      add(s, 'sem_produto', 'warn', `Venda de ${s.sale_date} (${s.sku}) sem produto vinculado — sem custo/margem.`)
    } else if (!c && idade2d) {
      add(s, 'sem_custo', 'warn', `Venda de ${s.sale_date} (${s.sku}) sem custo (CMV) — produto sem NF de entrada/lote.`)
    }

    if (c && Number(c.total_cost ?? 0) > 0.85 * g) {
      add(s, 'custo_incompativel', 'critical',
        `${s.sku}: custo R$${Number(c.total_cost).toFixed(0)} é ${(Number(c.total_cost) / g * 100).toFixed(0)}% do preço R$${g.toFixed(0)} — custo ou preço provavelmente errado.`)
    }
    if (c?.margin_pct !== null && c?.margin_pct !== undefined && Number(c.margin_pct) < -0.2) {
      add(s, 'margem_negativa', 'info',
        `${s.sku} (${s.sale_date}): margem de ${(Number(c.margin_pct) * 100).toFixed(0)}% — prejuízo relevante.`)
    }
  }

  // Reconciliação: remove achados da janela e regrava os atuais (auto-cura)
  const saleIds = (sales ?? []).map(s => s.id)
  for (let i = 0; i < saleIds.length; i += 200) {
    await db.from('audit_findings').delete().in('sale_id', saleIds.slice(i, i + 200))
  }
  let inserted = 0
  for (let i = 0; i < findings.length; i += 200) {
    const { error } = await db.from('audit_findings').insert(findings.slice(i, i + 200))
    if (!error) inserted += Math.min(200, findings.length - i)
  }

  const porRegra: Record<string, number> = {}
  for (const f of findings) porRegra[f.rule] = (porRegra[f.rule] ?? 0) + 1

  return NextResponse.json({
    ok: true, auditadas: (sales ?? []).length, achados: inserted, por_regra: porRegra,
    janela: `${from}..${hoje}`,
  })
}
