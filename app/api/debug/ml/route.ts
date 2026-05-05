import { NextRequest, NextResponse } from 'next/server'
import { getCredential } from '@/lib/integrations/credentials'
import { getMercadoLivreSellerId, mlGet } from '@/lib/integrations/mercado-livre'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

// Rota de diagnóstico — só acessível com a senha do app
export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 1. Checa credenciais salvas
    const cred = await getCredential('mercado_livre')
    const extra = cred?.extra as Record<string, unknown> | null
    const sellerId = await getMercadoLivreSellerId()

    // 2. Testa busca de pedidos dos últimos 7 dias
    const now = new Date()
    const startDate = format(subDays(now, 7), 'yyyy-MM-dd')
    const endDate = format(now, 'yyyy-MM-dd')

    let ordersResult = null
    let ordersError = null
    try {
      const res = await mlGet<{ results: unknown[]; paging: { total: number } }>('/orders/search', {
        seller: sellerId ?? '',
        'order.status': 'paid',
        'order.date_created.from': `${startDate}T00:00:00.000-03:00`,
        'order.date_created.to': `${endDate}T23:59:59.000-03:00`,
        limit: '5',
        offset: '0',
      })
      ordersResult = { total: res.paging?.total, sample_count: res.results?.length }
    } catch (e) {
      ordersError = String(e)
    }

    return NextResponse.json({
      credentials: {
        has_access_token: !!cred?.access_token,
        has_refresh_token: !!cred?.refresh_token,
        expires_at: cred?.expires_at,
        seller_id: extra?.seller_id,
        seller_id_resolved: sellerId,
        updated_at: cred?.updated_at,
      },
      orders_test: {
        date_range: `${startDate} → ${endDate}`,
        result: ordersResult,
        error: ordersError,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
