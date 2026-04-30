'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ConfigCardProps {
  id: string
  name: string
  description: string
  connectUrl?: string
  credential?: { access_token?: string | null; extra?: Record<string, unknown> | null; updated_at?: string } | null
  type: 'oauth' | 'manual_shopee' | 'manual_amazon'
}

export function ConfigCard({ id, name, description, connectUrl, credential, type }: ConfigCardProps) {
  const isConnected = !!credential?.access_token || (type === 'manual_amazon' && !!(credential?.extra as Record<string, unknown>)?.seller_id)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Shopee manual form state
  const [shopeePartnerId, setShopeePartnerId] = useState('')
  const [shopeeShopId, setShopeeShopId] = useState('')
  const [shopeeToken, setShopeeToken] = useState('')

  // Amazon manual form state
  const [amazonSellerId, setAmazonSellerId] = useState('')
  const [amazonRefreshToken, setAmazonRefreshToken] = useState('')

  async function handleSaveShopee(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/integrations/shopee/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_id: shopeePartnerId, shop_id: shopeeShopId, access_token: shopeeToken }),
    })
    setMessage(res.ok ? '✓ Shopee conectada' : '✗ Erro ao salvar')
    setLoading(false)
  }

  async function handleSaveAmazon(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/integrations/amazon/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seller_id: amazonSellerId, refresh_token: amazonRefreshToken }),
    })
    setMessage(res.ok ? '✓ Amazon conectada' : '✗ Erro ao salvar')
    setLoading(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold text-gray-900">{name}</div>
          <div className="text-sm text-gray-400 mt-0.5">{description}</div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
          isConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {isConnected ? '✓ Conectado' : '○ Não conectado'}
        </span>
      </div>

      {type === 'oauth' && connectUrl && (
        <a href={connectUrl}>
          <Button variant={isConnected ? 'outline' : 'default'} size="sm">
            {isConnected ? 'Reconectar' : 'Conectar'}
          </Button>
        </a>
      )}

      {type === 'manual_shopee' && (
        <form onSubmit={handleSaveShopee} className="space-y-2 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Partner ID</Label>
              <Input value={shopeePartnerId} onChange={e => setShopeePartnerId(e.target.value)} placeholder="123456" className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Shop ID</Label>
              <Input value={shopeeShopId} onChange={e => setShopeeShopId(e.target.value)} placeholder="654321" className="h-8 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Access Token</Label>
            <Input value={shopeeToken} onChange={e => setShopeeToken(e.target.value)} placeholder="token..." className="h-8 text-sm" type="password" />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
            {message && <span className="text-xs text-gray-500">{message}</span>}
          </div>
        </form>
      )}

      {type === 'manual_amazon' && (
        <form onSubmit={handleSaveAmazon} className="space-y-2 mt-2">
          <div>
            <Label className="text-xs">Seller ID</Label>
            <Input value={amazonSellerId} onChange={e => setAmazonSellerId(e.target.value)} placeholder="AXXXXXXXXXX" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Refresh Token (LWA)</Label>
            <Input value={amazonRefreshToken} onChange={e => setAmazonRefreshToken(e.target.value)} placeholder="Atzr|..." className="h-8 text-sm" type="password" />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
            {message && <span className="text-xs text-gray-500">{message}</span>}
          </div>
        </form>
      )}
    </div>
  )
}
