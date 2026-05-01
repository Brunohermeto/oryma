'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/dashboard')
    } else {
      setError('Senha incorreta')
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'oklch(0.96 0.010 258)' }}
    >
      {/* Decoração de fundo */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-[0.06]"
          style={{ background: 'oklch(0.50 0.25 258)' }}
        />
        <div
          className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full opacity-[0.04]"
          style={{ background: 'oklch(0.50 0.25 258)' }}
        />
      </div>

      <div className="relative z-10 w-[340px]">
        {/* Card */}
        <div
          className="bg-white rounded-2xl p-8"
          style={{ border: '1px solid oklch(0.88 0.016 258)', boxShadow: '0 4px 24px oklch(0.50 0.25 258 / 0.06)' }}
        >
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{
                background: '#0B1023',
                color: '#125BFF',
                fontFamily: 'var(--font-sora)',
              }}
            >
              Or
            </div>
            <div>
              <div
                className="text-base font-semibold leading-tight"
                style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}
              >
                Oryma
              </div>
              <div className="text-[11px]" style={{ color: 'oklch(0.50 0.025 258)' }}>
                Inteligência comercial
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block text-[12px] font-medium mb-1.5"
                style={{ color: 'oklch(0.20 0.05 258)' }}
              >
                Senha de acesso
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: 'oklch(0.96 0.010 258)',
                  border: `1px solid ${error ? 'oklch(0.55 0.20 25)' : 'oklch(0.88 0.016 258)'}`,
                  color: 'oklch(0.12 0.04 258)',
                  fontFamily: 'var(--font-geist)',
                }}
                onFocus={e => {
                  const el = e.currentTarget
                  el.style.borderColor = '#125BFF'
                  el.style.boxShadow = '0 0 0 3px oklch(0.50 0.25 258 / 0.12)'
                }}
                onBlur={e => {
                  const el = e.currentTarget
                  el.style.borderColor = error ? 'oklch(0.55 0.20 25)' : 'oklch(0.88 0.016 258)'
                  el.style.boxShadow = ''
                }}
              />
              {error && (
                <p className="text-[12px] mt-1.5" style={{ color: 'oklch(0.52 0.20 25)' }}>
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: loading ? 'oklch(0.45 0.20 258)' : '#125BFF',
                color: '#ffffff',
                fontFamily: 'var(--font-sora)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => {
                if (!loading) {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.background = '#0e4fd4'
                }
              }}
              onMouseLeave={e => {
                if (!loading) {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.background = '#125BFF'
                }
              }}
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] mt-4" style={{ color: 'oklch(0.50 0.025 258)' }}>
          MCL Informática LTDA · Uso interno
        </p>
      </div>
    </div>
  )
}
