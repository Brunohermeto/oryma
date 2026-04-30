'use client'
import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

interface Product { id: string; name: string; sku: string }

interface Props {
  products: Product[]
  currentFilters: {
    dateFrom: string
    dateTo: string
    marketplace: string
    productId: string
    fulfillment: string
  }
}

export function SalesFilters({ products, currentFilters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [dateFrom, setDateFrom] = useState(currentFilters.dateFrom)
  const [dateTo, setDateTo] = useState(currentFilters.dateTo)
  const [marketplace, setMarketplace] = useState(currentFilters.marketplace || 'all')
  const [productId, setProductId] = useState(currentFilters.productId || 'all')
  const [fulfillment, setFulfillment] = useState(currentFilters.fulfillment || 'all')

  function applyFilters() {
    const params = new URLSearchParams()
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    if (marketplace && marketplace !== 'all') params.set('mp', marketplace)
    if (productId && productId !== 'all') params.set('product', productId)
    if (fulfillment && fulfillment !== 'all') params.set('fulfillment', fulfillment)
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearFilters() {
    setDateFrom(currentFilters.dateFrom)
    setDateTo(currentFilters.dateTo)
    setMarketplace('all')
    setProductId('all')
    setFulfillment('all')
    router.push(pathname)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-3">
          <div>
            <Label className="text-xs text-gray-500">De</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 w-36 h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Até</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 w-36 h-9 text-sm" />
          </div>
        </div>

        <div className="w-40">
          <Label className="text-xs text-gray-500">Marketplace</Label>
          <Select value={marketplace} onValueChange={(v) => setMarketplace(v ?? 'all')}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="mercado_livre">Mercado Livre</SelectItem>
              <SelectItem value="shopee">Shopee</SelectItem>
              <SelectItem value="amazon">Amazon</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-48">
          <Label className="text-xs text-gray-500">Produto</Label>
          <Select value={productId} onValueChange={(v) => setProductId(v ?? 'all')}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os produtos</SelectItem>
              {products.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-36">
          <Label className="text-xs text-gray-500">Fulfillment</Label>
          <Select value={fulfillment} onValueChange={(v) => setFulfillment(v ?? 'all')}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="galpao">Galpão</SelectItem>
              <SelectItem value="full_ml">Full ML</SelectItem>
              <SelectItem value="fba_amazon">FBA Amazon</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={clearFilters}>Limpar</Button>
          <Button size="sm" onClick={applyFilters}>Aplicar filtros</Button>
        </div>
      </div>
    </div>
  )
}
