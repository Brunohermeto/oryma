# Dashboard de Gestão + Vistoria de Taxas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visão Geral vira centro de gestão (taxas pagas, margem média por produto com filtro/UF) + motor que confere venda a venda se as taxas do ML batem com a tabela oficial.

**Architecture:** Reusa `audit_findings` + auto-cura para a vistoria (rota fatiada nova `/api/audit/fees`); Visão Geral ganha seções server-rendered com um componente client para a tabela de margem. Nenhuma tabela nova — só uma coluna `details jsonb`.

**Tech Stack:** Next.js 16 App Router (Vercel Hobby, maxDuration 60), Supabase PostgREST via service role, ML API.

## Global Constraints

- Rotas de backend: POST, auth por cookie `mi_auth === APP_PASSWORD` OU header `x-cron-secret` (padrão das rotas em `app/api/sync/ml/*`).
- Rotas que chamam ML API: fatiadas (body `{days, limit, skip}`, retornam `processed_*` e `remaining_*`), `maxDuration = 60`, `preferredRegion = 'gru1'`.
- Margem NULL (venda sem `sale_taxes`) = "em cálculo": fora de médias e somas.
- Comissão gravada é BRUTA; estorno em `rebate` (positivo). Cupom em `discounts` não desconta margem.
- Sem testes automatizados no repo: validação = `npx tsc --noEmit` + script gabarito em Python no scratchpad contra dados reais.
- DDL: Bruno roda manualmente no SQL Editor do Supabase; arquivo de migração vai em `supabase/migrations/`.
- UI segue paleta B existente (`oklch`, `#125BFF`, font Sora) — copiar dos componentes vizinhos.

---

### Task 1: Coluna `details` em audit_findings (migração manual)

**Files:**
- Create: `supabase/migrations/20260725_audit_details.sql`

**Interfaces:**
- Produces: coluna `audit_findings.details jsonb` — a vistoria grava `{"cobrado": 12.5, "esperado": 10.2, "diff": 2.3}`; painel soma `diff`.

- [ ] **Step 1: Criar o arquivo de migração**

```sql
-- Vistoria de taxas: detalhe numérico da divergência (cobrado/esperado/diff)
ALTER TABLE audit_findings ADD COLUMN IF NOT EXISTS details jsonb;
```

- [ ] **Step 2: Pedir ao Bruno para rodar no SQL Editor** (ele responde "feito"). Verificar com uma consulta PostgREST: `GET /rest/v1/audit_findings?select=details&limit=1` deve retornar 200 (não 400).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260725_audit_details.sql
git commit -m "Migração: coluna details em audit_findings para vistoria de taxas"
```

---

### Task 2: Restringir a auto-cura da auditoria atual às próprias regras

Hoje `app/api/audit/sales/route.ts:107-110` apaga TODOS os findings das vendas da janela — apagaria os da vistoria. Restringir o delete às regras daquela rota.

**Files:**
- Modify: `app/api/audit/sales/route.ts:106-110`

**Interfaces:**
- Produces: constante `SALES_AUDIT_RULES` (lista das 10 regras atuais). A rota de fees fará o mesmo com as dela.

- [ ] **Step 1: Adicionar a lista de regras no topo do arquivo (após `UF_EMITENTE`)**

```ts
const SALES_AUDIT_RULES = [
  'nf_icms_difal_duplicado', 'nf_difal_interno', 'nf_carga_alta', 'sem_nf',
  'sem_tarifas', 'sem_frete', 'sem_produto', 'sem_custo',
  'custo_incompativel', 'margem_negativa',
]
```

- [ ] **Step 2: Filtrar o delete da reconciliação**

```ts
  // Reconciliação: remove SÓ os achados DESTAS regras (a vistoria de taxas tem as dela)
  const saleIds = (sales ?? []).map(s => s.id)
  for (let i = 0; i < saleIds.length; i += 200) {
    await db.from('audit_findings').delete()
      .in('sale_id', saleIds.slice(i, i + 200))
      .in('rule', SALES_AUDIT_RULES)
  }
```

- [ ] **Step 3: `npx tsc --noEmit` limpo, commit**

```bash
git add app/api/audit/sales/route.ts
git commit -m "Auditoria de vendas só auto-cura as próprias regras"
```

---

### Task 3: Motor de vistoria — `/api/audit/fees`

**Files:**
- Create: `app/api/audit/fees/route.ts`

**Interfaces:**
- Consumes: `mlGet` de `@/lib/integrations/mercado-livre`; `brazilDaysAgo` de `@/lib/utils/brazil-time`; coluna `details` (Task 1).
- Produces: findings com rules `comissao_acima_tabela` (warn), `tarifa_fixa_divergente` (warn), `frete_fora_padrao` (info), cada um com `details {cobrado, esperado, diff}`. Resposta `{ok, processed_items, processed_sales, achados, remaining_items}`.

Regras de negócio:
- Só vendas `mercado_livre` com `marketplace_commission > 0` (extrato já chegou) na janela `days` (default 30).
- Tabela oficial: por anúncio único (mlb) → `GET /items/{mlb}?attributes=category_id,listing_type_id` e depois `GET /sites/MLB/listing_prices?price={unitPrice}&listing_type_id={lt}&category_id={cat}`. `sale_fee_details.gross_amount` = comissão % + tarifa fixa POR UNIDADE.
- Comparação: `cobrado = marketplace_commission + marketplace_fixed_fee` vs `esperado = gross_amount × quantity`. Divergência se `cobrado - esperado > 0.10` (só cobrança A MAIS; a menor é a nosso favor). Se `sale_fee_details.fixed_fee` divergir sozinho > 0.10 → regra `tarifa_fixa_divergente`; senão `comissao_acima_tabela`.
- Frete: mediana de `marketplace_shipping_fee/quantity` das vendas do MESMO `product_id` + `fulfillment_type` nos últimos 90d com frete > 0; mínimo 5 vendas; alerta se frete unitário da venda > 1.25 × mediana. Regra `frete_fora_padrao`, `diff = (freteUnit - mediana) × quantity`.
- Fatiamento por ANÚNCIO único: `limit` = nº de anúncios por chamada (default 25), `skip` = anúncios a pular. Auto-cura: delete dos findings das 3 regras para as vendas processadas nesta fatia, antes do insert.

- [ ] **Step 1: Escrever a rota completa**

```ts
/**
 * POST /api/audit/fees  body {days?, limit?, skip?}
 *
 * Vistoria de taxas do ML: confere venda a venda se comissão + tarifa fixa
 * batem com a tabela oficial da categoria (listing_prices) e se o frete está
 * dentro do padrão histórico do produto. Divergência vira audit_finding com
 * details {cobrado, esperado, diff}; auto-cura igual à auditoria de vendas.
 * Fatiada por anúncio: limit=anúncios por chamada, skip=pular já feitos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { mlGet } from '@/lib/integrations/mercado-livre'
import { brazilDaysAgo } from '@/lib/utils/brazil-time'

export const dynamic         = 'force-dynamic'
export const maxDuration     = 60
export const preferredRegion = 'gru1'

const FEE_RULES = ['comissao_acima_tabela', 'tarifa_fixa_divergente', 'frete_fora_padrao']
const TOL = 0.10
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface SaleRow {
  id: string; external_order_id: string; sku: string; sale_date: string
  gross_price: number; quantity: number; product_id: string | null
  fulfillment_type: string | null
  marketplace_commission: number; marketplace_fixed_fee: number
  marketplace_shipping_fee: number
}

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  const cronSecret = request.headers.get('x-cron-secret')
  const isAuthorized = authCookie === process.env.APP_PASSWORD
    || (process.env.CRON_SECRET ? cronSecret === process.env.CRON_SECRET : cronSecret === 'internal')
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body  = await request.json().catch(() => ({}))
  const days  = Number(body.days ?? 30)
  const limit = Number(body.limit ?? 25)
  const skip  = Number(body.skip ?? 0)
  const db    = createSupabaseServiceClient()

  const { data: sales } = await db.from('sales')
    .select('id, external_order_id, sku, sale_date, gross_price, quantity, product_id, fulfillment_type, marketplace_commission, marketplace_fixed_fee, marketplace_shipping_fee')
    .eq('marketplace', 'mercado_livre')
    .gt('marketplace_commission', 0)
    .gte('sale_date', brazilDaysAgo(days))
    .limit(2000) as { data: SaleRow[] | null }

  // Agrupa por anúncio (mlb) — a tabela oficial é por anúncio
  const byItem = new Map<string, SaleRow[]>()
  for (const s of sales ?? []) {
    const mlb = s.external_order_id?.match(/^ml_\d+_(\S+)$/)?.[1]
    if (!mlb) continue
    if (!byItem.has(mlb)) byItem.set(mlb, [])
    byItem.get(mlb)!.push(s)
  }
  const items = [...byItem.keys()].sort()
  const batch = items.slice(skip, skip + limit)

  // Mediana de frete unitário por produto+logística (90d) para o padrão histórico
  const { data: freightRows } = await db.from('sales')
    .select('product_id, fulfillment_type, marketplace_shipping_fee, quantity')
    .eq('marketplace', 'mercado_livre')
    .gt('marketplace_shipping_fee', 0)
    .gte('sale_date', brazilDaysAgo(90))
    .not('product_id', 'is', null)
    .limit(5000)
  const freightMap = new Map<string, number[]>()
  for (const r of freightRows ?? []) {
    const k = `${r.product_id}|${r.fulfillment_type}`
    if (!freightMap.has(k)) freightMap.set(k, [])
    freightMap.get(k)!.push(Number(r.marketplace_shipping_fee) / Math.max(1, Number(r.quantity)))
  }
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b)
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  }

  interface Finding {
    sale_id: string; rule: string; severity: string; message: string
    details: { cobrado: number; esperado: number; diff: number }
  }
  const findings: Finding[] = []
  const processedSaleIds: string[] = []
  const r2 = (v: number) => Math.round(v * 100) / 100

  for (const mlb of batch) {
    const itemSales = byItem.get(mlb)!
    // Tabela oficial por preço unitário distinto do anúncio
    let cat = '', lt = ''
    try {
      const it = await mlGet<{ category_id?: string; listing_type_id?: string }>(
        `/items/${mlb}?attributes=category_id,listing_type_id`)
      cat = it.category_id ?? ''
      lt  = it.listing_type_id ?? ''
    } catch { continue }  // anúncio removido — pula sem marcar processado? Não: marca, senão trava o skip
    const expectedByPrice = new Map<number, { gross: number; fixed: number }>()

    for (const s of itemSales) {
      processedSaleIds.push(s.id)
      const unitPrice = Number(s.gross_price) / Math.max(1, Number(s.quantity))
      const key = r2(unitPrice)
      if (!expectedByPrice.has(key) && cat && lt) {
        try {
          await sleep(150)
          const res = await mlGet<any>(
            `/sites/MLB/listing_prices?price=${key}&listing_type_id=${lt}&category_id=${cat}`)
          const lp = Array.isArray(res) ? (res.find((r: any) => r.listing_type_id === lt) ?? res[0]) : res
          const det = lp?.sale_fee_details ?? {}
          expectedByPrice.set(key, {
            gross: Number(det.gross_amount ?? lp?.sale_fee_amount ?? 0),
            fixed: Number(det.fixed_fee ?? 0),
          })
        } catch { expectedByPrice.set(key, { gross: 0, fixed: 0 }) }
      }
      const exp = expectedByPrice.get(key)
      const nfLabel = `${s.sku} (${s.sale_date})`

      // ── Comissão + tarifa fixa vs tabela oficial ──
      if (exp && exp.gross > 0) {
        const cobrado  = Number(s.marketplace_commission) + Number(s.marketplace_fixed_fee ?? 0)
        const esperado = exp.gross * Number(s.quantity)
        const diff     = r2(cobrado - esperado)
        if (diff > TOL) {
          const fixedCobrada  = Number(s.marketplace_fixed_fee ?? 0)
          const fixedEsperada = exp.fixed * Number(s.quantity)
          const fixedDiff     = r2(fixedCobrada - fixedEsperada)
          const isFixed = Math.abs(fixedDiff) > TOL && Math.abs(diff - fixedDiff) <= TOL
          findings.push({
            sale_id: s.id,
            rule: isFixed ? 'tarifa_fixa_divergente' : 'comissao_acima_tabela',
            severity: 'warn',
            message: `${nfLabel}: ML cobrou R$${cobrado.toFixed(2)} de tarifa de venda, tabela oficial diz R$${esperado.toFixed(2)} — R$${diff.toFixed(2)} a mais.`,
            details: { cobrado: r2(cobrado), esperado: r2(esperado), diff },
          })
        }
      }

      // ── Frete vs padrão histórico ──
      const freteUnit = Number(s.marketplace_shipping_fee) / Math.max(1, Number(s.quantity))
      const hist = s.product_id ? freightMap.get(`${s.product_id}|${s.fulfillment_type}`) : undefined
      if (freteUnit > 0 && hist && hist.length >= 5) {
        const med = median(hist)
        if (med > 0 && freteUnit > 1.25 * med) {
          const diff = r2((freteUnit - med) * Number(s.quantity))
          findings.push({
            sale_id: s.id, rule: 'frete_fora_padrao', severity: 'info',
            message: `${nfLabel}: frete de R$${freteUnit.toFixed(2)}/un — padrão do produto é R$${med.toFixed(2)} (${hist.length} vendas). R$${diff.toFixed(2)} acima.`,
            details: { cobrado: r2(freteUnit * s.quantity), esperado: r2(med * s.quantity), diff },
          })
        }
      }
    }
  }

  // Auto-cura: apaga achados DESTAS regras para as vendas processadas, regrava
  for (let i = 0; i < processedSaleIds.length; i += 200) {
    await db.from('audit_findings').delete()
      .in('sale_id', processedSaleIds.slice(i, i + 200))
      .in('rule', FEE_RULES)
  }
  let inserted = 0
  for (let i = 0; i < findings.length; i += 200) {
    const { error } = await db.from('audit_findings').insert(findings.slice(i, i + 200))
    if (!error) inserted += Math.min(200, findings.length - i)
  }

  return NextResponse.json({
    ok: true,
    processed_items: batch.length,
    processed_sales: processedSaleIds.length,
    achados: inserted,
    remaining_items: Math.max(0, items.length - skip - batch.length),
  })
}
```

Nota sobre o `catch { continue }` do `/items`: anúncio removido pula o anúncio mas ele CONTA no skip (o chamador avança `skip += limit` sempre), então não trava o loop.

- [ ] **Step 2: `npx tsc --noEmit` limpo, commit**

```bash
git add app/api/audit/fees/route.ts
git commit -m "Motor de vistoria de taxas do ML (comissão/tarifa fixa vs tabela oficial + frete vs padrão)"
```

- [ ] **Step 3: Validar em produção com script gabarito** (após deploy — pode ser feito na Task 8 junto com o backfill).

---

### Task 4: Bloco "Taxas pagas" na Visão Geral

**Files:**
- Modify: `app/dashboard/page.tsx` (a consulta principal de `sales` já traz `marketplace_commission, marketplace_shipping_fee, ads_cost`; adicionar `marketplace_fixed_fee, rebate` ao select)

**Interfaces:**
- Consumes: consulta `sales` existente do período (30d).
- Produces: seção visual; nenhum export.

- [ ] **Step 1: Ampliar o select da consulta principal** (linha ~40): acrescentar `marketplace_fixed_fee, rebate` à lista de colunas.

- [ ] **Step 2: Calcular os totais após os KPIs existentes**

```ts
  // ── Taxas pagas no período ──
  const fees = (sales ?? []).reduce((a, r) => {
    a.comissao += Number(r.marketplace_commission ?? 0)
    a.frete    += Number(r.marketplace_shipping_fee ?? 0)
    a.fixa     += Number((r as any).marketplace_fixed_fee ?? 0)
    a.ads      += Number(r.ads_cost ?? 0)
    a.estorno  += Number((r as any).rebate ?? 0)
    return a
  }, { comissao: 0, frete: 0, fixa: 0, ads: 0, estorno: 0 })
  const feesTotal = fees.comissao + fees.frete + fees.fixa + fees.ads - fees.estorno
```

- [ ] **Step 3: Renderizar o bloco** logo abaixo da linha de KPIs, mesmo estilo de card dos KPIs (copiar o card existente). Layout: 6 mini-cards em linha — Comissão, Frete, Tarifa fixa, Publicidade, Estorno (verde, sinal −), **Total** — cada um com R$ e `% do faturamento` (`v / totalRevenue * 100`, 1 casa). Título da seção: "Taxas pagas ao marketplace — últimos 30 dias".

- [ ] **Step 4: `npx tsc --noEmit`, commit**

```bash
git add app/dashboard/page.tsx
git commit -m "Visão Geral: bloco taxas pagas ao marketplace (R$ e % do faturamento)"
```

---

### Task 5: Tabela "Margem por produto" com filtro de período e UF expandida

**Files:**
- Create: `components/dashboard/MarginByProductTable.tsx` (client)
- Modify: `app/dashboard/page.tsx` (agregação server + prop; ler `searchParams.days`)

**Interfaces:**
- Consumes: `sales` + `sale_costs` + `sale_taxes` + `products` (consulta própria por período).
- Produces: `export function MarginByProductTable({ rows, days }: { rows: ProductMarginRow[]; days: number })` e o tipo:

```ts
export interface ProductMarginRow {
  productId: string
  name: string
  sku: string
  units: number
  revenue: number          // faturamento bruto − cancelamentos
  cost: number             // Σ sale_costs.total_cost (só vendas com custo)
  fees: number             // Σ comissão + frete + fixa − estorno
  marginValue: number      // Σ sale_costs.margin_value das vendas COM impostos
  marginRevenue: number    // Σ gross das mesmas vendas (denominador da % média)
  inCalc: number           // vendas ainda sem impostos ("em cálculo")
  velocityDay: number      // units / days do período
  coverageDays: number | null  // (stock_qty + stock_full) / velocityDay
  byUf: Array<{ uf: string; units: number; marginPct: number | null }>
}
```

- [ ] **Step 1: Agregação no server (`page.tsx`)** — `searchParams` chega como Promise no Next 16:

```ts
export default async function DashboardPage(
  { searchParams }: { searchParams: Promise<{ days?: string }> }
) {
  const sp = await searchParams
  const marginDays = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30
```

Consulta e agregação (após as consultas existentes):

```ts
  const { data: marginSales } = await db.from('sales')
    .select(`product_id, gross_price, cancellation, quantity, uf_destino,
      marketplace_commission, marketplace_shipping_fee, marketplace_fixed_fee, rebate,
      sale_taxes(id), sale_costs(total_cost, margin_value),
      products(id, name, sku, stock_qty, stock_full)`)
    .gte('sale_date', format(subDays(now, marginDays - 1), 'yyyy-MM-dd'))
    .not('product_id', 'is', null)
    .limit(5000)

  const byProduct = new Map<string, any>()
  for (const s of marginSales ?? []) {
    const p = uw(s.products) as any
    if (!p) continue
    const c = uw(s.sale_costs) as any
    const hasTaxes = !!uw(s.sale_taxes)
    const g = Number(s.gross_price) - Number(s.cancellation ?? 0)
    let row = byProduct.get(p.id)
    if (!row) {
      row = { productId: p.id, name: p.name, sku: p.sku, units: 0, revenue: 0, cost: 0,
              fees: 0, marginValue: 0, marginRevenue: 0, inCalc: 0,
              stock: Number(p.stock_qty ?? 0) + Number(p.stock_full ?? 0),
              ufs: new Map<string, { units: number; mv: number; mg: number }>() }
      byProduct.set(p.id, row)
    }
    row.units   += Number(s.quantity)
    row.revenue += g
    row.cost    += Number(c?.total_cost ?? 0)
    row.fees    += Number(s.marketplace_commission ?? 0) + Number(s.marketplace_shipping_fee ?? 0)
                 + Number(s.marketplace_fixed_fee ?? 0) - Number(s.rebate ?? 0)
    const uf = s.uf_destino || 'não informado'
    if (!row.ufs.has(uf)) row.ufs.set(uf, { units: 0, mv: 0, mg: 0 })
    const u = row.ufs.get(uf)
    u.units += Number(s.quantity)
    if (hasTaxes && c?.margin_value !== null && c?.margin_value !== undefined) {
      row.marginValue   += Number(c.margin_value)
      row.marginRevenue += g
      u.mv += Number(c.margin_value); u.mg += g
    } else row.inCalc++
  }
  const marginRows = [...byProduct.values()].map(r => ({
    productId: r.productId, name: r.name, sku: r.sku, units: r.units,
    revenue: r.revenue, cost: r.cost, fees: r.fees,
    marginValue: r.marginValue, marginRevenue: r.marginRevenue, inCalc: r.inCalc,
    velocityDay: r.units / marginDays,
    coverageDays: r.units > 0 ? r.stock / (r.units / marginDays) : null,
    byUf: [...r.ufs.entries()]
      .map(([uf, u]: [string, any]) => ({
        uf, units: u.units, marginPct: u.mg > 0 ? (u.mv / u.mg) * 100 : null }))
      .sort((a, b) => b.units - a.units),
  })).sort((a, b) => b.revenue - a.revenue)
```

Renderizar `<MarginByProductTable rows={marginRows} days={marginDays} />` entre o bloco de taxas e os gráficos.

- [ ] **Step 2: Componente client** — `'use client'`; estados `search`, `sortKey` (default `revenue`), `sortDir`, `expanded: Set<string>`. Filtro de período são LINKS (`<Link href={`/dashboard?days=${d}`}>` para 7/30/90 — recarrega o server component; chips com o ativo em `#125BFF`). Busca filtra `name/sku` client-side. Colunas: Produto · Un · Faturamento · Custo · Taxas · Margem R$ · Margem % média · Vel/dia · Cobertura. Margem % média = `marginValue / marginRevenue * 100`; se `marginRevenue === 0` mostrar "em cálculo" cinza. Badge `inCalc > 0`: "+N em cálculo". Clique na linha alterna expansão; expandido mostra a lista de UF: `SP · 38% das vendas · margem 24,1%` (margem `—` quando `marginPct === null`). Cobertura com badge: `< 30d` vermelho, `< 60d` âmbar, senão neutro (copiar o padrão de `components/produtos/ProductsTable.tsx`).

- [ ] **Step 3: `npx tsc --noEmit`, commit**

```bash
git add components/dashboard/MarginByProductTable.tsx app/dashboard/page.tsx
git commit -m "Visão Geral: margem média por produto com filtro de período e abertura por estado"
```

---

### Task 6: Painel "Vistoria de taxas" na Visão Geral

**Files:**
- Create: `components/dashboard/FeeAuditPanel.tsx` (server, mesmo padrão do AuditAlertsPanel)
- Modify: `components/dashboard/AuditAlertsPanel.tsx` (excluir as regras de fee do painel genérico)
- Modify: `app/dashboard/page.tsx` (renderizar `<FeeAuditPanel />` na seção de alertas)

**Interfaces:**
- Consumes: `audit_findings` com `rule in (comissao_acima_tabela, tarifa_fixa_divergente, frete_fora_padrao)` + `details`.
- Produces: `export async function FeeAuditPanel()`.

- [ ] **Step 1: Criar o painel**

```tsx
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { Scale } from 'lucide-react'

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
    .select('rule, severity, message, details')
    .in('rule', Object.keys(FEE_RULE_LABELS))
    .order('detected_at', { ascending: false })
    .limit(500)

  const total = (findings ?? []).reduce((s, f) => s + Number((f.details as any)?.diff ?? 0), 0)

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="flex items-center gap-2 mb-3">
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
        /* mesmo <details> agrupado por regra do AuditAlertsPanel, com FEE_RULE_LABELS */
        null
      )}
    </div>
  )
}
```

(O bloco do `else` repete a estrutura de agrupamento do `AuditAlertsPanel.tsx:34-71`, trocando `RULE_LABELS` por `FEE_RULE_LABELS` — copiar o JSX de lá.)

- [ ] **Step 2: Excluir as regras de fee do painel genérico** — em `AuditAlertsPanel.tsx`, adicionar ao select: `.not('rule', 'in', '("comissao_acima_tabela","tarifa_fixa_divergente","frete_fora_padrao")')`.

- [ ] **Step 3: Renderizar `<FeeAuditPanel />`** em `page.tsx` imediatamente após `<AuditAlertsPanel />`.

- [ ] **Step 4: `npx tsc --noEmit`, commit**

```bash
git add components/dashboard/FeeAuditPanel.tsx components/dashboard/AuditAlertsPanel.tsx app/dashboard/page.tsx
git commit -m "Visão Geral: painel de vistoria de taxas com total cobrado a mais"
```

---

### Task 7: Vistoria no ciclo diário, no cron e no botão

**Files:**
- Modify: `C:\Users\bruno.vinhas\AppData\Local\Temp\claude\C--Users-bruno-vinhas-Documents-Claude\ec348804-9de9-42e4-a8ac-713e61b4aede\scratchpad\catchup.py` (etapa 12, após a auditoria)
- Modify: `app/api/cron/sync/route.ts` (chamada após audit)
- Modify: `components/configuracoes/MarketplaceSyncButton.tsx` (etapa extra no fluxo completo)

**Interfaces:**
- Consumes: rota da Task 3 (`POST /api/audit/fees {days, limit, skip}` → `remaining_items`).

- [ ] **Step 1: catchup.py** — copiar o padrão do loop fatiado existente (invoices/shipping):

```python
# 12. vistoria de taxas (fatiada por anuncio)
skip = 0
while True:
    r = call("POST", "/api/audit/fees", {"days": 30, "limit": 25, "skip": skip})
    log(f"fees: skip={skip} items={r.get('processed_items')} achados={r.get('achados')} rest={r.get('remaining_items')}")
    if not r.get("ok") or r.get("remaining_items", 0) <= 0: break
    skip += 25
```

- [ ] **Step 2: cron/sync** — na cadeia existente, após a chamada de `/api/audit/sales`, adicionar chamada idêntica às demais internas: `POST /api/audit/fees` body `{days: 30, limit: 25, skip: 0}` (uma fatia só no cron; o resto o ciclo diário cobre).

- [ ] **Step 3: MarketplaceSyncButton** — no `handleFullSync`, após a etapa de auditoria, acrescentar ao array de etapas (ou chamada equivalente ao padrão que o botão usa):

```ts
      // 8. Vistoria de taxas (fatiada por anúncio)
      setProgress('Etapa 8/8 — Vistoria de taxas vs tabela oficial…')
      for (let skip = 0; skip < 400; skip += 25) {
        const r = await fetch('/api/audit/fees', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: 4, limit: 25, skip }),
        }).then(x => x.ok ? x.json() : null).catch(() => null)
        if (!r?.ok || (r.remaining_items ?? 0) <= 0) break
      }
```

(Ajustar números de etapa "N/N" nas mensagens existentes do botão.)

- [ ] **Step 4: `npx tsc --noEmit`, commit + push**

```bash
git add app/api/cron/sync/route.ts components/configuracoes/MarketplaceSyncButton.tsx
git commit -m "Vistoria de taxas no ciclo diário, no cron e na sincronização completa"
git push
```

---

### Task 8: Deploy, backfill e validação gabarito

**Files:**
- Create: script descartável no scratchpad da sessão (`fees_backfill.py`)

- [ ] **Step 1: Aguardar deploy do Vercel** (push da Task 7) — conferir `https://www.oryma.com.br` respondendo.

- [ ] **Step 2: Backfill 30 dias** — script Python no scratchpad, mesmo esqueleto dos scripts anteriores (lê `.env.local`, chama produção com cookie `mi_auth`), loop `skip += 25` até `remaining_items == 0`, imprimindo `achados` por fatia.

- [ ] **Step 3: Gabarito** — pegar 1 venda conhecida (ex.: a venda 2000017571660014 usada nos gabaritos anteriores), calcular na mão: `comissão+fixa cobradas` vs `listing_prices` para o anúncio/preço, conferir que a rota chegou no mesmo número (com ou sem finding, coerente). Imprimir no script: cobrado, esperado, diff, houve_finding.

- [ ] **Step 4: Conferir a Visão Geral em produção** — bloco de taxas com números coerentes com a página de Vendas; tabela de margem ordenando e expandindo UF; painel de vistoria exibindo (ou "nenhuma divergência").

- [ ] **Step 5: Relatar ao Bruno** — total de divergências por regra e o total estimado cobrado a mais.
