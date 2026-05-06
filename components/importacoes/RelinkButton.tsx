'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function RelinkButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [msg, setMsg]       = useState('')
  const router = useRouter()

  async function handle() {
    setStatus('running')
    setMsg('')
    try {
      const res  = await fetch('/api/landed-cost/relink', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setMsg(data.message)
        setStatus('done')
        router.refresh()
      } else throw new Error(data.error)
    } catch (err) {
      setMsg(String(err).replace('Error: ', ''))
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handle}
        disabled={status === 'running'}
        className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
        style={{
          background: status === 'running' ? 'oklch(0.96 0.010 258)' : '#125BFF',
          color:      status === 'running' ? 'oklch(0.50 0.025 258)' : 'white',
          cursor:     status === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        <RefreshCw size={13} className={status === 'running' ? 'animate-spin' : ''} />
        {status === 'running' ? 'Recalculando CMP…' : 'Vincular produtos e recalcular CMP'}
      </button>
      {status === 'done' && (
        <span className="flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
          <CheckCircle size={13} /> {msg}
        </span>
      )}
      {status === 'error' && (
        <span className="text-sm" style={{ color: '#dc2626' }}>
          <XCircle size={12} className="inline mr-1" />{msg}
        </span>
      )}
    </div>
  )
}
