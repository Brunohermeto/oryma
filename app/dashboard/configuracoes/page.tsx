export const dynamic = 'force-dynamic'

import { TopBar } from '@/components/layout/TopBar'
import { getAllCredentials } from '@/lib/integrations/credentials'
import { ConfigCard } from '@/components/configuracoes/ConfigCard'

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
      </div>
    </>
  )
}
