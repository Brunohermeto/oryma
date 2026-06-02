/**
 * GET /api/debug/bling-nfe-detail?id=25942359181
 * Retorna o JSON completo do Bling para uma NF-e específica.
 * Use para entender os campos disponíveis para matching.
 */
import { NextRequest, NextResponse } from 'next/server'
import { blingGet } from '@/lib/integrations/bling'

export const dynamic     = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nfeId = request.nextUrl.searchParams.get('id')
  if (!nfeId) return NextResponse.json({ error: 'Passe ?id=BLING_NFE_ID' }, { status: 400 })

  try {
    const detail = await blingGet<Record<string, unknown>>(`/nfe/${nfeId}`)
    return NextResponse.json({ nfe_id: nfeId, raw: detail })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
