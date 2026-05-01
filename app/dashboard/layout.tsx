import { Sidebar } from '@/components/layout/Sidebar'
import { OrymaIntelligence } from '@/components/ai/OrymaIntelligence'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{
      background: `
        radial-gradient(circle at top right, rgba(0, 214, 255, 0.07), transparent 30%),
        radial-gradient(circle at bottom left, rgba(123, 97, 255, 0.06), transparent 35%),
        #F4F7FB
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
