import { Sidebar } from '@/components/layout/Sidebar'
import { OrymaIntelligence } from '@/components/ai/OrymaIntelligence'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: 'oklch(0.96 0.010 258)' }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto min-w-0">
        {children}
      </main>
      <OrymaIntelligence />
    </div>
  )
}
