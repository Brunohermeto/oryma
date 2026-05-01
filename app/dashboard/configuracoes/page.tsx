export const dynamic = 'force-dynamic'

import { TopBar } from '@/components/layout/TopBar'
import { getAllCredentials } from '@/lib/integrations/credentials'
import { ConfigCard } from '@/components/configuracoes/ConfigCard'
import { BlingSyncButton } from '@/components/configuracoes/BlingSyncButton'
import { MarketplaceSyncButton } from '@/components/configuracoes/MarketplaceSyncButton'
import { RefreshCw } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

export default async function ConfiguracoesPage() {
  const credentials = await getAllCredentials()
  const credMap = Object.fromEntries(credentials.map(c => [c.id, c]))

  return (
    <>
      <TopBar title="Configurações" subtitle="Conexões com marketplaces e sistemas" />
      <div className="px-8 py-6 space-y-4 max-w-2xl">

        {/* Integrações */}
        <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: B.muted }}>
          Integrações
        </div>

        <ConfigCard
          id="bling"
          name="Bling ERP"
          description="NF-e de entrada (importação) e saída (vendas) — OAuth 2.0"
          guide="https://developer.bling.com.br"
          connectUrl="/api/integrations/bling/connect"
          credential={credMap['bling']}
          type="oauth"
        />

        <ConfigCard
          id="mercado_livre"
          name="Mercado Livre"
          description="Pedidos, tarifas e ADS — OAuth 2.0"
          guide="https://developers.mercadolivre.com.br"
          connectUrl="/api/integrations/ml/connect"
          credential={credMap['mercado_livre']}
          type="oauth"
        />

        <ConfigCard
          id="shopee"
          name="Shopee"
          description="Pedidos, comissões e ADS — credenciais manuais"
          guide="https://open.shopee.com"
          credential={credMap['shopee']}
          type="manual_shopee"
        />

        <ConfigCard
          id="amazon"
          name="Amazon SP-API"
          description="Pedidos, taxas FBA e ADS — LWA refresh token"
          guide="https://developer-docs.amazon.com/sp-api"
          credential={credMap['amazon']}
          type="manual_amazon"
        />

        {/* Sincronização manual */}
        <div className="text-[11px] font-bold uppercase tracking-widest mt-6 mb-2" style={{ color: B.muted }}>
          Sincronização Manual
        </div>

        <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
          <div className="font-semibold text-[15px] mb-0.5" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Bling — NF-e
          </div>
          <p className="text-[13px] mb-4" style={{ color: B.muted }}>
            Busca NF-e de entrada (série 0, CFOP 3102) e saída (série 2) dos últimos 90 dias.
          </p>
          <BlingSyncButton />
        </div>

        <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
          <div className="font-semibold text-[15px] mb-0.5" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Marketplaces — Pedidos e Vendas
          </div>
          <p className="text-[13px] mb-4" style={{ color: B.muted }}>
            Busca pedidos dos últimos 90 dias em Mercado Livre, Shopee e Amazon.
          </p>
          <MarketplaceSyncButton />
        </div>

      </div>
    </>
  )
}
