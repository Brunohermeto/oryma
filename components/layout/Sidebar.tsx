'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '⊞', exact: true },
  { href: '/dashboard/dre', label: 'DRE', icon: '📊' },
  { href: '/dashboard/tributario', label: 'Painel Tributário', icon: '🧾' },
  { href: '/dashboard/produtos', label: 'Custo por Produto', icon: '📦' },
  { href: '/dashboard/vendas', label: 'Feed de Vendas', icon: '💰' },
  { href: '/dashboard/velocidade', label: 'Velocidade de Venda', icon: '⚡' },
  { href: '/dashboard/precificacao', label: 'Simulador de Preço', icon: '🎯' },
  { href: '/dashboard/importacoes', label: 'NF-e / Importações', icon: '🗂️' },
  { href: '/dashboard/despesas', label: 'Despesas Operacionais', icon: '📋' },
  { href: '/dashboard/configuracoes', label: 'Configurações', icon: '⚙️' },
]

export function Sidebar() {
  const pathname = usePathname()

  function isActive(item: typeof navItems[0]) {
    if (item.exact) return pathname === item.href
    return pathname.startsWith(item.href)
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col min-h-screen" style={{ background: '#0f2847' }}>
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm">
            MI
          </div>
          <div>
            <div className="text-white font-semibold text-sm">MarketIntel</div>
            <div className="text-white/40 text-xs">RAGALUMA</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive(item)
                ? 'bg-blue-600 text-white'
                : 'text-white/65 hover:bg-white/10 hover:text-white'
            )}
          >
            <span className="text-base leading-none">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-white/10">
        <div className="text-white/40 text-xs text-center">MCL Informática LTDA</div>
      </div>
    </aside>
  )
}
