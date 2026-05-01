export const dynamic = 'force-dynamic'

import { TopBar } from '@/components/layout/TopBar'
import { getAllCredentials } from '@/lib/integrations/credentials'
import { ConfigCard } from '@/components/configuracoes/ConfigCard'
import { BlingSyncButton } from '@/components/configuracoes/BlingSyncButton'
import { MarketplaceSyncButton } from '@/components/configuracoes/MarketplaceSyncButton'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return 'nunca'
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  return `há ${days} dia${days > 1 ? 's' : ''}`
}

export default async function ConfiguracoesPage() {
  const credentials = await getAllCredentials()
  const credMap = Object.fromEntries(credentials.map(c => [c.id, c]))

  // Último sync automático (cron) e manual por fonte
  const db = createSupabaseServiceClient()
  const { data: recentLogs } = await db
    .from('sync_logs')
    .select('source, sync_type, status, finished_at, records_synced')
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(20)

  const lastSync = {
    bling: recentLogs?.find(l => l.source === 'bling') ?? null,
    marketplaces: recentLogs?.find(l => l.source === 'marketplaces') ?? null,
  }

  return (
    <>
      <TopBar title="Configurações" subtitle="Conexões com marketplaces e sistemas" />
      <div className="px-8 py-6 space-y-4 max-w-2xl">

        {/* Sincronização automática — status */}
        <div
          className="rounded-xl px-5 py-4 flex items-start gap-3"
          style={{ background: 'oklch(0.95 0.03 258)', border: `1px solid oklch(0.85 0.04 258)` }}
        >
          <Clock size={16} className="mt-0.5 flex-shrink-0" style={{ color: B.brand }} />
          <div>
            <div className="text-[13px] font-semibold" style={{ color: B.text }}>
              Sincronização automática ativa
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: B.muted }}>
              O Oryma sincroniza NF-e e pedidos automaticamente às <strong>6h</strong> e <strong>20h</strong> todos os dias.
              Use os botões abaixo apenas se precisar forçar uma atualização imediata.
            </div>
            <div className="flex gap-4 mt-2">
              <span className="flex items-center gap-1 text-[11px]" style={{ color: B.muted }}>
                {lastSync.bling
                  ? <><CheckCircle2 size={11} style={{ color: '#16a34a' }} /> Bling: {formatRelativeTime(lastSync.bling.finished_at)} · {lastSync.bling.records_synced} NF-e</>
                  : <><AlertCircle size={11} style={{ color: '#d97706' }} /> Bling: nunca sincronizado</>
                }
              </span>
              <span className="flex items-center gap-1 text-[11px]" style={{ color: B.muted }}>
                {lastSync.marketplaces
                  ? <><CheckCircle2 size={11} style={{ color: '#16a34a' }} /> Marketplaces: {formatRelativeTime(lastSync.marketplaces.finished_at)} · {lastSync.marketplaces.records_synced} vendas</>
                  : <><AlertCircle size={11} style={{ color: '#d97706' }} /> Marketplaces: nunca sincronizado</>
                }
              </span>
            </div>
          </div>
        </div>

        {/* Integrações */}
        <div className="text-[11px] font-bold uppercase tracking-widest mt-4 mb-2" style={{ color: B.muted }}>
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
          Forçar Sincronização
        </div>

        <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
          <div className="font-semibold text-[15px] mb-0.5" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Bling — NF-e
          </div>
          <p className="text-[13px] mb-4" style={{ color: B.muted }}>
            Força sync dos últimos 7 dias. O cron automático (6h e 20h) cobre os últimos 90 dias.
          </p>
          <BlingSyncButton />
        </div>

        <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
          <div className="font-semibold text-[15px] mb-0.5" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            Marketplaces — Pedidos e Vendas
          </div>
          <p className="text-[13px] mb-4" style={{ color: B.muted }}>
            Força sync dos últimos 7 dias. O cron automático (6h e 20h) cobre os últimos 90 dias.
          </p>
          <MarketplaceSyncButton />
        </div>

      </div>
    </>
  )
}
