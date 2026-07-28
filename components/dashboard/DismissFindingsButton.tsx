'use client'

/** X que dispensa um grupo de avisos da auditoria (não voltam nas próximas rodadas). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

export function DismissFindingsButton({ ids, title }: { ids: string[]; title?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function dismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setBusy(true)
    await fetch('/api/audit/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => null)
    router.refresh()
  }

  return (
    <button
      onClick={dismiss}
      disabled={busy}
      title={title ?? 'Dispensar estes avisos (não voltam a aparecer)'}
      className="ml-auto p-1 rounded-md cursor-pointer flex-shrink-0"
      style={{ background: 'transparent', border: 'none', color: busy ? '#cbd5e1' : 'oklch(0.50 0.025 258)' }}
    >
      <X size={13} />
    </button>
  )
}
