'use client'
import { useRouter, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { ChevronDown, X, Search } from 'lucide-react'

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

// Combobox com busca para produtos
function ProductCombobox({
  products,
  value,
  onChange,
}: {
  products: Product[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const containerRef          = useRef<HTMLDivElement>(null)
  const inputRef              = useRef<HTMLInputElement>(null)

  const selected = products.find(p => p.id === value)

  const filtered = query.trim() === ''
    ? products
    : products.filter(p =>
        p.sku.toLowerCase().includes(query.toLowerCase()) ||
        p.name.toLowerCase().includes(query.toLowerCase())
      )

  // Fecha ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleOpen() {
    setOpen(true)
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleSelect(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('all')
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} className="relative w-56">
      <Label className="text-xs text-gray-500">Produto</Label>
      <button
        type="button"
        onClick={handleOpen}
        className="mt-1 w-full h-9 flex items-center justify-between gap-1 px-3 rounded-md border border-input bg-background text-sm ring-offset-background hover:bg-accent/30 transition-colors"
        style={{ minWidth: 0 }}
      >
        <span className="truncate text-left flex-1" style={{ color: selected ? '#0B1023' : '#9ca3af' }}>
          {selected ? `${selected.sku} — ${selected.name}` : 'Todos os produtos'}
        </span>
        <span className="flex items-center gap-0.5 flex-shrink-0">
          {value && value !== 'all' && (
            <span
              onClick={handleClear}
              className="rounded-sm p-0.5 hover:bg-gray-200 cursor-pointer"
            >
              <X size={10} />
            </span>
          )}
          <ChevronDown size={13} className="text-gray-400" />
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg"
          style={{ maxHeight: 320, overflowY: 'auto', minWidth: 240 }}
        >
          {/* Campo de busca */}
          <div className="sticky top-0 bg-white border-b px-2 py-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 border">
              <Search size={12} className="text-gray-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar por SKU ou nome..."
                className="flex-1 text-xs bg-transparent outline-none placeholder-gray-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* Opção "Todos" */}
          <div
            onClick={() => handleSelect('all')}
            className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 text-gray-500"
            style={{ fontStyle: 'italic' }}
          >
            Todos os produtos
          </div>

          {/* Lista filtrada */}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">Nenhum produto encontrado</div>
          ) : (
            filtered.map(p => (
              <div
                key={p.id}
                onClick={() => handleSelect(p.id)}
                className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 flex items-baseline gap-1.5"
                style={{ background: p.id === value ? 'oklch(0.95 0.04 258)' : undefined }}
              >
                <span className="font-medium text-xs text-blue-600 flex-shrink-0">{p.sku}</span>
                <span className="text-gray-600 truncate text-xs">{p.name}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function SalesFilters({ products, currentFilters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [dateFrom, setDateFrom] = useState(currentFilters.dateFrom)
  const [dateTo, setDateTo]     = useState(currentFilters.dateTo)
  const [marketplace, setMarketplace] = useState(currentFilters.marketplace || 'all')
  const [productId, setProductId]     = useState(currentFilters.productId || 'all')
  const [fulfillment, setFulfillment] = useState(currentFilters.fulfillment || 'all')

  function applyFilters() {
    const params = new URLSearchParams()
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to', dateTo)
    if (marketplace && marketplace !== 'all') params.set('mp', marketplace)
    if (productId  && productId   !== 'all') params.set('product', productId)
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

        {/* Datas */}
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

        {/* Marketplace */}
        <div className="w-40">
          <Label className="text-xs text-gray-500">Marketplace</Label>
          <Select value={marketplace} onValueChange={v => setMarketplace(v ?? 'all')}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="mercado_livre">Mercado Livre</SelectItem>
              <SelectItem value="shopee">Shopee</SelectItem>
              <SelectItem value="amazon">Amazon</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Produto — combobox com busca */}
        <ProductCombobox
          products={products}
          value={productId}
          onChange={setProductId}
        />

        {/* Fulfillment */}
        <div className="w-36">
          <Label className="text-xs text-gray-500">Fulfillment</Label>
          <Select value={fulfillment} onValueChange={v => setFulfillment(v ?? 'all')}>
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
