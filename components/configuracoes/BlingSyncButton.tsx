'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function BlingSyncButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  async function handleSync() {
    setLoading(true)
    const res = await fetch('/api/sync/bling', { method: 'POST' })
    const data = await res.json()
    setResult(data.ok
      ? `✓ ${data.nfe_entrada} NF-e entrada · ${data.nfe_saida} NF-e saída sincronizadas`
      : `✗ ${data.error}`)
    setLoading(false)
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleSync} disabled={loading} size="sm">
        {loading ? 'Sincronizando...' : 'Sincronizar NF-e Bling'}
      </Button>
      {result && <span className="text-sm text-gray-500">{result}</span>}
    </div>
  )
}
