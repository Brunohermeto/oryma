'use client'
import { useState } from 'react'
import { Link2, CheckCircle, XCircle, Search, RefreshCw } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

interface SuggestedMatch {
  product_id: string; sku: string; name: string
  cmp_value: number; effective_date: string; source: string
}
interface ProductRow {
  product_id: string; sku: string; name: string
  sales_count: number; marketplaces: string[]
  suggested_match: SuggestedMatch | null
  no_match_reason: string | null
}
interface DiagResult {
  summary: { total_products_with_sales: number; products_with_cmp: number; products_WITHOUT_cmp: number; resolved: number; no_match_found: number }
  products_without_cmp: ProductRow[]
}

const SOURCE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  manual:         { label: 'Manual',    color: '#1e40af', bg: 'oklch(0.95 0.04 258)' },
  suffix_strip:   { label: 'Variante',  color: '#14532d', bg: 'oklch(0.96 0.06 145)' },
}
function sourceStyle(src: string) {
  if (SOURCE_LABEL[src]) return SOURCE_LABEL[src]
  if (src.startsWith('name_similarity')) return { label: `Similaridade`, color: '#713f12', bg: 'oklch(0.97 0.07 85)' }
  return { label: src, color: B.muted, bg: B.bg }
}

export function FixProductLinksButton() {
  const [diagStatus, setDiagStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [diagData,   setDiagData]   = useState<DiagResult | null>(null)
  const [confirmed,  setConfirmed]  = useState<Record<string, string>>({})
  const [fixStatus,  setFixStatus]  = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [fixResult,  setFixResult]  = useState('')
  const [fixLog,     setFixLog]     = useState<string[]>([])

  async function handleDiag() {
    setDiagStatus('running')
    setDiagData(null); setConfirmed({}); setFixStatus('idle'); setFixResult(''); setFixLog([])
    try {
      const res  = await fetch('/api/debug/products-without-cmp')
      const data = await res.json() as DiagResult
      if (!res.ok) { setDiagStatus('error'); return }
      setDiagData(data)
      setDiagStatus('done')
      // Pré-seleciona todos os que têm sugestão
      const pre: Record<string, string> = {}
      for (const p of data.products_without_cmp)
        if (p.suggested_match) pre[p.sku] = p.suggested_match.sku
      setConfirmed(pre)
    } catch { setDiagStatus('error') }
  }

  function toggleConfirm(mlSku: string, blingSku: string) {
    setConfirmed(prev => {
      if (prev[mlSku] === blingSku) { const n = { ...prev }; delete n[mlSku]; return n }
      return { ...prev, [mlSku]: blingSku }
    })
  }

  async function handleFix() {
    if (!Object.keys(confirmed).length) return
    setFixStatus('running'); setFixResult(''); setFixLog([])
    try {
      const res = await fetch('/api/debug/fix-product-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: confirmed }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setFixResult(`Erro: ${data.error ?? 'falha'}`); setFixStatus('error'); return }
      setFixResult(data.message); setFixLog(data.log ?? []); setFixStatus('done')
    } catch (err) { setFixResult(`Erro: ${String(err)}`); setFixStatus('error') }
  }

  const confirmedCount = Object.keys(confirmed).length

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Mapear Variantes de Produto (SKU ML ↔ Produto com CMV)
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Vincula variantes de cor/modelo do ML (ex: RAGA003-C) ao produto base
        que tem NF-e de entrada importada (RAGA003). Aplica o mesmo CMV para todas as variantes.
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
        {diagStatus === 'running' ? 'Analisando…' : diagData ? 'Reanalisar' : 'Diagnosticar'}
      </button>

      {diagData && (
        <div className="mt-4">
          {diagData.summary.products_WITHOUT_cmp === 0 ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: '#16a34a' }}>
              <CheckCircle size={14} /> Todos os produtos com vendas já têm CMV.
            </div>
          ) : (
            <>
              {/* Resumo numérico */}
              <div className="flex flex-wrap gap-3 mb-4">
                {[
                  { label: 'Sem CMV', value: diagData.summary.products_WITHOUT_cmp, color: '#dc2626' },
                  { label: 'Resolvidos', value: diagData.summary.resolved, color: '#16a34a' },
                  { label: 'Sem match', value: diagData.summary.no_match_found, color: '#d97706' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg px-3 py-2 text-center" style={{ background: B.bg, border: `1px solid ${B.border}`, minWidth: 80 }}>
                    <div className="text-[18px] font-bold" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[10px]" style={{ color: B.muted }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Tabela */}
              <div className="rounded-lg overflow-hidden mb-4" style={{ border: `1px solid ${B.border}` }}>
                <div className="grid grid-cols-12 px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: B.bg, color: B.muted }}>
                  <span className="col-span-2">SKU ML</span>
                  <span className="col-span-1 text-center">Vendas</span>
                  <span className="col-span-3">Produto base (com CMV)</span>
                  <span className="col-span-2 text-center">CMV</span>
                  <span className="col-span-2 text-center">Como</span>
                  <span className="col-span-2 text-center">Aplicar</span>
                </div>

                {diagData.products_without_cmp.map((p, i) => {
                  const isOn = p.suggested_match ? confirmed[p.sku] === p.suggested_match.sku : false
                  const ss = p.suggested_match ? sourceStyle(p.suggested_match.source) : null

                  return (
                    <div key={p.product_id}
                      className="grid grid-cols-12 px-3 py-2.5 items-center text-[12px]"
                      style={{ borderTop: i > 0 ? `1px solid ${B.border}` : undefined, background: isOn ? 'oklch(0.98 0.03 145)' : 'white' }}
                    >
                      <div className="col-span-2">
                        <div className="font-mono font-semibold text-[11px] text-blue-600 truncate">{p.sku}</div>
                        <div className="text-[10px] truncate" style={{ color: B.muted }}>{p.name.slice(0, 40)}</div>
                      </div>

                      <div className="col-span-1 text-center font-semibold text-[13px]" style={{ color: '#dc2626' }}>
                        {p.sales_count}
                      </div>

                      <div className="col-span-3">
                        {p.suggested_match ? (
                          <>
                            <div className="font-mono font-semibold text-[11px]">{p.suggested_match.sku}</div>
                            <div className="text-[10px] truncate" style={{ color: B.muted }}>{p.suggested_match.name.slice(0, 35)}</div>
                          </>
                        ) : (
                          <span className="text-[11px] italic" style={{ color: '#d97706' }}>
                            {p.no_match_reason ?? 'sem match'}
                          </span>
                        )}
                      </div>

                      <div className="col-span-2 text-center font-medium text-[11px]" style={{ color: '#0B1023' }}>
                        {p.suggested_match ? `R$ ${p.suggested_match.cmp_value.toFixed(2)}` : '—'}
                      </div>

                      <div className="col-span-2 flex justify-center">
                        {ss ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: ss.bg, color: ss.color }}>
                            {ss.label}
                          </span>
                        ) : <span style={{ color: B.muted }}>—</span>}
                      </div>

                      <div className="col-span-2 flex justify-center">
                        {p.suggested_match ? (
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => toggleConfirm(p.sku, p.suggested_match!.sku)}
                              className="w-3.5 h-3.5 accent-blue-600"
                            />
                            <span className="text-[10px]" style={{ color: B.muted }}>{isOn ? 'OK' : 'confirmar'}</span>
                          </label>
                        ) : <span className="text-[10px]" style={{ color: B.muted }}>—</span>}
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
                    : <><Link2 size={13} /> Aplicar {confirmedCount > 0 ? `${confirmedCount}` : ''} mapeamento(s) e recalcular CMV</>
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
                  <summary className="text-[11px] cursor-pointer" style={{ color: B.muted }}>Ver log detalhado</summary>
                  <div className="mt-1 rounded-lg p-3 font-mono text-[11px] space-y-0.5" style={{ background: B.bg, color: B.muted }}>
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
