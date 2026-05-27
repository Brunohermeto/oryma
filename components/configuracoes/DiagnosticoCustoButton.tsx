'use client'
import { useState } from 'react'
import { FlaskConical } from 'lucide-react'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

export function DiagnosticoCustoButton() {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    setResult(null)
    try {
      const res  = await fetch('/api/debug/fix-costs', { method: 'POST' })
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setResult({ error: String(err) })
    }
    setLoading(false)
  }

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#92400e', fontFamily: 'var(--font-sora)' }}>
        🔬 Diagnóstico de Custos (temporário)
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        Testa se o sistema consegue gravar um custo de venda no banco. Resultado aparece abaixo.
      </p>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg"
        style={{ background: loading ? B.bg : '#d97706', color: loading ? B.muted : 'white', border: loading ? `1px solid ${B.border}` : 'none' }}
      >
        <FlaskConical size={13} className={loading ? 'animate-pulse' : ''} />
        {loading ? 'Testando…' : 'Testar gravação de custo'}
      </button>

      {result && (
        <pre className="mt-4 text-[11px] rounded-lg p-3 overflow-auto max-h-80"
          style={{ background: '#f8f8f8', border: `1px solid ${B.border}`, color: result.ok ? '#15803d' : '#991b1b' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}
