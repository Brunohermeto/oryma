import { cookies } from 'next/headers'
import { Sidebar } from '@/components/layout/Sidebar'
import { OrymaIntelligence } from '@/components/ai/OrymaIntelligence'
import { DemoBlur } from '@/components/layout/DemoBlur'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isDemo = !!process.env.DEMO_PASSWORD &&
    (await cookies()).get('mi_auth')?.value === process.env.DEMO_PASSWORD
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
      {isDemo && <DemoBlur />}
    </div>
  )
}
