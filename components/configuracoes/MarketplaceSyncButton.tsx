'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function MarketplaceSyncButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  async function handleSync() {
    setLoading(true)
    const res = await fetch('/api/sync/marketplaces', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      setResult(`✓ ML: ${data.mercado_livre ?? 0} · Shopee: ${data.shopee ?? 0} · Amazon: ${data.amazon ?? 0} vendas`)
    } else {
      setResult(`✗ ${data.error}`)
    }
    setLoading(false)
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleSync} disabled={loading} size="sm" variant="outline">
        {loading ? 'Sincronizando...' : 'Sincronizar Vendas'}
      </Button>
      {result && <span className="text-sm text-gray-500">{result}</span>}
    </div>
  )
}
