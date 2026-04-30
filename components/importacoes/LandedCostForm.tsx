'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { IMPORT_COST_LABELS } from '@/types'
import type { ImportOrder } from '@/types'

export function LandedCostForm({
  orders,
  onSaved,
}: {
  orders: ImportOrder[]
  onSaved?: () => void
}) {
  const [orderId, setOrderId] = useState('')
  const [type, setType] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orderId || !type || !amount) return
    setLoading(true)
    setMessage('')

    const res = await fetch('/api/nfe/costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_order_id: orderId, type, description, amount }),
    })
    const data = await res.json()
    if (data.ok) {
      setMessage('✓ Custo vinculado — será incluído no landed cost ao calcular')
      setAmount('')
      setDescription('')
      onSaved?.()
    } else {
      setMessage(`✗ ${data.error}`)
    }
    setLoading(false)
  }

  const pendingOrders = orders.filter(o => !o.costs_complete)

  return (
    <div className="bg-white rounded-xl border border-blue-100 p-6">
      <h3 className="font-semibold text-gray-800 text-sm mb-1">Vincular Despesa Tardia à NF-e</h3>
      <p className="text-xs text-gray-400 mb-4">
        Frete rodoviário, despachante, AFRMM, armazenagem etc. que chegam após o desembaraço.
        Serão distribuídos proporcionalmente ao FOB de cada produto da NF.
      </p>
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-xs">NF-e de Importação</Label>
          <Select onValueChange={(v: string | null) => setOrderId(v ?? '')}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Selecione a NF-e..." />
            </SelectTrigger>
            <SelectContent>
              {orders.map(o => (
                <SelectItem key={o.id} value={o.id}>
                  {o.nfe_number} — {o.supplier} ({o.issue_date})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Tipo de Despesa</Label>
          <Select onValueChange={(v: string | null) => setType(v ?? '')}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(IMPORT_COST_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Valor (R$)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="0,00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="mt-1"
          />
        </div>

        <div className="col-span-2">
          <Label className="text-xs">Descrição (opcional)</Label>
          <Input
            placeholder="Ex: Bramorim — CT-e 00456, out/26"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="mt-1"
          />
        </div>

        <div className="col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={loading || !orderId || !type || !amount}>
            {loading ? 'Salvando...' : 'Vincular Despesa'}
          </Button>
          {message && (
            <span className={`text-sm ${message.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
              {message}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
