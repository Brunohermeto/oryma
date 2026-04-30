'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 w-80">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
            MI
          </div>
          <div>
            <div className="font-semibold text-gray-900 text-sm">MarketIntel</div>
            <div className="text-gray-400 text-xs">RAGALUMA</div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="Senha de acesso"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
