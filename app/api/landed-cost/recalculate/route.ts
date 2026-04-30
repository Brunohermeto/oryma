import { NextRequest, NextResponse } from 'next/server'
import { recalculateLandedCost } from '@/lib/landed-cost/calculator'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { import_order_id } = await request.json()
  if (!import_order_id) {
    return NextResponse.json({ error: 'import_order_id required' }, { status: 400 })
  }

  try {
    await recalculateLandedCost(import_order_id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
