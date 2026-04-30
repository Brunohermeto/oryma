'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EXPENSE_CATEGORY_LABELS } from '@/types'
import type { OperationalExpenseCategory } from '@/types'

export function DespesaForm() {
  const [category, setCategory] = useState<OperationalExpenseCategory | ''>('')
  const [subcategory, setSubcategory] = useState('')
  const [description, setDescription] = useState('')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!category || !amount || !period) return
    setLoading(true)
    setMessage('')

    const res = await fetch('/api/despesas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dre_category: category,
        subcategory: subcategory || null,
        description: description || null,
        supplier: supplier || null,
        amount: parseFloat(amount),
        period: `${period}-01`,
      }),
    })
    const data = await res.json()
    if (data.ok) {
      setMessage('✓ Despesa lançada com sucesso')
      setSubcategory(''); setDescription(''); setSupplier(''); setAmount('')
    } else {
      setMessage(`✗ ${data.error}`)
    }
    setLoading(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h2 className="font-semibold text-gray-800 text-sm mb-4">Lançar Nova Despesa</h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
        <div>
          <Label className="text-xs">Competência</Label>
          <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Categoria DRE</Label>
          <Select onValueChange={v => setCategory(v as OperationalExpenseCategory)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Valor (R$)</Label>
          <Input type="number" step="0.01" min="0" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Subcategoria (opcional)</Label>
          <Input placeholder="Ex: Funcionário João" value={subcategory} onChange={e => setSubcategory(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Fornecedor (opcional)</Label>
          <Input placeholder="Ex: CPFL Energia" value={supplier} onChange={e => setSupplier(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Descrição (opcional)</Label>
          <Input placeholder="Ex: Conta de energia out/26" value={description} onChange={e => setDescription(e.target.value)} className="mt-1" />
        </div>
        <div className="col-span-3 flex items-center gap-3">
          <Button type="submit" disabled={loading || !category || !amount}>
            {loading ? 'Lançando...' : 'Lançar Despesa'}
          </Button>
          {message && <span className={`text-sm ${message.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{message}</span>}
        </div>
      </form>
    </div>
  )
}
