'use client'
import { useState } from 'react'
import { CheckCircle, XCircle, Save, AlertCircle } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bg:       'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

interface ProductRow {
  id: string; sku: string; name: string; sales_count: number
}
interface ProductWithCmp extends ProductRow {
  cmp_value: number; effective_date: string
}

interface Props {
  withoutCmp: ProductRow[]
  withCmp: ProductWithCmp[]
}

export function CmpManualForm({ withoutCmp, withCmp }: Props) {
  // Estado dos inputs: product_id → valor digitado
  const [values, setValues] = useState<Record<string, string>>({})
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  function handleChange(id: string, val: string) {
    setValues(prev => ({ ...prev, [id]: val }))
  }

  // Preenche todos os campos vazios com o mesmo valor
  function fillAll(val: string) {
    const next: Record<string, string> = {}
    for (const p of withoutCmp) next[p.id] = val
    setValues(next)
  }

  async function handleSave() {
    const entries = Object.entries(values)
      .filter(([, v]) => v && parseFloat(v) > 0)
      .map(([product_id, v]) => ({
        product_id,
        cmp_value:      parseFloat(v.replace(',', '.')),
        effective_date: date,
      }))

    if (!entries.length) {
      setMessage('Preencha pelo menos um valor antes de salvar.')
      setStatus('error')
      return
    }

    setStatus('saving')
    setMessage('')

    try {
      const res  = await fetch('/api/cmp/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setMessage(data.error ?? 'Erro ao salvar')
        setStatus('error')
        return
      }
      setMessage(data.message)
      setStatus('done')
    } catch (err) {
      setMessage(String(err))
      setStatus('error')
    }
  }

  const filledCount = Object.values(values).filter(v => v && parseFloat(v) > 0).length

  return (
    <div className="space-y-6">

      {/* Instrução */}
      <div className="rounded-xl px-5 py-4 flex items-start gap-3"
        style={{ background: 'oklch(0.95 0.03 258)', border: '1px solid oklch(0.85 0.04 258)' }}>
        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" style={{ color: B.brand }} />
        <div className="text-[13px]" style={{ color: B.text }}>
          Informe o <strong>custo médio de importação (CMV)</strong> por unidade para cada produto.
          Inclui frete, impostos e custo do produto. Use o valor da última NF-e de entrada ou a média histórica.
          Após salvar, as margens serão recalculadas automaticamente.
        </div>
      </div>

      {/* Data de vigência */}
      <div className="flex items-center gap-3">
        <label className="text-[13px] font-semibold" style={{ color: B.text }}>
          Data de vigência do CMV:
        </label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="h-9 text-sm rounded-md border px-3"
          style={{ borderColor: B.border }}
        />
      </div>

      {/* Tabela — produtos SEM CMV */}
      {withoutCmp.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-bold uppercase tracking-widest" style={{ color: B.muted }}>
              Produtos sem CMV ({withoutCmp.length})
            </h2>
            <button
              onClick={() => {
                const v = prompt('Preencher todos com qual valor? (ex: 150.00)')
                if (v) fillAll(v)
              }}
              className="text-[12px] px-3 py-1 rounded-lg border"
              style={{ borderColor: B.border, color: B.brand }}
            >
              Preencher todos igual
            </button>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
            {/* Header */}
            <div className="grid grid-cols-12 px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: B.bg, color: B.muted }}>
              <span className="col-span-2">SKU</span>
              <span className="col-span-5">Nome</span>
              <span className="col-span-2 text-center">Vendas</span>
              <span className="col-span-3 text-right">CMV (R$)</span>
            </div>

            {withoutCmp.map((p, i) => (
              <div key={p.id}
                className="grid grid-cols-12 px-4 py-2.5 items-center"
                style={{ borderTop: i > 0 ? `1px solid ${B.border}` : undefined }}>
                <div className="col-span-2 font-mono font-semibold text-[11px] text-blue-600">{p.sku}</div>
                <div className="col-span-5 text-[12px] pr-2 truncate" style={{ color: B.muted }}>{p.name}</div>
                <div className="col-span-2 text-center font-semibold text-[13px]" style={{ color: '#dc2626' }}>
                  {p.sales_count}
                </div>
                <div className="col-span-3 flex justify-end">
                  <div className="flex items-center gap-1">
                    <span className="text-[12px]" style={{ color: B.muted }}>R$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0,00"
                      value={values[p.id] ?? ''}
                      onChange={e => handleChange(p.id, e.target.value)}
                      className="w-24 h-8 text-sm text-right rounded-md border px-2 outline-none focus:ring-1"
                      style={{ borderColor: B.border }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: '#16a34a' }}>
          <CheckCircle size={14} /> Todos os produtos com vendas já têm CMV cadastrado.
        </div>
      )}

      {/* Botão salvar */}
      {withoutCmp.length > 0 && (
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={status === 'saving' || filledCount === 0}
            className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-all"
            style={{
              background: filledCount === 0 || status === 'saving' ? B.bg : B.brand,
              color:      filledCount === 0 || status === 'saving' ? B.muted : 'white',
              border:     filledCount === 0 || status === 'saving' ? `1px solid ${B.border}` : 'none',
              cursor:     filledCount === 0 || status === 'saving' ? 'not-allowed' : 'pointer',
            }}
          >
            <Save size={14} />
            {status === 'saving'
              ? 'Salvando…'
              : `Salvar ${filledCount > 0 ? `${filledCount} produto(s)` : 'CMV'} e recalcular margens`}
          </button>

          {status === 'done' && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
              <CheckCircle size={13} /> {message}
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
              <XCircle size={13} /> {message}
            </span>
          )}
        </div>
      )}

      {/* Referência — produtos COM CMV */}
      {withCmp.length > 0 && (
        <details>
          <summary className="text-[12px] cursor-pointer font-semibold uppercase tracking-widest"
            style={{ color: B.muted }}>
            Produtos com CMV já cadastrado ({withCmp.length}) — referência
          </summary>
          <div className="mt-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
            <div className="grid grid-cols-12 px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: B.bg, color: B.muted }}>
              <span className="col-span-2">SKU</span>
              <span className="col-span-5">Nome</span>
              <span className="col-span-2 text-center">Vendas</span>
              <span className="col-span-3 text-right">CMV atual</span>
            </div>
            {withCmp.map((p, i) => (
              <div key={p.id}
                className="grid grid-cols-12 px-4 py-2 items-center text-[12px]"
                style={{ borderTop: i > 0 ? `1px solid ${B.border}` : undefined }}>
                <div className="col-span-2 font-mono font-semibold text-[11px] text-blue-600">{p.sku}</div>
                <div className="col-span-5 truncate pr-2" style={{ color: B.muted }}>{p.name}</div>
                <div className="col-span-2 text-center font-semibold">{p.sales_count}</div>
                <div className="col-span-3 text-right font-semibold" style={{ color: '#0B1023' }}>
                  R$ {p.cmp_value.toFixed(2)}
                  <span className="text-[10px] font-normal ml-1" style={{ color: B.muted }}>
                    desde {p.effective_date}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
