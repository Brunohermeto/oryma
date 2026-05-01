import { TopBar } from '@/components/layout/TopBar'
import { VendasAoVivoFeed } from '@/components/vendas/VendasAoVivoFeed'

export const dynamic = 'force-dynamic'

export default function VendasAoVivoPage() {
  return (
    <>
      <TopBar
        title="Vendas ao Vivo"
        subtitle="P&L detalhado por venda — atualiza automaticamente a cada 60s"
      />
      <div className="px-8 py-6">
        <VendasAoVivoFeed />
      </div>
    </>
  )
}
