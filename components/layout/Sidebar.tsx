'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  BarChart3,
  Package,
  Zap,
  Target,
  ShoppingBag,
  Activity,
  FolderOpen,
  ClipboardList,
  Settings,
  X,
  BellRing,
  GitMerge,
} from 'lucide-react'

// Manual de marca Oryma
const C = {
  bg:         '#0B1023',   // Azul Noite
  border:     'rgba(255,255,255,0.08)',
  hover:      'rgba(255,255,255,0.07)',
  active:     'rgba(18,91,255,0.25)',
  activeDot:  '#125BFF',
  text:       'rgba(255,255,255,0.55)',
  textHover:  'rgba(255,255,255,0.90)',
  textActive: '#ffffff',
  label:      'rgba(255,255,255,0.28)',
  footer:     'rgba(255,255,255,0.22)',
}

const navGroups = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard',              label: 'Visão Geral',          icon: LayoutDashboard, exact: true },
      { href: '/dashboard/tributario',   label: 'Alertas & Insights',   icon: BellRing },
      { href: '/dashboard/dre',          label: 'Conciliação',          icon: GitMerge },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { href: '/dashboard/dre',          label: 'DRE Gerencial',        icon: BarChart3 },
      { href: '/dashboard/despesas',     label: 'Despesas Operacionais',icon: ClipboardList },
    ],
  },
  {
    label: 'Produtos',
    items: [
      { href: '/dashboard/produtos',     label: 'Custo Real por Produto', icon: Package },
      { href: '/dashboard/velocidade',   label: 'Giro e Velocidade',    icon: Zap },
      { href: '/dashboard/precificacao', label: 'Simulador de Margem',  icon: Target },
    ],
  },
  {
    label: 'Operação',
    items: [
      { href: '/dashboard/vendas',         label: 'Feed de Vendas',      icon: ShoppingBag },
      { href: '/dashboard/vendas-ao-vivo', label: 'Vendas ao Vivo',      icon: Activity },
      { href: '/dashboard/importacoes',    label: 'NF-e / Importações',  icon: FolderOpen },
      { href: '/dashboard/configuracoes',  label: 'Configurações',       icon: Settings },
    ],
  },
]

function OrymaIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#125BFF" />
          <stop offset="50%"  stopColor="#00D6FF" />
          <stop offset="100%" stopColor="#7B61FF" />
        </linearGradient>
      </defs>
      {/* Arco superior */}
      <path
        d="M 8 20 A 12 12 0 0 1 32 20"
        stroke="url(#og)" strokeWidth="2.2" fill="none" strokeLinecap="round"
      />
      {/* Arco inferior */}
      <path
        d="M 32 22 A 12 12 0 0 1 8 22"
        stroke="url(#og)" strokeWidth="2.2" fill="none" strokeLinecap="round"
      />
      {/* Linha horizontal esquerda */}
      <line x1="3" y1="21" x2="13" y2="21" stroke="url(#og)" strokeWidth="2.2" strokeLinecap="round"/>
      {/* Linha horizontal direita */}
      <line x1="27" y1="21" x2="37" y2="21" stroke="url(#og)" strokeWidth="2.2" strokeLinecap="round"/>
      {/* Círculo central */}
      <circle cx="20" cy="21" r="4" fill="url(#og)" />
      {/* Nó superior direito */}
      <circle cx="31" cy="10" r="2.2" fill="url(#og)" opacity="0.8"/>
      {/* Nó inferior esquerdo */}
      <circle cx="9" cy="32" r="2.2" fill="url(#og)" opacity="0.8"/>
    </svg>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(o => !o)
    window.addEventListener('sidebar-toggle', handler)
    return () => window.removeEventListener('sidebar-toggle', handler)
  }, [])

  function isActive(item: { href: string; exact?: boolean }) {
    if (item.exact) return pathname === item.href
    return pathname.startsWith(item.href)
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[220px] flex-shrink-0 flex flex-col min-h-screen md:relative md:translate-x-0 transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        style={{ background: C.bg }}
      >
      {/* X close button — mobile only */}
      <button
        className="md:hidden absolute top-3 right-3"
        onClick={() => setOpen(false)}
        style={{ color: C.text }}
      >
        <X size={16} />
      </button>

      {/* Logo */}
      <div
        className="px-4 py-5 flex items-center gap-2.5"
        style={{ borderBottom: `1px solid ${C.border}` }}
      >
        <OrymaIcon size={36} />
        <div>
          <div
            className="text-[15px] font-semibold leading-tight tracking-tight"
            style={{ color: '#ffffff', fontFamily: 'var(--font-sora)' }}
          >
            Oryma
          </div>
          <div className="text-[10px] leading-tight mt-0.5 tracking-wide" style={{ color: C.label }}>
            RAGALUMA
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 overflow-y-auto flex flex-col gap-4">
        {navGroups.map(group => (
          <div key={group.label}>
            <div
              className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: C.label }}
            >
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map(item => {
                const active = isActive(item)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn('flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all duration-150')}
                    style={active
                      ? { background: 'linear-gradient(90deg, rgba(18,91,255,0.20), rgba(0,214,255,0.10))', color: C.textActive, fontWeight: 600, position: 'relative' }
                      : { color: C.text, position: 'relative' }
                    }
                    onMouseEnter={e => {
                      if (!active) {
                        const el = e.currentTarget as HTMLElement
                        el.style.background = C.hover
                        el.style.color = C.textHover
                      }
                    }}
                    onMouseLeave={e => {
                      if (!active) {
                        const el = e.currentTarget as HTMLElement
                        el.style.background = ''
                        el.style.color = C.text
                      }
                    }}
                  >
                    {/* Indicador ativo */}
                    {active && (
                      <div style={{ position: 'absolute', left: 0, top: '20%', height: '60%', width: 3, borderRadius: 2, background: 'linear-gradient(180deg, #125BFF, #00D6FF)' }} />
                    )}
                    <Icon size={14} strokeWidth={active ? 2.5 : 1.75} className="flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User section */}
      <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: 'linear-gradient(135deg, #125BFF, #7B61FF)', color: 'white' }}>
            R
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>RAGALUMA</div>
            <div className="text-[10px]" style={{ color: C.label }}>Plano Ativo</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="px-5 py-3"
        style={{ borderTop: `1px solid ${C.border}` }}
      >
        <div className="text-[10px] text-center" style={{ color: C.label }}>
          v1.0 · Oryma Intelligence
        </div>
      </div>
    </aside>
    </>
  )
}
