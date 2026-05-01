'use client'
import { useRouter } from 'next/navigation'
import { Menu, ChevronDown } from 'lucide-react'
import { useState } from 'react'

interface TopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  const router = useRouter()
  const [showUser, setShowUser] = useState(false)

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div
      className="sticky top-0 z-10 px-4 md:px-6 py-3 flex items-center justify-between gap-4"
      style={{
        background: 'rgba(244,247,251,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(15,23,42,0.06)',
      }}
    >
      {/* Left: hamburger + title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="md:hidden p-1.5 rounded-lg"
          style={{ color: '#64748B' }}
          onClick={() => window.dispatchEvent(new CustomEvent('sidebar-toggle'))}
        >
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold leading-tight truncate" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)', letterSpacing: '-0.02em' }}>
            {title}
          </h1>
          {subtitle && (
            <p className="text-[12px] mt-0.5 truncate" style={{ color: '#64748B' }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right: actions + user */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {actions}

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUser(o => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all"
            style={{ background: 'white', border: '1px solid rgba(15,23,42,0.08)', color: '#0B1023' }}
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'linear-gradient(135deg, #125BFF, #7B61FF)', color: 'white' }}>
              R
            </div>
            <span className="text-[12px] font-medium hidden md:block">RAGALUMA</span>
            <ChevronDown size={12} style={{ color: '#64748B' }} />
          </button>
          {showUser && (
            <div className="absolute right-0 top-full mt-1 w-44 rounded-xl overflow-hidden shadow-lg z-50" style={{ background: 'white', border: '1px solid rgba(15,23,42,0.08)' }}>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-3 text-[13px] transition-colors hover:bg-gray-50"
                style={{ color: '#64748B' }}
              >
                Sair da conta
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
