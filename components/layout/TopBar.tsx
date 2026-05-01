'use client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

interface TopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div
      className="sticky top-0 z-10 px-8 py-4 flex items-center justify-between"
      style={{
        background: 'oklch(1 0 0)',
        borderBottom: '1px solid oklch(0.88 0.016 258)',
      }}
    >
      <div>
        <h1
          className="text-base font-semibold leading-tight"
          style={{ color: 'oklch(0.12 0.04 258)', fontFamily: 'var(--font-sora)' }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] mt-0.5" style={{ color: 'oklch(0.50 0.025 258)' }}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {actions}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: 'oklch(0.50 0.025 258)' }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'oklch(0.93 0.014 258)'
            el.style.color = 'oklch(0.12 0.04 258)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = ''
            el.style.color = 'oklch(0.50 0.025 258)'
          }}
        >
          <LogOut size={13} />
          Sair
        </button>
      </div>
    </div>
  )
}
