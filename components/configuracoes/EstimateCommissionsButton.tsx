'use client'
import { useState } from 'react'
import { Calculator, CheckCircle, XCircle, Eye } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

interface PreviewData {
  trusted_sales: number
  suspect_sales: number
  to_update: number
  rate_by_product: Record<string, string>
  sample_updates: Array<{ id: string; comissao_atual: string; comissao_estimada: string; fonte: string }>
  message: string
}

export function EstimateCommissionsButton() {
  const [status,  setStatus]  = useState<'idle' | 'previewing' | 'applying' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [result,  setResult]  = useState('')

  async function handlePreview() {
    setStatus('previewing')
    setPreview(null)
    try {
      const res  = await fetch('/api/debug/estimate-commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: true }),
      })
      const data = await res.json()
      setPreview(data)
      setStatus('idle')
    } catch (err) {
      setResult(`Erro: ${String(err)}`)
      setStatus('error')
    }
  }

  async function handleApply() {
    setStatus('applying')
    setResult('')
    try {
      const res  = await fetch('/api/debug/estimate-commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setResult(`Erro: ${data.error}`); setStatus('error'); return }
      setResult(data.message)
      setStatus('done')
    } catch (err) {
      setResult(`Erro: ${String(err)}`)
      setStatus('error')
    }
  }

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Estimar Comissões por Produto
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Aplica estimativa de comissão <strong>apenas nas vendas sem NF-e de saída</strong> (onde
        a API ML retorna &lt;5% incorretamente). Vendas com NF-e já sincronizada têm dados
        confirmados e <strong>não são alteradas</strong>. Frete e impostos continuam a confirmar via NF-e.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handlePreview}
          disabled={status === 'previewing' || status === 'applying'}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
          style={{
            background: 'white', color: B.brand,
            border: `1px solid ${B.brand}`,
            cursor: status !== 'idle' && status !== 'done' ? 'not-allowed' : 'pointer',
            opacity: status === 'previewing' ? 0.6 : 1,
          }}
        >
          <Eye size={13} />
          {status === 'previewing' ? 'Calculando…' : 'Ver Estimativas'}
        </button>

        {preview && preview.to_update > 0 && status !== 'done' && (
          <button
            onClick={handleApply}
            disabled={status === 'applying'}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
            style={{
              background: status === 'applying' ? B.bg : B.brand,
              color: status === 'applying' ? B.muted : 'white',
              border: status === 'applying' ? `1px solid ${B.border}` : 'none',
              cursor: status === 'applying' ? 'not-allowed' : 'pointer',
            }}
          >
            <Calculator size={13} />
            {status === 'applying' ? 'Aplicando…' : `Aplicar ${preview.to_update} estimativas`}
          </button>
        )}

        {status === 'done' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
            <CheckCircle size={13} /> {result}
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
            <XCircle size={13} /> {result}
          </span>
        )}
      </div>

      {/* Prévia */}
      {preview && (
        <div className="mt-4 rounded-lg overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
          <div className="px-4 py-2.5 text-[12px]" style={{ background: B.bg }}>
            <span className="font-semibold" style={{ color: '#0B1023' }}>
              {preview.to_update} vendas para estimar
            </span>
            <span style={{ color: B.muted }}>
              {' '}(de {preview.suspect_sales} suspeitas · {preview.trusted_sales} confiáveis como base)
            </span>
          </div>

          {/* Taxas por produto */}
          {Object.keys(preview.rate_by_product).length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: B.muted, borderTop: `1px solid ${B.border}` }}>
                Taxas calculadas por produto
              </div>
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {Object.entries(preview.rate_by_product).map(([sku, rate]) => (
                  <span key={sku} className="text-[11px] px-2 py-0.5 rounded-full font-mono"
                    style={{ background: B.bg, color: '#0B1023', border: `1px solid ${B.border}` }}>
                    {sku.slice(0, 12)} = {rate}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Amostra */}
          {preview.sample_updates.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: B.muted, borderTop: `1px solid ${B.border}` }}>
                Amostra (10 primeiras)
              </div>
              {preview.sample_updates.map((u, i) => (
                <div key={i} className="grid grid-cols-4 px-4 py-1.5 text-[11px] items-center"
                  style={{ borderTop: `1px solid ${B.border}` }}>
                  <span className="font-mono" style={{ color: B.muted }}>{u.id}</span>
                  <span style={{ color: '#dc2626' }}>{u.comissao_atual} → <strong>{u.comissao_estimada}</strong></span>
                  <span className="col-span-2" style={{ color: B.muted }}>{u.fonte}</span>
                </div>
              ))}
            </>
          )}

          {preview.to_update === 0 && (
            <div className="px-4 py-3 text-[12px]" style={{ color: '#16a34a' }}>
              ✓ Nenhuma comissão suspeita encontrada.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
