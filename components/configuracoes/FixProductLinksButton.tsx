'use client'
import { useState } from 'react'
import { Link2, CheckCircle, XCircle, Search, RefreshCw, AlertCircle } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

interface BlingInfo { codigo: string; nome: string; gtin: string | null }

interface SuggestedMatch {
  product_id: string
  sku: string
  name: string
  cmp_value: number
  effective_date: string
  source: string
}

interface ProductWithoutCmp {
  product_id: string
  sku: string
  name: string
  sales_count: number
  marketplaces: string[]
  bling: BlingInfo | null
  suggested_match: SuggestedMatch | null
  ean_found_in_bling_but_no_local_product: string | null
  ean_found_but_no_cmp: string | null
}

interface DiagResult {
  summary: {
    total_products_with_sales: number
    products_with_cmp: number
    products_WITHOUT_cmp: number
    resolved_via_bling: number
    ean_found_no_local_product: number
    not_found_in_bling: number
  }
  products_without_cmp: ProductWithoutCmp[]
  bling_catalog_size: number
  bling_error: string | null
}

export function FixProductLinksButton() {
  const [diagStatus, setDiagStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [diagData,   setDiagData]   = useState<DiagResult | null>(null)

  // Mapeamento confirmado: mlSku → blingSku (EAN)
  const [confirmed, setConfirmed] = useState<Record<string, string>>({})

  const [fixStatus, setFixStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [fixResult, setFixResult] = useState('')
  const [fixLog,    setFixLog]    = useState<string[]>([])

  async function handleDiag() {
    setDiagStatus('running')
    setDiagData(null)
    setConfirmed({})
    setFixStatus('idle')
    setFixResult('')
    setFixLog([])
    try {
      const res  = await fetch('/api/debug/products-without-cmp')
      const data = await res.json() as DiagResult
      if (!res.ok) { setDiagStatus('error'); return }
      setDiagData(data)
      setDiagStatus('done')
      // Pré-seleciona todos os que têm match via catálogo Bling
      const preSelected: Record<string, string> = {}
      for (const p of data.products_without_cmp) {
        if (p.suggested_match) {
          preSelected[p.sku] = p.suggested_match.sku
        }
      }
      setConfirmed(preSelected)
    } catch {
      setDiagStatus('error')
    }
  }

  function toggleConfirm(mlSku: string, blingSku: string) {
    setConfirmed(prev => {
      if (prev[mlSku] === blingSku) {
        const next = { ...prev }; delete next[mlSku]; return next
      }
      return { ...prev, [mlSku]: blingSku }
    })
  }

  async function handleFix() {
    if (Object.keys(confirmed).length === 0) return
    setFixStatus('running')
    setFixResult('')
    setFixLog([])
    try {
      const res  = await fetch('/api/debug/fix-product-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: confirmed }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setFixResult(`Erro: ${data.error ?? 'falha'}`)
        setFixStatus('error')
        return
      }
      setFixResult(data.message)
      setFixLog(data.log ?? [])
      setFixStatus('done')
    } catch (err) {
      setFixResult(`Erro: ${String(err)}`)
      setFixStatus('error')
    }
  }

  const confirmedCount = Object.keys(confirmed).length

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Mapear Produtos: SKU ML ↔ EAN Bling
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Busca o catálogo do Bling para encontrar o EAN de cada produto vendido no ML.
        Isso garante que o CMV seja calculado corretamente para todos os produtos.
      </p>

      <button
        onClick={handleDiag}
        disabled={diagStatus === 'running'}
        className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
        style={{
          background: 'white', color: diagStatus === 'running' ? B.muted : B.brand,
          border: `1px solid ${diagStatus === 'running' ? B.border : B.brand}`,
          cursor: diagStatus === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        <Search size={13} className={diagStatus === 'running' ? 'animate-pulse' : ''} />
        {diagStatus === 'running' ? 'Consultando Bling…' : diagData ? 'Reanalisar' : 'Diagnosticar via Bling'}
      </button>

      {diagData?.bling_error && (
        <div className="mt-3 flex items-start gap-2 text-[12px] rounded-lg px-3 py-2.5"
          style={{ background: 'oklch(0.97 0.03 25)', border: '1px solid oklch(0.88 0.06 25)', color: '#991b1b' }}>
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span>Erro ao consultar Bling: {diagData.bling_error}</span>
        </div>
      )}

      {diagData && !diagData.bling_error && (
        <div className="mt-4">
          {/* Resumo */}
          <div className="flex flex-wrap gap-3 mb-4">
            {[
              { label: 'Catálogo Bling', value: diagData.bling_catalog_size, color: '#0B1023' },
              { label: 'Resolvidos', value: diagData.summary.resolved_via_bling, color: '#16a34a' },
              { label: 'EAN sem NF-e importada', value: diagData.summary.ean_found_no_local_product, color: '#d97706' },
              { label: 'Não encontrado no Bling', value: diagData.summary.not_found_in_bling, color: '#dc2626' },
            ].map(s => (
              <div key={s.label} className="rounded-lg px-3 py-2 text-center" style={{ background: B.bg, border: `1px solid ${B.border}`, minWidth: 80 }}>
                <div className="text-[18px] font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px]" style={{ color: B.muted }}>{s.label}</div>
              </div>
            ))}
          </div>

          {diagData.summary.products_WITHOUT_cmp === 0 ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: '#16a34a' }}>
              <CheckCircle size={14} /> Todos os produtos com vendas já têm CMP.
            </div>
          ) : (
            <>
              {/* Tabela */}
              <div className="rounded-lg overflow-hidden mb-4" style={{ border: `1px solid ${B.border}` }}>
                {/* Header */}
                <div className="grid grid-cols-12 px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: B.bg, color: B.muted }}>
                  <span className="col-span-2">SKU ML</span>
                  <span className="col-span-1 text-center">Vendas</span>
                  <span className="col-span-1 text-center">EAN Bling</span>
                  <span className="col-span-4">Produto com CMP</span>
                  <span className="col-span-2 text-center">CMP</span>
                  <span className="col-span-2 text-center">Aplicar</span>
                </div>

                {diagData.products_without_cmp.map((p, i) => {
                  const isConfirmed = p.suggested_match ? confirmed[p.sku] === p.suggested_match.sku : false
                  const rowBg = isConfirmed ? 'oklch(0.98 0.03 145)' : 'white'

                  return (
                    <div key={p.product_id} className="grid grid-cols-12 px-3 py-2.5 items-center text-[12px] gap-1"
                      style={{ borderTop: i > 0 ? `1px solid ${B.border}` : undefined, background: rowBg }}>

                      {/* SKU ML */}
                      <div className="col-span-2">
                        <div className="font-mono font-semibold text-[11px] text-blue-600">{p.sku}</div>
                        <div className="text-[10px] truncate" style={{ color: B.muted }}>{p.name}</div>
                      </div>

                      {/* Qtd vendas */}
                      <div className="col-span-1 text-center font-semibold" style={{ color: '#dc2626' }}>
                        {p.sales_count}
                      </div>

                      {/* EAN Bling */}
                      <div className="col-span-1 text-center font-mono text-[10px]" style={{ color: B.muted }}>
                        {p.bling?.gtin
                          ? <span style={{ color: '#16a34a' }}>✓</span>
                          : p.bling
                          ? <span style={{ color: '#d97706' }}>sem EAN</span>
                          : <span style={{ color: '#dc2626' }}>não encontrado</span>
                        }
                      </div>

                      {/* Produto com CMP */}
                      <div className="col-span-4">
                        {p.suggested_match ? (
                          <>
                            <div className="font-mono font-semibold text-[11px]" style={{ color: '#0B1023' }}>
                              {p.suggested_match.sku}
                            </div>
                            <div className="text-[10px] truncate" style={{ color: B.muted }}>
                              {p.suggested_match.name}
                            </div>
                          </>
                        ) : p.ean_found_in_bling_but_no_local_product ? (
                          <span className="text-[10px]" style={{ color: '#d97706' }}>
                            EAN {p.ean_found_in_bling_but_no_local_product} — importe a NF-e de entrada
                          </span>
                        ) : p.ean_found_but_no_cmp ? (
                          <span className="text-[10px]" style={{ color: '#d97706' }}>
                            Produto encontrado mas sem CMP ainda
                          </span>
                        ) : (
                          <span className="text-[10px] italic" style={{ color: B.muted }}>
                            {p.bling ? 'produto Bling sem EAN cadastrado' : 'SKU não encontrado no Bling'}
                          </span>
                        )}
                      </div>

                      {/* CMP */}
                      <div className="col-span-2 text-center text-[11px] font-medium" style={{ color: '#0B1023' }}>
                        {p.suggested_match ? `R$ ${p.suggested_match.cmp_value.toFixed(2)}` : '—'}
                      </div>

                      {/* Checkbox */}
                      <div className="col-span-2 flex items-center justify-center">
                        {p.suggested_match ? (
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isConfirmed}
                              onChange={() => toggleConfirm(p.sku, p.suggested_match!.sku)}
                              className="w-3.5 h-3.5 accent-blue-600"
                            />
                            <span className="text-[10px]" style={{ color: B.muted }}>
                              {isConfirmed ? 'OK' : 'confirmar'}
                            </span>
                          </label>
                        ) : (
                          <span className="text-[10px]" style={{ color: B.muted }}>—</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Botão Aplicar */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleFix}
                  disabled={fixStatus === 'running' || confirmedCount === 0}
                  className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
                  style={{
                    background: confirmedCount === 0 || fixStatus === 'running' ? B.bg : B.brand,
                    color:      confirmedCount === 0 || fixStatus === 'running' ? B.muted : 'white',
                    border:     confirmedCount === 0 || fixStatus === 'running' ? `1px solid ${B.border}` : 'none',
                    cursor:     confirmedCount === 0 || fixStatus === 'running' ? 'not-allowed' : 'pointer',
                  }}
                >
                  {fixStatus === 'running'
                    ? <><RefreshCw size={13} className="animate-spin" /> Aplicando…</>
                    : <><Link2 size={13} /> Aplicar {confirmedCount > 0 ? `${confirmedCount} mapeamento(s)` : 'mapeamentos'}</>
                  }
                </button>

                {fixStatus === 'done' && (
                  <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
                    <CheckCircle size={13} /> {fixResult}
                  </span>
                )}
                {fixStatus === 'error' && (
                  <span className="flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
                    <XCircle size={13} /> {fixResult}
                  </span>
                )}
              </div>

              {fixLog.length > 0 && (
                <details className="mt-3">
                  <summary className="text-[11px] cursor-pointer" style={{ color: B.muted }}>
                    Ver log detalhado
                  </summary>
                  <div className="mt-1 rounded-lg p-3 font-mono text-[11px] space-y-0.5"
                    style={{ background: B.bg, color: B.muted }}>
                    {fixLog.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
