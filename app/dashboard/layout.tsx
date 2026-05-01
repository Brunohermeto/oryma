import { Sidebar } from '@/components/layout/Sidebar'
import { OrymaIntelligence } from '@/components/ai/OrymaIntelligence'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{
      background: `
        radial-gradient(ellipse at top right, rgba(0, 214, 255, 0.14) 0%, transparent 45%),
        radial-gradient(ellipse at bottom left, rgba(123, 97, 255, 0.11) 0%, transparent 50%),
        #EEF2F8
      `
    }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto min-w-0">
        {children}
      </main>
      <OrymaIntelligence />
    </div>
  )
}
