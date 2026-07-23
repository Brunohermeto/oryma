'use client'
import { Fragment, useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Receipt, Package, Truck } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  subtle:   'oklch(0.40 0.020 258)',
  brand:    '#125BFF',
  violeta:  '#7B61FF',
}

const MP_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon',
}
const MP_BADGE: Record<string, { bg: string; color: string }> = {
  mercado_livre: { bg: 'oklch(0.94 0.06 258)', color: '#125BFF' },
  shopee:        { bg: 'oklch(0.94 0.08 280)', color: '#7B61FF' },
  amazon:        { bg: 'oklch(0.94 0.08 204)', color: '#0097b2' },
}
const FULFILLMENT_LABELS: Record<string, string> = {
  galpao: 'Galpão', full_ml: 'Full ML', fba_amazon: 'FBA',
}

function fmtR(v: number) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}
function fmtPct(v: number) {
  return `${(Number(v) * 100).toFixed(1)}%`
}
function marginColor(m: number | null) {
  if (m === null) return B.muted
  if (m >= 0.35) return '#16a34a'
  if (m >= 0.20) return '#d97706'
  return '#dc2626'
}

export interface SaleRow {
  id: string
  external_order_id: string
  marketplace: string
  fulfillment_type: string
  sku: string | null
  sale_date: string
  quantity: number
  gross_price: number
  shipping_received: number
  marketplace_commission: number
  marketplace_shipping_fee: number
  ads_cost: number
  cancellation: number
  discounts: number
  rebate?: number
  uf_destino?: string | null
  nfe_saida_key?: string | null
  products: { name: string; sku: string; id?: string } | null
  sale_taxes: { pis: number; cofins: number; icms: number; icms_difal: number; ipi: number; total_taxes: number; nfe_key?: string } | null
  sale_costs: { unit_cost_applied: number; total_cost: number; margin_value: number | null; margin_pct: number | null } | null
}

interface CostDetail {
  fob_unit: number; ii_unit: number; ipi_unit: number
  icms_gnre_unit: number; additional_unit: number; total_unit_cost: number
  pis_credit_unit: number; cofins_credit_unit: number
  pis_credit_total: number; cofins_credit_total: number
  batch: { nfe_number?: string; issue_date?: string; supplier?: string } | null
}

function SaleDetailPanel({ sale }: { sale: SaleRow }) {
  const taxes    = sale.sale_taxes
  const cost     = sale.sale_costs
  const product  = sale.products

  // Lazy-load do breakdown de custos e créditos fiscais
  const [costDetail, setCostDetail] = useState<CostDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    if (!cost || costDetail || loadingDetail) return
    setLoadingDetail(true)
    fetch(`/api/sales/${sale.id}/cost-detail`)
      .then(r => r.json())
      .then(d => { if (d.cost_detail) setCostDetail(d.cost_detail) })
      .catch(() => {})
      .finally(() => setLoadingDetail(false))
  }, [sale.id, cost, costDetail, loadingDetail])

  const faturamento    = Number(sale.gross_price) - Number(sale.cancellation) - Number(sale.discounts ?? 0)
  const freteRecebido  = Number(sale.shipping_received ?? 0)
  const fretePago      = Number(sale.marketplace_shipping_fee ?? 0)
  const freteNeto      = freteRecebido - fretePago
  const totalTaxes     = Number(taxes?.total_taxes ?? 0)
  const commission     = Number(sale.marketplace_commission)
  const adsC           = Number(sale.ads_cost)
  const rebate         = Number(sale.rebate ?? 0)
  const cmv            = Number(cost?.total_cost ?? 0)

  // Créditos de importação (PIS/COFINS pagos na importação — recuperados como crédito)
  const pisCredito     = costDetail?.pis_credit_total   ?? 0
  const cofinsCredito  = costDetail?.cofins_credit_total ?? 0
  const totalCreditos  = pisCredito + cofinsCredito

  // Impostos líquidos = impostos s/ venda − créditos de importação
  const impostoLiquido = Math.max(0, totalTaxes - totalCreditos)

  const fixedFee = Number((sale as any).marketplace_fixed_fee ?? 0)

  // Lucro só com dados completos: sem NF-e (impostos) ou sem custo = "em cálculo",
  // nunca um número inflado
  const lucro = cost && taxes
    ? faturamento + freteNeto - impostoLiquido - commission - fixedFee - adsC + rebate - cmv
    : null

  // ── Avaliação de completude dos dados ───────────────────────────────────────
  const issues: string[] = []

  if (commission === 0 && rebate === 0)
    issues.push('Tarifas ainda não lançadas no extrato do ML (chegam em 1-2 dias)')

  if (sale.marketplace === 'mercado_livre' && sale.marketplace_shipping_fee === 0)
    issues.push('Frete do vendedor ainda não capturado')

  if (!taxes && sale.fulfillment_type === 'galpao')
    issues.push('Impostos s/ venda pendentes (NF-e de saída ainda não sincronizada)')

  const dataQuality: 'ok' | 'parcial' | 'incompleto' =
    issues.length === 0 ? 'ok' :
    issues.length >= 2 ? 'incompleto' :
    'parcial'

  const productId = (product as any)?.id ?? null
  const vendasUrl = productId ? `/dashboard/vendas?product=${productId}` : null

  return (
    <tr>
      <td colSpan={15} style={{ padding: 0, background: 'oklch(0.97 0.007 258)' }}>
        <div className="px-8 py-5" style={{ borderBottom: `1px solid ${B.border}` }}>
          <div className="grid grid-cols-4 gap-6">

            {/* NF-e Saída / Impostos */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Receipt size={13} style={{ color: B.brand }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: B.brand }}>
                  NF-e de Saída — Impostos
                </span>
              </div>
              {taxes ? (
                <div className="space-y-1.5">
                  {/* Impostos de saída */}
                  {[
                    { label: 'ICMS',           value: taxes.icms },
                    { label: 'DIFAL',          value: taxes.icms_difal },
                    { label: 'PIS (1,65%)',    value: taxes.pis },
                    { label: 'COFINS (7,60%)', value: taxes.cofins },
                    { label: 'IPI',            value: taxes.ipi },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span style={{ color: B.muted }}>{label}</span>
                      <span className="num font-medium" style={{ color: Number(value) > 0 ? '#dc2626' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                        {Number(value) > 0 ? `(${fmtR(Number(value))})` : '—'}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs pt-1" style={{ borderTop: `1px solid ${B.border}` }}>
                    <span style={{ color: B.muted }}>Subtotal impostos s/ venda</span>
                    <span className="num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>({fmtR(totalTaxes)})</span>
                  </div>
                  {/* Créditos de importação */}
                  {(pisCredito > 0 || cofinsCredito > 0) && <>
                    <div className="text-[10px] font-semibold uppercase tracking-wide mt-1.5" style={{ color: '#16a34a' }}>
                      Créditos de importação (Lucro Real)
                    </div>
                    {pisCredito > 0 && (
                      <div className="flex justify-between text-xs">
                        <span style={{ color: B.muted }}>PIS crédito import.</span>
                        <span className="num" style={{ color: '#16a34a', fontFamily: 'var(--font-geist-mono)' }}>+{fmtR(pisCredito)}</span>
                      </div>
                    )}
                    {cofinsCredito > 0 && (
                      <div className="flex justify-between text-xs">
                        <span style={{ color: B.muted }}>COFINS crédito import.</span>
                        <span className="num" style={{ color: '#16a34a', fontFamily: 'var(--font-geist-mono)' }}>+{fmtR(cofinsCredito)}</span>
                      </div>
                    )}
                  </>}
                  {/* Imposto líquido */}
                  <div className="flex justify-between text-xs pt-1.5 font-semibold" style={{ borderTop: `1px solid ${B.border}` }}>
                    <span style={{ color: B.subtle }}>Imposto líquido</span>
                    <span className="num font-bold" style={{ color: impostoLiquido > 0 ? '#dc2626' : '#16a34a', fontFamily: 'var(--font-geist-mono)' }}>
                      {impostoLiquido > 0 ? `(${fmtR(impostoLiquido)})` : '—'}
                    </span>
                  </div>
                  {taxes.nfe_key && (
                    <div className="text-[10px] mt-1 truncate" style={{ color: B.muted }}>
                      NF-e: {taxes.nfe_key.slice(0, 22)}…
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs space-y-1" style={{ color: B.muted }}>
                  <div>
                    {/* Full também tem NF-e (emitida via ML) — só demora algumas horas */}
                    NF-e ainda não emitida/vinculada — impostos em processamento
                  </div>
                  {(pisCredito > 0 || cofinsCredito > 0) && (
                    <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${B.border}` }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#16a34a' }}>
                        Créditos estimados (importação)
                      </div>
                      {pisCredito > 0 && <div className="flex justify-between mt-1"><span>PIS crédito</span><span className="num" style={{ color: '#16a34a', fontFamily: 'var(--font-geist-mono)' }}>+{fmtR(pisCredito)}</span></div>}
                      {cofinsCredito > 0 && <div className="flex justify-between"><span>COFINS crédito</span><span className="num" style={{ color: '#16a34a', fontFamily: 'var(--font-geist-mono)' }}>+{fmtR(cofinsCredito)}</span></div>}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Frete detalhado */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Truck size={13} style={{ color: '#0097b2' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#0097b2' }}>
                  Frete & Rebate
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: B.muted }}>Frete cobrado do comprador</span>
                  <span className="num font-medium" style={{ color: freteRecebido > 0 ? '#16a34a' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                    {freteRecebido > 0 ? `+${fmtR(freteRecebido)}` : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: B.muted }}>Frete pago ao canal / transportadora</span>
                  <span className="num font-medium" style={{ color: fretePago > 0 ? '#dc2626' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                    {fretePago > 0 ? `(${fmtR(fretePago)})` : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-xs pt-1.5" style={{ borderTop: `1px solid ${B.border}` }}>
                  <span className="font-semibold" style={{ color: B.subtle }}>Frete líquido</span>
                  <span className="num font-bold" style={{ color: freteNeto >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                    {freteNeto >= 0 ? `+${fmtR(freteNeto)}` : `(${fmtR(Math.abs(freteNeto))})`}
                  </span>
                </div>
                {rebate > 0 && (
                  <div className="flex justify-between text-xs pt-1.5" style={{ borderTop: `1px solid ${B.border}` }}>
                    <span style={{ color: B.muted }}>Rebate recebido</span>
                    <span className="num font-semibold" style={{ color: '#16a34a', fontFamily: 'var(--font-geist-mono)' }}>
                      +{fmtR(rebate)}
                    </span>
                  </div>
                )}
                {sale.discounts > 0 && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: B.muted }}>Desconto / cupom</span>
                    <span className="num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                      ({fmtR(Number(sale.discounts))})
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span style={{ color: B.muted }}>Comissão marketplace</span>
                  <span className="num" style={{ color: commission > 0 ? '#dc2626' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                    {commission > 0 ? `(${fmtR(commission)})` : '—'}
                  </span>
                </div>
                {adsC > 0 && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: B.muted }}>ADS</span>
                    <span className="num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>({fmtR(adsC)})</span>
                  </div>
                )}
              </div>
            </div>

            {/* Custo (CMV) */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Package size={13} style={{ color: B.violeta }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: B.violeta }}>
                  Custo do Produto (CMV)
                </span>
              </div>
              {cost ? (
                <div className="space-y-1.5">
                  {/* Breakdown do CMV por componente (quando disponível) */}
                  {costDetail ? (
                    <>
                      {costDetail.fob_unit > 0 && (
                        <div className="flex justify-between text-xs">
                          <span style={{ color: B.muted }}>Custo FOB</span>
                          <span className="num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                            ({fmtR(costDetail.fob_unit * Number(sale.quantity))})
                          </span>
                        </div>
                      )}
                      {costDetail.ii_unit > 0 && (
                        <div className="flex justify-between text-xs">
                          <span style={{ color: B.muted }}>II (imp. importação)</span>
                          <span className="num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                            ({fmtR(costDetail.ii_unit * Number(sale.quantity))})
                          </span>
                        </div>
                      )}
                      {costDetail.ipi_unit > 0 && (
                        <div className="flex justify-between text-xs">
                          <span style={{ color: B.muted }}>IPI</span>
                          <span className="num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                            ({fmtR(costDetail.ipi_unit * Number(sale.quantity))})
                          </span>
                        </div>
                      )}
                      {costDetail.icms_gnre_unit > 0 && (
                        <div className="flex justify-between text-xs">
                          <span style={{ color: B.muted }}>ICMS-GNRE</span>
                          <span className="num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                            ({fmtR(costDetail.icms_gnre_unit * Number(sale.quantity))})
                          </span>
                        </div>
                      )}
                      {costDetail.additional_unit > 0 && (
                        <div className="flex justify-between text-xs">
                          <span style={{ color: B.muted }}>Frete / outros rateados</span>
                          <span className="num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                            ({fmtR(costDetail.additional_unit * Number(sale.quantity))})
                          </span>
                        </div>
                      )}
                      {/* PIS/COFINS excluídos do CMV (já são créditos) */}
                      {(costDetail.pis_credit_unit > 0 || costDetail.cofins_credit_unit > 0) && (
                        <div className="text-[10px] pt-1" style={{ color: '#16a34a' }}>
                          PIS/COFINS imp. excluídos do CMV (viraram crédito)
                        </div>
                      )}
                    </>
                  ) : loadingDetail ? (
                    <div className="text-[10px]" style={{ color: B.muted }}>Carregando breakdown…</div>
                  ) : null}
                  <div className="flex justify-between text-xs pt-1.5 font-semibold" style={{ borderTop: `1px solid ${B.border}` }}>
                    <span style={{ color: B.subtle }}>CMV total ({Number(sale.quantity).toFixed(0)} un)</span>
                    <span className="num font-bold" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                      ({fmtR(cmv)})
                    </span>
                  </div>
                  {costDetail?.batch?.nfe_number && (
                    <div className="text-[10px]" style={{ color: B.muted }}>
                      NF-e {costDetail.batch.nfe_number} · {costDetail.batch.issue_date} · {costDetail.batch.supplier?.slice(0, 25)}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-1 pt-1.5" style={{ borderTop: `1px solid ${B.border}` }}>
                    <a href="/dashboard/importacoes" className="text-[11px] flex items-center gap-1 underline" style={{ color: B.violeta }}>
                      <ExternalLink size={10} /> Ver lotes de importação
                    </a>
                    {vendasUrl && (
                      <a href={vendasUrl} className="text-[11px] flex items-center gap-1 underline" style={{ color: B.brand }}>
                        <ExternalLink size={10} /> Filtrar este produto
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs" style={{ color: B.muted }}>
                  CMV não calculado.{' '}
                  <a href="/dashboard/importacoes" className="underline" style={{ color: B.brand }}>
                    Importar NF-e
                  </a>
                </div>
              )}
            </div>

            {/* P&L completo */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: B.muted }}>
                P&L da Venda
              </div>
              <div className="space-y-1.5">
                {[
                  { label: 'Faturamento bruto',          value: faturamento,   sign: 1 },
                  { label: '(+) Frete líquido',           value: freteNeto,     sign: freteNeto >= 0 ? 1 : -1 },
                  ...(rebate > 0 ? [{ label: '(+) Estorno / rebate', value: rebate, sign: 1 }] : []),
                  { label: totalCreditos > 0 ? '(-) Impostos líquidos s/ venda' : '(-) Impostos s/ vendas', value: -impostoLiquido, sign: -1 },
                  { label: '(-) Comissão marketplace',    value: -commission,  sign: -1 },
                  ...(fixedFee > 0 ? [{ label: '(-) Tarifa fixa / armazenagem', value: -fixedFee, sign: -1 }] : []),
                  ...(adsC > 0 ? [{ label: '(-) ADS',         value: -adsC,     sign: -1 }] : []),
                  { label: '(-) CMV (landed cost)',       value: -cmv,         sign: -1 },
                ].map(({ label, value, sign }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span style={{ color: B.muted }}>{label}</span>
                    <span className="num" style={{
                      color: value === 0 ? B.muted : sign > 0 ? B.subtle : '#dc2626',
                      fontFamily: 'var(--font-geist-mono)',
                    }}>
                      {value === 0 ? '—'
                        : sign > 0 ? fmtR(Math.abs(value))
                        : `(${fmtR(Math.abs(value))})`}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2" style={{ borderTop: `2px solid ${B.border}` }}>
                  <span className="text-xs font-bold" style={{ color: B.text }}>Lucro bruto</span>
                  <span className="num text-base font-bold" style={{
                    color: lucro === null ? B.muted : lucro >= 0 ? '#16a34a' : '#dc2626',
                    fontFamily: 'var(--font-geist-mono)',
                  }}>
                    {lucro !== null ? fmtR(lucro) : cost ? 'Em cálculo (aguarda NF-e)' : 'Sem custo'}
                  </span>
                </div>
                {cost?.margin_pct !== null && cost?.margin_pct !== undefined && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: B.muted }}>Margem</span>
                    <span className="num text-sm font-bold" style={{
                      color: marginColor(Number(cost.margin_pct)),
                      fontFamily: 'var(--font-geist-mono)',
                    }}>
                      {fmtPct(Number(cost.margin_pct))}
                    </span>
                  </div>
                )}

                {/* Avisos de completude dos dados */}
                {issues.length > 0 && (
                  <div className="mt-3 pt-2.5 space-y-1.5" style={{ borderTop: `1px solid ${B.border}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide flex items-center gap-1"
                      style={{ color: dataQuality === 'incompleto' ? '#dc2626' : '#d97706' }}>
                      {dataQuality === 'incompleto' ? '⚠ Dados incompletos' : '⚠ Dados parciais'}
                      {' — margem pode estar incorreta'}
                    </div>
                    {issues.map((issue, i) => (
                      <div key={i} className="text-[10px] flex items-start gap-1" style={{ color: B.muted }}>
                        <span style={{ flexShrink: 0 }}>•</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </td>
    </tr>
  )
}

export function SalesTable({ sales }: { sales: SaleRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function toggleRow(id: string) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr style={{ background: 'oklch(0.96 0.010 258)', borderBottom: `1px solid ${B.border}` }}>
          <th className="w-6 px-2 py-3" />
          {['Data','Produto','Canal','Qtd.','Preço unit.','Faturamento','Impostos','Comissão MP','Estorno','Frete líq.','ADS','Custo (CMV)','Lucro','Margem'].map((h, i) => (
            <th
              key={h}
              className={`py-3 text-[11px] font-semibold uppercase tracking-wide ${i < 3 ? 'text-left px-4' : 'text-right px-4'} ${i === 13 ? 'px-5' : ''}`}
              style={{ color: B.muted }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sales.length === 0 && (
          <tr>
            <td colSpan={15} className="px-5 py-10 text-center text-sm" style={{ color: B.muted }}>
              Nenhuma venda encontrada para os filtros selecionados.
            </td>
          </tr>
        )}
        {sales.map(sale => {
          const taxes         = sale.sale_taxes
          const cost          = sale.sale_costs
          const product       = sale.products
          const expanded      = expandedId === sale.id
          const totalTaxes    = Number(taxes?.total_taxes ?? 0)
          const commission    = Number(sale.marketplace_commission)
          const fretePago     = Number(sale.marketplace_shipping_fee ?? 0)
          const freteRecebido = Number(sale.shipping_received ?? 0)
          const freteNeto     = freteRecebido - fretePago
          const adsC          = Number(sale.ads_cost)
          const rebate        = Number(sale.rebate ?? 0)
          const faturamento   = Number(sale.gross_price) - Number(sale.cancellation) - Number(sale.discounts ?? 0)
          const cmv           = Number(cost?.total_cost ?? 0)
          const fixedFee      = Number((sale as any).marketplace_fixed_fee ?? 0)
          // lucro só com dados completos (custo E impostos) — igual ao painel
          const lucro         = cost && taxes
            ? faturamento + freteNeto - totalTaxes - commission - fixedFee - adsC + rebate - cmv
            : null
          const marginPct     = cost?.margin_pct !== null && cost?.margin_pct !== undefined ? Number(cost.margin_pct) : null
          const badge         = MP_BADGE[sale.marketplace] ?? { bg: B.bgSubtle, color: B.brand }

          // Indicador de completude dos dados
          const commissionPct = faturamento > 0 ? commission / faturamento : 0
          const rowIssues: string[] = []
          if (sale.marketplace === 'mercado_livre') {
            if (commission === 0 && rebate === 0) rowIssues.push('Tarifas: extrato do ML ainda não lançou (1-2 dias)')
            if (fretePago === 0) rowIssues.push('Frete do vendedor: ainda não capturado')
          }
          if (!taxes) rowIssues.push('Impostos: NF-e ainda não emitida/vinculada')
          if (!cost) rowIssues.push('CMV: produto sem custo cadastrado')

          const rowQuality = rowIssues.length === 0 ? 'ok'
            : rowIssues.some(i => i.startsWith('Comissão') && commission === 0) || !cost ? 'incompleto'
            : 'parcial'
          const qualityDot = rowQuality === 'ok'
            ? { color: '#16a34a', title: 'Dados completos' }
            : rowQuality === 'parcial'
            ? { color: '#d97706', title: `Dados parciais:\n${rowIssues.join('\n')}` }
            : { color: '#dc2626', title: `Dados incompletos:\n${rowIssues.join('\n')}` }

          return (
            <Fragment key={sale.id}>
              <tr
                className="transition-colors cursor-pointer"
                style={{
                  borderBottom: expanded ? 'none' : `1px solid ${B.bgSubtle}`,
                  background: expanded ? 'oklch(0.97 0.007 258)' : '',
                }}
                onClick={() => toggleRow(sale.id)}
                onMouseEnter={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = B.bgSubtle }}
                onMouseLeave={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = '' }}
              >
                <td className="px-2 py-2.5">
                  {expanded
                    ? <ChevronDown size={13} style={{ color: B.brand }} />
                    : <ChevronRight size={13} style={{ color: B.muted }} />}
                </td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: B.muted }}>{sale.sale_date}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-xs leading-tight" style={{ color: B.text }}>{product?.name ?? '—'}</div>
                  <div className="text-xs" style={{ color: B.muted }}>
                    {sale.sku} · {FULFILLMENT_LABELS[sale.fulfillment_type] ?? sale.fulfillment_type}
                    {sale.uf_destino && (
                      <span className="font-semibold" style={{ color: B.brand }}> · {sale.uf_destino}</span>
                    )}
                    {/* nNF e série vêm embutidos na chave de acesso (posições 25-34 e 22-25) */}
                    {sale.nfe_saida_key && sale.nfe_saida_key.length === 44 && (
                      <span> · NF {String(Number(sale.nfe_saida_key.slice(25, 34)))}/{String(Number(sale.nfe_saida_key.slice(22, 25)))}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>
                    {MP_LABELS[sale.marketplace] ?? sale.marketplace}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs" style={{ color: B.subtle }}>{Number(sale.quantity).toFixed(0)}</td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: B.subtle, fontFamily: 'var(--font-geist-mono)' }}>
                  {Number(sale.quantity) > 0 ? fmtR(faturamento / Number(sale.quantity)) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right font-medium num" style={{ color: B.text, fontFamily: 'var(--font-geist-mono)' }}>
                  {fmtR(faturamento)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {totalTaxes > 0 ? `(${fmtR(totalTaxes)})` : '—'}
                </td>
                {/* Comissão MP bruta (separada do frete) */}
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {commission > 0 ? `(${fmtR(commission)})` : '—'}
                </td>
                {/* Estorno / rebate (campanhas do canal — devolve parte da tarifa) */}
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: rebate > 0 ? '#16a34a' : B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                  {rebate > 0 ? `+${fmtR(rebate)}` : '—'}
                </td>
                {/* Frete líquido (recebido - pago) — verde se positivo, vermelho se negativo */}
                <td className="px-4 py-2.5 text-right text-xs num" style={{
                  color: freteNeto === 0 ? B.muted : freteNeto > 0 ? '#16a34a' : '#dc2626',
                  fontFamily: 'var(--font-geist-mono)',
                }}>
                  {freteNeto === 0 ? '—'
                    : freteNeto > 0 ? `+${fmtR(freteNeto)}`
                    : `(${fmtR(Math.abs(freteNeto))})`}
                </td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {adsC > 0 ? `(${fmtR(adsC)})` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-xs num" style={{ color: '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {cmv > 0 ? `(${fmtR(cmv)})` : <span style={{ color: B.muted }}>sem custo</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold num" style={{ color: lucro === null ? B.muted : lucro >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'var(--font-geist-mono)' }}>
                  {lucro !== null ? fmtR(lucro) : '—'}
                </td>
                <td className="px-5 py-2.5 text-right font-bold text-sm num" style={{ color: marginColor(marginPct), fontFamily: 'var(--font-geist-mono)' }}>
                  <span className="flex items-center justify-end gap-1.5">
                    {/* Indicador de completude — hover mostra o motivo */}
                    <span
                      title={qualityDot.title}
                      className="inline-block rounded-full flex-shrink-0"
                      style={{ width: 7, height: 7, background: qualityDot.color, cursor: 'help' }}
                    />
                    {marginPct !== null ? fmtPct(marginPct) : '—'}
                  </span>
                </td>
              </tr>
              {expanded && <SaleDetailPanel sale={sale} />}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
