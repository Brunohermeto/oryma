/**
 * GET /api/audit/report
 * Relatório da auditoria em CSV (abre no Excel): um apontamento por linha com
 * pedido ML, NF, SKU, data, problema, valores cobrado/esperado/diferença.
 * Para conferência interna e contestação junto aos marketplaces.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const RULE_LABELS: Record<string, string> = {
  nf_icms_difal_duplicado: 'NF possivelmente incorreta — ICMS + DIFAL duplicados',
  nf_difal_interno:        'NF possivelmente incorreta — DIFAL em venda interna',
  nf_carga_alta:           'Carga tributária acima do esperado',
  sem_nf:                  'Venda sem NF-e vinculada',
  sem_tarifas:             'Tarifas do canal não capturadas',
  sem_frete:               'Frete do vendedor não capturado',
  sem_produto:             'Venda sem produto vinculado',
  sem_custo:               'Produto sem custo (NF de entrada faltando)',
  custo_incompativel:      'Custo incompatível com o preço',
  margem_negativa:         'Venda com prejuízo relevante',
  comissao_acima_tabela:   'Comissão acima da tabela oficial do ML',
  comissao_abaixo_tabela:  'Comissão abaixo da tabela (possível valor líquido gravado)',
  tarifa_fixa_divergente:  'Tarifa fixa diferente da regra oficial',
  frete_fora_padrao:       'Frete acima do padrão histórico',
}

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createSupabaseServiceClient()

  const { data: findings } = await db
    .from('audit_findings')
    .select(`rule, severity, message, details, detected_at,
      sales(external_order_id, sku, sale_date, nfe_saida_key, gross_price, marketplace)`)
    .is('dismissed_at', null)
    .order('detected_at', { ascending: false })
    .limit(2000)

  const header = ['Data da venda', 'Pedido', 'Canal', 'NF (nº/série)', 'SKU', 'Valor da venda',
    'Problema', 'Detalhe', 'Cobrado (R$)', 'Esperado (R$)', 'Diferença (R$)', 'Severidade']
  const lines = [header.join(';')]

  for (const f of findings ?? []) {
    const s: any = Array.isArray(f.sales) ? f.sales[0] : f.sales
    const d: any = f.details ?? {}
    const pedido = s?.external_order_id?.match(/^ml_(\d+)_/)?.[1] ?? s?.external_order_id ?? ''
    const chave = s?.nfe_saida_key ?? ''
    const nf = chave.length === 44 ? `${Number(chave.slice(25, 34))}/${Number(chave.slice(22, 25))}` : ''
    const num = (v: unknown) => v === undefined || v === null ? '' : String(v).replace('.', ',')
    lines.push([
      s?.sale_date ?? '', pedido, s?.marketplace ?? '', nf, s?.sku ?? '', num(s?.gross_price),
      RULE_LABELS[f.rule] ?? f.rule, f.message,
      num(d.cobrado), num(d.esperado), num(d.diff),
      f.severity,
    ].map(csvCell).join(';'))
  }

  // BOM para o Excel abrir com acentuação correta
  const csv = '﻿' + lines.join('\r\n')
  const hoje = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="auditoria-oryma-${hoje}.csv"`,
    },
  })
}
