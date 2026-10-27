/** GET /api/integrations/tiktok/teste?dias=7 — diagnóstico (só logado): loja e
 *  estrutura de pedidos SEM dados do comprador, para montar a sincronização. */
import { NextRequest, NextResponse } from 'next/server'
import { tiktokApi, tiktokCred } from '@/lib/integrations/tiktok'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SENSIVEL = /buyer|recipient|address|phone|name|email|cpf|tax_id|user_id|message/i
const limpa = (v: unknown): unknown => Array.isArray(v) ? v.slice(0, 3).map(limpa)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !SENSIVEL.test(k) || k === 'product_name').map(([k, x]) => [k, limpa(x)])) : v

export async function GET(request: NextRequest) {
  if (request.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { extra } = await tiktokCred()
    // ?pedido=ID → extrato financeiro do pedido (taxas, repasse) para montar as regras
    const pedido = request.nextUrl.searchParams.get('pedido')
    if (pedido && /^\d+$/.test(pedido))
      return NextResponse.json({ financeiro: limpa(await tiktokApi('GET', `/finance/202309/orders/${pedido}/statement_transactions`)) })
    const dias = Math.min(Number(request.nextUrl.searchParams.get('dias') ?? 7), 30)
    const agora = Math.floor(Date.now() / 1000)
    const d = await tiktokApi<{ orders?: unknown[]; total_count?: number }>('POST', '/order/202309/orders/search', { page_size: '20' },
      { create_time_ge: agora - dias * 86400, create_time_lt: agora })
    return NextResponse.json({ loja: extra.shop_name, total_pedidos: d.total_count, exemplo: limpa((d.orders ?? []).slice(0, 2)) })
  } catch (e) {
    return NextResponse.json({ erro: String(e).slice(0, 300) }, { status: 502 })
  }
}
