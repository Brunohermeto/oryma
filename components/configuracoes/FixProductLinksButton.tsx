'use client'
import { useState } from 'react'
import { Link2, CheckCircle, XCircle, Search, RefreshCw } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

interface SuggestedMatch {
  product_id: string
  sku: string
  name: string
  cmp_value: number
  similarity_score: number
  confidence: 'alta' | 'média' | 'baixa'
}

interface ProductWithoutCmp {
  product_id: string
  sku: string
  name: string
  sales_count: number
  marketplaces: string[]
  suggested_match: SuggestedMatch | null
}

interface DiagResult {
  summary: {
    total_products_with_sales: number
    products_with_cmp: number
    products_WITHOUT_cmp: number
    with_suggestion: number
  }
  products_without_cmp: ProductWithoutCmp[]
}

const CONFIDENCE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  alta:  { bg: 'oklch(0.96 0.06 145)', text: '#14532d', label: 'Alta' },
  média: { bg: 'oklch(0.97 0.07 85)',  text: '#713f12', label: 'Média' },
  baixa: { bg: 'oklch(0.97 0.04 25)',  text: '#991b1b', label: 'Baixa' },
}

export function FixProductLinksButton() {
  const [diagStatus, setDiagStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [diagData,   setDiagData]   = useState<DiagResult | null>(null)

  // Mapeamento confirmado pelo usuário: mlSku → blingSku
  // Começa com todas as sugestões de confiança alta/média pré-selecionadas
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

      // Pré-seleciona sugestões de confiança alta e média
      const preSelected: Record<string, string> = {}
      for (const p of data.products_without_cmp) {
        if (p.suggested_match && (p.suggested_match.confidence === 'alta' || p.suggested_match.confidence === 'média')) {
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
        const next = { ...prev }
        delete next[mlSku]
        return next
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
        Produtos cadastrados com SKU diferente no ML e no Bling ficam sem CMV.
        Diagnostique para ver os casos, confirme os pares corretos e aplique a correção.
      </p>

      {/* Botão Diagnosticar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleDiag}
          disabled={diagStatus === 'running'}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
          style={{
            background: 'white',
            color:      diagStatus === 'running' ? B.muted : B.brand,
            border:     `1px solid ${diagStatus === 'running' ? B.border : B.brand}`,
            cursor:     diagStatus === 'running' ? 'not-allowed' : 'pointer',
          }}
        >
          <Search size={13} className={diagStatus === 'running' ? 'animate-pulse' : ''} />
          {diagStatus === 'running' ? 'Analisando…' : diagData ? 'Reanalisar' : 'Diagnosticar'}
        </button>
      </div>

      {/* Resultado do diagnóstico */}
      {diagData && (
        <div className="mt-4">
          {diagData.summary.products_WITHOUT_cmp === 0 ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: '#16a34a' }}>
              <CheckCircle size={14} />
              <span>Todos os produtos com vendas já têm CMP. Nenhuma ação necessária.</span>
            </div>
          ) : (
            <>
              <div className="text-[12px] mb-3" style={{ color: B.muted }}>
                <strong style={{ color: '#0B1023' }}>{diagData.summary.products_WITHOUT_cmp}</strong> produto(s) sem CMP •{' '}
                <strong style={{ color: '#0B1023' }}>{diagData.summary.with_suggestion}</strong> com sugestão automática.
                Confirme os pares corretos e clique em <em>Aplicar</em>.
              </div>

              {/* Tabela de mapeamento */}
              <div className="rounded-lg overflow-hidden mb-4" style={{ border: `1px solid ${B.border}` }}>
                {/* Cabeçalho */}
                <div className="grid grid-cols-12 px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ background: B.bg, color: B.muted }}>
                  <span className="col-span-3">SKU no ML (sem CMP)</span>
                  <span className="col-span-1 text-center">Vendas</span>
                  <span className="col-span-4">Produto Bling sugerido (com CMP)</span>
                  <span className="col-span-2 text-center">CMP</span>
                  <span className="col-span-2 text-center">Confiança</span>
                </div>

                {diagData.products_without_cmp.map((p, i) => {
                  const isConfirmed = p.suggested_match ? confirmed[p.sku] === p.suggested_match.sku : false
                  const conf = p.suggested_match ? CONFIDENCE_STYLE[p.suggested_match.confidence] : null

                  return (
                    <div
                      key={p.product_id}
                      className="grid grid-cols-12 px-3 py-2.5 items-center text-[12px] gap-1"
                      style={{
                        borderTop: i > 0 ? `1px solid ${B.border}` : undefined,
                        background: isConfirmed ? 'oklch(0.98 0.03 145)' : 'white',
                      }}
                    >
                      {/* SKU ML */}
                      <div className="col-span-3">
                        <div className="font-mono font-semibold text-[11px] text-blue-600">{p.sku}</div>
                        <div className="text-[10px] truncate" style={{ color: B.muted }}>{p.name}</div>
                      </div>

                      {/* Qtd vendas */}
                      <div className="col-span-1 text-center font-semibold" style={{ color: '#dc2626' }}>
                        {p.sales_count}
                      </div>

                      {/* Sugestão */}
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
                        ) : (
                          <span className="text-[11px] italic" style={{ color: B.muted }}>sem sugestão — informe manualmente</span>
                        )}
                      </div>

                      {/* CMP */}
                      <div className="col-span-2 text-center text-[11px] font-medium" style={{ color: '#0B1023' }}>
                        {p.suggested_match ? `R$ ${p.suggested_match.cmp_value.toFixed(2)}` : '—'}
                      </div>

                      {/* Confiança + checkbox */}
                      <div className="col-span-2 flex items-center justify-center gap-2">
                        {conf && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: conf.bg, color: conf.text }}
                          >
                            {conf.label}
                          </span>
                        )}
                        {p.suggested_match && (
                          <input
                            type="checkbox"
                            checked={isConfirmed}
                            onChange={() => toggleConfirm(p.sku, p.suggested_match!.sku)}
                            className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                          />
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
                    : <><Link2 size={13} /> Aplicar {confirmedCount > 0 ? `${confirmedCount} correção(ões)` : 'correções'}</>
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

              {/* Log detalhado */}
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
