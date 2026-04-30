export const dynamic = 'force-dynamic'

import { TopBar } from '@/components/layout/TopBar'
import { getAllCredentials } from '@/lib/integrations/credentials'
import { ConfigCard } from '@/components/configuracoes/ConfigCard'
import { BlingSyncButton } from '@/components/configuracoes/BlingSyncButton'
import { MarketplaceSyncButton } from '@/components/configuracoes/MarketplaceSyncButton'

export default async function ConfiguracoesPage() {
  const credentials = await getAllCredentials()
  const credMap = Object.fromEntries(credentials.map(c => [c.id, c]))

  return (
    <>
      <TopBar title="Configurações" subtitle="Conexões com marketplaces e sistemas" />
      <div className="px-8 py-6 space-y-4 max-w-2xl">
        <ConfigCard
          id="mercado_livre"
          name="Mercado Livre"
          description="Receita, tarifas e ADS — OAuth 2.0"
          connectUrl="/api/integrations/ml/connect"
          credential={credMap['mercado_livre']}
          type="oauth"
        />
        <ConfigCard
          id="shopee"
          name="Shopee"
          description="Receita, comissões e ADS — credenciais manuais"
          credential={credMap['shopee']}
          type="manual_shopee"
        />
        <ConfigCard
          id="amazon"
          name="Amazon SP-API"
          description="Receita, taxas FBA/DBA e ADS — LWA refresh token"
          credential={credMap['amazon']}
          type="manual_amazon"
        />
        <ConfigCard
          id="bling"
          name="Bling ERP"
          description="NF-e de entrada (série 0) e saída (série 2) — OAuth 2.0"
          connectUrl="/api/integrations/bling/connect"
          credential={credMap['bling']}
          type="oauth"
        />
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="font-semibold text-gray-900 mb-1">Sincronização Manual</div>
          <p className="text-sm text-gray-400 mb-3">Busca NF-e de entrada (série 0) e saída (série 2) dos últimos 90 dias no Bling.</p>
          <BlingSyncButton />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="font-semibold text-gray-900 mb-1">Sincronizar Vendas dos Marketplaces</div>
          <p className="text-sm text-gray-400 mb-3">Busca pedidos dos últimos 90 dias em Mercado Livre, Shopee e Amazon.</p>
          <MarketplaceSyncButton />
        </div>
      </div>
    </>
  )
}
