'use client'
import { useState } from 'react'
import { CheckCircle, XCircle, Calculator } from 'lucide-react'

const B = {
  brand:  '#125BFF',
  border: 'oklch(0.88 0.016 258)',
  muted:  'oklch(0.50 0.025 258)',
  bg:     'oklch(0.96 0.010 258)',
  text:   '#0B1023',
}

interface Product { id: string; name: string; sku: string }

export function ManualCostForm({ products, onSaved }: { products: Product[]; onSaved?: () => void }) {
  const [productId,  setProductId]  = useState('')
  const [batchRef,   setBatchRef]   = useState('')
  const [issueDate,  setIssueDate]  = useState(new Date().toISOString().slice(0, 10))
  const [quantity,   setQuantity]   = useState('')
  const [fobTotal,   setFobTotal]   = useState('')
  const [taxesTotal, setTaxesTotal] = useState('')
  const [extraTotal, setExtraTotal] = useState('')
  const [loading,    setLoading]    = useState(false)
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null)

  // Preview do custo por unidade
  const qty    = parseFloat(quantity)  || 0
  const fob    = parseFloat(fobTotal)  || 0
  const taxes  = parseFloat(taxesTotal)|| 0
  const extra  = parseFloat(extraTotal)|| 0
  const unitCost = qty > 0 ? (fob + taxes + extra) / qty : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productId || !quantity || !fobTotal) return
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/nfe/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id:   productId,
          batch_ref:    batchRef || undefined,
          issue_date:   issueDate,
          quantity:     parseFloat(quantity),
          fob_total:    parseFloat(fobTotal),
          taxes_total:  taxesTotal ? parseFloat(taxesTotal) : 0,
          extra_total:  extraTotal ? parseFloat(extraTotal) : 0,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg({ ok: true, text: 'CMP atualizado! Recarregue a página para ver.' })
        setProductId(''); setBatchRef(''); setQuantity(''); setFobTotal(''); setTaxesTotal(''); setExtraTotal('')
        onSaved?.()
      } else {
        setMsg({ ok: false, text: data.error ?? 'Erro desconhecido' })
      }
    } catch {
      setMsg({ ok: false, text: 'Erro de conexão' })
    }
    setLoading(false)
  }

  const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="bg-white rounded-xl p-6" style={{ border: `1px solid ${B.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <Calculator size={15} style={{ color: B.brand }} />
        <h3 className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
          Entrada Manual de Custo de Importação
        </h3>
      </div>
      <p className="text-xs mb-5" style={{ color: B.muted }}>
        Use quando não tiver o XML da NF-e. Informe os valores do lote e o CMP é calculado automaticamente.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Produto */}
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Produto *</label>
            <select
              value={productId}
              onChange={e => setProductId(e.target.value)}
              required
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: `1px solid ${B.border}`, color: B.text }}
            >
              <option value="">Selecione o produto...</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </select>
          </div>

          {/* Data */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Data do lote *</label>
            <input
              type="date"
              value={issueDate}
              onChange={e => setIssueDate(e.target.value)}
              required
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: `1px solid ${B.border}`, color: B.text }}
            />
          </div>

          {/* Referência */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Referência do lote</label>
            <input
              type="text"
              placeholder="Ex: Lote China Mai/26 — Pedido PO-2026-001"
              value={batchRef}
              onChange={e => setBatchRef(e.target.value)}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: `1px solid ${B.border}`, color: B.text }}
            />
          </div>

          {/* Quantidade */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Quantidade importada (un.) *</label>
            <input
              type="number" min="1" step="1"
              placeholder="Ex: 500"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              required
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: `1px solid ${B.border}`, color: B.text }}
            />
          </div>

          {/* FOB */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Valor FOB total (R$) *</label>
            <input
              type="number" min="0" step="0.01"
              placeholder="Ex: 15000.00"
              value={fobTotal}
              onChange={e => setFobTotal(e.target.value)}
              required
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: `1px solid ${B.border}`, color: B.text }}
            />
          </div>

          {/* Impostos */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>
              Impostos totais da DI (R$)
              <span className="ml-1 font-normal opacity-70">II + IPI + PIS + COFINS + GNRE</span>
            </label>
            <input
              type="number" min="0" step="0.01"
              placeholder="Ex: 4500.00"
              value={taxesTotal}
              onChange={e => setTaxesTotal(e.target.value)}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: `1px solid ${B.border}`, color: B.text }}
            />
          </div>

          {/* Custos extras */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>
              Outros custos (R$)
              <span className="ml-1 font-normal opacity-70">frete + despachante + AFRMM + etc.</span>
            </label>
            <input
              type="number" min="0" step="0.01"
              placeholder="Ex: 2000.00"
              value={extraTotal}
              onChange={e => setExtraTotal(e.target.value)}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: `1px solid ${B.border}`, color: B.text }}
            />
          </div>
        </div>

        {/* Preview */}
        {unitCost > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm" style={{ background: 'oklch(0.95 0.03 258)', border: `1px solid oklch(0.88 0.04 258)` }}>
            <span style={{ color: B.muted }}>Custo landed estimado por unidade:</span>
            <span className="font-bold num" style={{ color: B.brand, fontFamily: 'var(--font-geist-mono)' }}>
              {fmtR(unitCost)}
            </span>
            {qty > 0 && fob > 0 && (
              <span className="text-xs ml-2" style={{ color: B.muted }}>
                ({fmtR(fob)} FOB + {fmtR(taxes)} impostos + {fmtR(extra)} outros) ÷ {qty} un.
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !productId || !quantity || !fobTotal}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
            style={{
              background: (loading || !productId || !quantity || !fobTotal) ? B.bg : B.brand,
              color:      (loading || !productId || !quantity || !fobTotal) ? B.muted : 'white',
              cursor:     (loading || !productId || !quantity || !fobTotal) ? 'not-allowed' : 'pointer',
            }}
          >
            <Calculator size={13} />
            {loading ? 'Calculando CMP…' : 'Calcular e Salvar CMP'}
          </button>

          {msg && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: msg.ok ? '#16a34a' : '#dc2626' }}>
              {msg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
