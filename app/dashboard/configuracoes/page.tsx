export const dynamic = 'force-dynamic'
export const preferredRegion = 'gru1'

import { TopBar } from '@/components/layout/TopBar'
import { getAllCredentials } from '@/lib/integrations/credentials'
import { ConfigCard } from '@/components/configuracoes/ConfigCard'
import { BlingSyncButton } from '@/components/configuracoes/BlingSyncButton'
import { MarketplaceSyncButton } from '@/components/configuracoes/MarketplaceSyncButton'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCredential, isTokenExpired } from '@/lib/integrations/credentials'
import { Clock, CheckCircle2, AlertCircle, WifiOff, Hourglass } from 'lucide-react'

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

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_error?: string; connected?: string }>
}) {
  const params = await searchParams
  const oauthError   = params.oauth_error ? decodeURIComponent(params.oauth_error) : null
  const oauthSuccess = params.connected ?? null

  const credentials = await getAllCredentials()
  const credMap = Object.fromEntries(credentials.map(c => [c.id, c]))

  // Último sync bem-sucedido por fonte
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

  // Saúde dos tokens
  const [blingCred, mlCred] = await Promise.all([
    getCredential('bling'),
    getCredential('mercado_livre'),
  ])
  const blingTokenOk = !!blingCred?.access_token && !isTokenExpired(blingCred.expires_at)
  const mlTokenOk    = !!mlCred?.access_token    && !isTokenExpired(mlCred.expires_at)

  return (
    <>
      <TopBar title="Configurações" subtitle="Conexões com marketplaces e sistemas" />
      <div className="px-4 md:px-8 py-6 space-y-4 max-w-2xl">

        {/* ── Alertas de saúde das conexões ── */}
        {(!blingTokenOk || !mlTokenOk) && (
          <div className="rounded-xl px-5 py-4 flex items-start gap-3"
            style={{ background: 'oklch(0.97 0.04 25)', border: '1px solid oklch(0.88 0.06 25)' }}>
            <WifiOff size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#dc2626' }} />
            <div>
              <div className="text-[13px] font-semibold" style={{ color: '#991b1b' }}>
                Conexão perdida — token expirado
              </div>
              <div className="text-[12px] mt-1 space-y-0.5" style={{ color: '#7f1d1d' }}>
                {!blingTokenOk && <div>• <strong>Bling:</strong> clique em <strong>Conectar</strong> abaixo para reconectar</div>}
                {!mlTokenOk    && <div>• <strong>Mercado Livre:</strong> clique em <strong>Conectar</strong> abaixo para reconectar (use a conta BEBÊ LUXE)</div>}
              </div>
            </div>
          </div>
        )}

        {/* Feedback OAuth */}
        {oauthError && (
          <div className="rounded-xl px-5 py-4 flex items-start gap-3" style={{ background: 'oklch(0.97 0.03 25)', border: '1px solid oklch(0.88 0.06 25)' }}>
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#dc2626' }} />
            <div>
              <div className="text-[13px] font-semibold" style={{ color: '#991b1b' }}>Erro ao conectar via OAuth</div>
              <div className="text-[12px] mt-0.5 font-mono" style={{ color: '#7f1d1d' }}>{oauthError}</div>
            </div>
          </div>
        )}
        {oauthSuccess && (
          <div className="rounded-xl px-5 py-4 flex items-center gap-3" style={{ background: 'oklch(0.96 0.06 145)', border: '1px solid oklch(0.88 0.10 145)' }}>
            <CheckCircle2 size={16} style={{ color: '#16a34a' }} />
            <div className="text-[13px] font-semibold" style={{ color: '#14532d' }}>
              {oauthSuccess === 'bling' ? 'Bling conectado com sucesso!' : 'Mercado Livre conectado com sucesso!'}
            </div>
          </div>
        )}

        {/* Status da sincronização automática */}
        <div
          className="rounded-xl px-5 py-4 flex items-start gap-3"
          style={{ background: 'oklch(0.95 0.03 258)', border: `1px solid oklch(0.85 0.04 258)` }}
        >
          <Clock size={16} className="mt-0.5 flex-shrink-0" style={{ color: B.brand }} />
          <div>
            <div className="text-[13px] font-semibold" style={{ color: B.text }}>
              Sincronização automática
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: B.muted }}>
              O Oryma sincroniza pedidos, NF-e, tarifas e margens automaticamente todos os dias.
            </div>
            <div className="flex gap-4 mt-2">
              <span className="flex items-center gap-1 text-[11px]" style={{ color: B.muted }}>
                {lastSync.bling
                  ? <><CheckCircle2 size={11} style={{ color: '#16a34a' }} /> Bling: {formatRelativeTime(lastSync.bling.finished_at)}</>
                  : <><AlertCircle size={11} style={{ color: '#d97706' }} /> Bling: nunca sincronizado</>
                }
              </span>
              <span className="flex items-center gap-1 text-[11px]" style={{ color: B.muted }}>
                {lastSync.marketplaces
                  ? <><CheckCircle2 size={11} style={{ color: '#16a34a' }} /> Vendas: {formatRelativeTime(lastSync.marketplaces.finished_at)}</>
                  : <><AlertCircle size={11} style={{ color: '#d97706' }} /> Vendas: nunca sincronizado</>
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
          id="mercado_livre"
          name="Mercado Livre"
          description="Pedidos, NF-e, tarifas e ADS — conta BEBÊ LUXE"
          guide="https://developers.mercadolivre.com.br"
          connectUrl="/api/integrations/ml/connect"
          credential={credMap['mercado_livre']}
          type="oauth"
        />

        <ConfigCard
          id="shopee"
          name="Shopee"
          description="Pedidos, comissões e ADS"
          guide="https://open.shopee.com"
          credential={credMap['shopee']}
          type="manual_shopee"
        />

        <ConfigCard
          id="amazon"
          name="Amazon SP-API"
          description="Pedidos, taxas FBA e ADS"
          guide="https://developer-docs.amazon.com/sp-api"
          credential={credMap['amazon']}
          type="manual_amazon"
        />

        {/* Magalu — integração ainda não construída */}
        <div className="bg-white rounded-xl p-5 flex items-center justify-between" style={{ border: `1px solid ${B.border}`, opacity: 0.7 }}>
          <div>
            <div className="font-semibold text-[15px]" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
              Magalu
            </div>
            <p className="text-[13px]" style={{ color: B.muted }}>
              Pedidos e comissões — integração em desenvolvimento
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: B.bgSubtle, color: B.muted }}>
            <Hourglass size={12} /> Em breve
          </span>
        </div>

        <ConfigCard
          id="bling"
          name="Bling ERP"
          description="NF-e de entrada (compras/importação) e saída (vendas)"
          guide="https://developer.bling.com.br"
          connectUrl="/api/integrations/bling/connect"
          credential={credMap['bling']}
          type="oauth"
        />

        {/* Sincronização manual */}
        <div className="text-[11px] font-bold uppercase tracking-widest mt-6 mb-2" style={{ color: B.muted }}>
          Forçar Sincronização
        </div>

        <div className="bg-white rounded-xl p-5 space-y-4" style={{ border: `1px solid ${B.border}` }}>
          <div>
            <div className="font-semibold text-[15px] mb-0.5" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
              Vendas dos marketplaces
            </div>
            <p className="text-[13px] mb-3" style={{ color: B.muted }}>
              Puxa os pedidos pagos dos últimos dias imediatamente, sem esperar o ciclo automático.
            </p>
            <MarketplaceSyncButton />
          </div>
          <div className="pt-4" style={{ borderTop: `1px solid ${B.bgSubtle}` }}>
            <div className="font-semibold text-[15px] mb-0.5" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
              NF-e do Bling
            </div>
            <p className="text-[13px] mb-3" style={{ color: B.muted }}>
              Vincula as notas fiscais emitidas às vendas (impostos e margens).
            </p>
            <BlingSyncButton />
          </div>
        </div>

        {/* CMV manual para produtos sem NF-e */}
        <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
          <div className="font-semibold text-[15px] mb-0.5" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>
            CMV Manual
          </div>
          <p className="text-[13px] mb-4" style={{ color: B.muted }}>
            Informe o custo para produtos que ainda não têm NF-e de entrada no sistema.
          </p>
          <a
            href="/dashboard/configuracoes/cmp-manual"
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg"
            style={{ background: B.brand, color: 'white' }}
          >
            Cadastrar CMV manualmente →
          </a>
        </div>

      </div>
    </>
  )
}
