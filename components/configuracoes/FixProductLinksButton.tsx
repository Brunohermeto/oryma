'use client'
import { useState } from 'react'
import { Link2, CheckCircle, XCircle, Search, ChevronDown, ChevronUp } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

interface ProductWithoutCmp {
  product_id: string
  sku: string
  name: string
  sales_count: number
  marketplaces: string[]
}

interface DiagResult {
  summary: { total_products_with_sales: number; products_with_cmp: number; products_WITHOUT_cmp: number }
  products_without_cmp: ProductWithoutCmp[]
}

export function FixProductLinksButton() {
  const [diagStatus, setDiagStatus]   = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [diagData, setDiagData]       = useState<DiagResult | null>(null)
  const [showDiag, setShowDiag]       = useState(false)

  const [fixStatus, setFixStatus]     = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [fixResult, setFixResult]     = useState('')

  async function handleDiag() {
    setDiagStatus('running')
    setDiagData(null)
    try {
      const res  = await fetch('/api/debug/products-without-cmp')
      const data = await res.json()
      if (!res.ok || data.error) { setDiagStatus('error'); return }
      setDiagData(data)
      setDiagStatus('done')
      setShowDiag(true)
    } catch {
      setDiagStatus('error')
    }
  }

  async function handleFix() {
    setFixStatus('running')
    setFixResult('')
    try {
      const res  = await fetch('/api/debug/fix-product-links', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) {
        setFixResult(`Erro: ${data.error ?? 'falha'}`)
        setFixStatus('error')
        return
      }
      setFixResult(data.message)
      setFixStatus('done')
    } catch (err) {
      setFixResult(`Erro: ${String(err)}`)
      setFixStatus('error')
    }
  }

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Corrigir Vínculo de Produtos (SKU ML ↔ EAN Bling)
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Produtos cadastrados com SKU diferente no ML e no Bling ficam sem CMV.
        Use <strong>Diagnosticar</strong> para ver quais precisam de correção,
        depois <strong>Corrigir</strong> para aplicar o mapeamento conhecido e recalcular CMV.
      </p>

      <div className="flex items-center gap-3 flex-wrap mb-3">
        {/* Botão Diagnosticar */}
        <button
          onClick={handleDiag}
          disabled={diagStatus === 'running'}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
          style={{
            background: diagStatus === 'running' ? B.bg : 'white',
            color:      diagStatus === 'running' ? B.muted : B.brand,
            border:     `1px solid ${diagStatus === 'running' ? B.border : B.brand}`,
            cursor:     diagStatus === 'running' ? 'not-allowed' : 'pointer',
          }}
        >
          <Search size={13} className={diagStatus === 'running' ? 'animate-pulse' : ''} />
          {diagStatus === 'running' ? 'Analisando…' : 'Diagnosticar'}
        </button>

        {/* Botão Corrigir */}
        <button
          onClick={handleFix}
          disabled={fixStatus === 'running'}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
          style={{
            background: fixStatus === 'running' ? B.bg : B.brand,
            color:      fixStatus === 'running' ? B.muted : 'white',
            border:     fixStatus === 'running' ? `1px solid ${B.border}` : 'none',
            cursor:     fixStatus === 'running' ? 'not-allowed' : 'pointer',
          }}
        >
          <Link2 size={13} className={fixStatus === 'running' ? 'animate-pulse' : ''} />
          {fixStatus === 'running' ? 'Corrigindo…' : 'Corrigir Vínculos'}
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

      {/* Resultado do diagnóstico */}
      {diagData && (
        <div className="mt-3 rounded-lg overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
          <button
            onClick={() => setShowDiag(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-semibold"
            style={{ background: B.bg, color: '#0B1023' }}
          >
            <span>
              {diagData.summary.products_WITHOUT_cmp === 0
                ? '✓ Todos os produtos com vendas têm CMP'
                : `⚠ ${diagData.summary.products_WITHOUT_cmp} produto(s) com vendas SEM CMP (de ${diagData.summary.total_products_with_sales} totais)`}
            </span>
            {showDiag ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {showDiag && diagData.products_without_cmp.length > 0 && (
            <div className="divide-y" style={{ borderTop: `1px solid ${B.border}` }}>
              <div className="grid grid-cols-4 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: B.muted, background: B.bg }}>
                <span>SKU</span>
                <span className="col-span-2">Nome</span>
                <span className="text-right">Vendas</span>
              </div>
              {diagData.products_without_cmp.map(p => (
                <div key={p.product_id} className="grid grid-cols-4 px-4 py-2 text-[12px] items-center">
                  <span className="font-medium text-blue-600 font-mono text-[11px]">{p.sku}</span>
                  <span className="col-span-2 text-gray-600 truncate pr-2">{p.name}</span>
                  <span className="text-right font-semibold" style={{ color: '#dc2626' }}>{p.sales_count}</span>
                </div>
              ))}
              <div className="px-4 py-2.5 text-[11px]" style={{ color: B.muted, background: 'oklch(0.99 0.005 258)' }}>
                Para corrigir produtos não listados no mapeamento padrão, entre em contato para adicionar o vínculo.
              </div>
            </div>
          )}

          {showDiag && diagData.products_without_cmp.length === 0 && (
            <div className="px-4 py-3 text-[12px]" style={{ color: '#16a34a' }}>
              Todos os produtos com vendas já possuem CMP cadastrado. Nenhuma ação necessária.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
