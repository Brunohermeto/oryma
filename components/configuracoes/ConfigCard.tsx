'use client'
import { useState } from 'react'
import { CheckCircle, Circle, RefreshCw, ExternalLink } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
  violeta:  '#7B61FF',
}

interface ConfigCardProps {
  id: string
  name: string
  description: string
  guide?: string          // URL para guia de como obter credenciais
  connectUrl?: string
  credential?: { access_token?: string | null; extra?: Record<string, unknown> | null; updated_at?: string } | null
  type: 'oauth' | 'manual_shopee' | 'manual_amazon' | 'manual_tiktok'
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: B.muted }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
        style={{
          background: B.bgSubtle,
          border: `1px solid ${B.border}`,
          color: B.text,
          fontFamily: 'var(--font-inter)',
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = B.brand
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(18,91,255,0.10)'
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = B.border
          e.currentTarget.style.boxShadow = ''
        }}
      />
    </div>
  )
}

export function ConfigCard({ id, name, description, guide, connectUrl, credential, type }: ConfigCardProps) {
  const isConnected = !!credential?.access_token ||
    (type === 'manual_amazon' && !!(credential?.extra as Record<string, unknown>)?.seller_id)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  const [shopeePartnerId, setShopeePartnerId] = useState('')
  const [shopeeShopId, setShopeeShopId]       = useState('')
  const [shopeeToken, setShopeeToken]         = useState('')

  const [ttServiceId, setTtServiceId] = useState('')
  const [ttKey, setTtKey]             = useState('')
  const [ttSecret, setTtSecret]       = useState('')
  const ttChaves = !!(credential?.extra as Record<string, unknown>)?.app_key

  const [amazonSellerId, setAmazonSellerId]       = useState('')
  const [amazonRefreshToken, setAmazonRefreshToken] = useState('')

  async function handleSaveShopee(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/integrations/shopee/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_id: shopeePartnerId, shop_id: shopeeShopId, access_token: shopeeToken }),
    })
    setSuccess(res.ok)
    setMessage(res.ok ? 'Shopee conectada com sucesso' : 'Erro ao salvar — verifique as credenciais')
    setLoading(false)
  }

  async function handleSaveTiktok(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/integrations/tiktok/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: ttServiceId, app_key: ttKey, app_secret: ttSecret }),
    })
    const d = await res.json().catch(() => ({}))
    setSuccess(res.ok)
    setMessage(res.ok ? 'Chaves salvas — agora clique em "Conectar loja"' : (d.error ?? 'Erro ao salvar'))
    setLoading(false)
    if (res.ok) { setTtSecret(''); window.location.reload() }
  }

  async function handleSaveAmazon(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/integrations/amazon/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seller_id: amazonSellerId, refresh_token: amazonRefreshToken }),
    })
    setSuccess(res.ok)
    setMessage(res.ok ? 'Amazon conectada com sucesso' : 'Erro ao salvar — verifique as credenciais')
    setLoading(false)
  }

  const updatedAt = credential?.updated_at
    ? new Date(credential.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: type !== 'oauth' || !isConnected ? `1px solid ${B.border}` : undefined }}>
        <div>
          <div className="font-semibold text-[15px]" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            {name}
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: B.muted }}>{description}</div>
          {updatedAt && isConnected && (
            <div className="text-[11px] mt-1" style={{ color: B.muted }}>
              Última conexão: {updatedAt}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          {guide && !isConnected && (
            <a
              href={guide}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[12px] underline"
              style={{ color: B.muted }}
            >
              <ExternalLink size={11} />
              Como obter
            </a>
          )}
          <span
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-full"
            style={isConnected
              ? { background: 'oklch(0.94 0.10 145)', color: '#15803d' }
              : { background: B.bgSubtle, color: B.muted }
            }
          >
            {isConnected
              ? <><CheckCircle size={12} /> Conectado</>
              : <><Circle size={12} /> Não conectado</>
            }
          </span>
        </div>
      </div>

      {/* OAuth connect button */}
      {type === 'oauth' && connectUrl && (
        <div className="px-5 py-3">
          <a href={connectUrl}>
            <button
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
              style={{
                background: isConnected ? B.bgSubtle : B.brand,
                color: isConnected ? B.text : 'white',
                border: isConnected ? `1px solid ${B.border}` : 'none',
              }}
            >
              <RefreshCw size={13} />
              {isConnected ? 'Reconectar' : 'Conectar via OAuth'}
            </button>
          </a>
        </div>
      )}

      {/* Shopee manual form */}
      {type === 'manual_shopee' && (
        <form onSubmit={handleSaveShopee} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Partner ID" value={shopeePartnerId} onChange={setShopeePartnerId} placeholder="123456" />
            <Field label="Shop ID"    value={shopeeShopId}    onChange={setShopeeShopId}    placeholder="654321" />
          </div>
          <Field label="Access Token" value={shopeeToken} onChange={setShopeeToken} placeholder="token de acesso..." type="password" />
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="text-sm font-semibold px-4 py-2 rounded-lg transition-all"
              style={{ background: B.brand, color: 'white', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Salvando…' : 'Salvar credenciais'}
            </button>
            {message && (
              <span className="text-[12px]" style={{ color: success ? '#16a34a' : '#dc2626' }}>
                {success ? '✓' : '✗'} {message}
              </span>
            )}
          </div>
        </form>
      )}

      {/* TikTok Shop: chaves do app (uma vez) + autorização da loja */}
      {type === 'manual_tiktok' && (
        <div className="px-5 py-4 space-y-3">
          {(!ttChaves || !isConnected) && (
            <form onSubmit={handleSaveTiktok} className="space-y-3">
              <div className="text-[12px]" style={{ color: B.muted }}>
                Partner Center → seu app: <b>ID</b> (número no topo), <b>Chave do aplicativo</b> e <b>Segredo do aplicativo</b>.
                {ttChaves && ' Chaves já salvas — preencha de novo só se quiser trocar.'}
              </div>
              <Field label="Service ID (ID do app)" value={ttServiceId} onChange={setTtServiceId} placeholder="7701…" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="App Key (Chave do aplicativo)" value={ttKey} onChange={setTtKey} placeholder="6ln…" />
                <Field label="App Secret (Segredo)" value={ttSecret} onChange={setTtSecret} placeholder="••••••••" type="password" />
              </div>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={loading} className="text-sm font-semibold px-4 py-2 rounded-lg"
                        style={{ background: ttChaves ? B.bgSubtle : B.brand, color: ttChaves ? B.text : 'white', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Salvando…' : 'Salvar chaves'}
                </button>
                {message && <span className="text-[12px]" style={{ color: success ? '#16a34a' : '#dc2626' }}>{success ? '✓' : '✗'} {message}</span>}
              </div>
            </form>
          )}
          {ttChaves && (
            <a href="/api/integrations/tiktok/authorize">
              <button className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg"
                      style={{ background: isConnected ? B.bgSubtle : B.brand, color: isConnected ? B.text : 'white', border: isConnected ? `1px solid ${B.border}` : 'none' }}>
                <RefreshCw size={13} /> {isConnected ? 'Reconectar loja' : 'Conectar loja'}
              </button>
            </a>
          )}
        </div>
      )}

      {/* Amazon manual form */}
      {type === 'manual_amazon' && (
        <form onSubmit={handleSaveAmazon} className="px-5 py-4 space-y-3">
          <Field label="Seller ID"          value={amazonSellerId}      onChange={setAmazonSellerId}      placeholder="AXXXXXXXXXX" />
          <Field label="Refresh Token (LWA)" value={amazonRefreshToken}  onChange={setAmazonRefreshToken}  placeholder="Atzr|..." type="password" />
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="text-sm font-semibold px-4 py-2 rounded-lg transition-all"
              style={{ background: B.brand, color: 'white', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Salvando…' : 'Salvar credenciais'}
            </button>
            {message && (
              <span className="text-[12px]" style={{ color: success ? '#16a34a' : '#dc2626' }}>
                {success ? '✓' : '✗'} {message}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
