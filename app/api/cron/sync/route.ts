import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const headers = {
    'Content-Type': 'application/json',
    'x-cron-secret': process.env.CRON_SECRET!,
  }

  const [blRes, mpRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/sync/bling`, { method: 'POST', headers }),
    fetch(`${baseUrl}/api/sync/marketplaces`, { method: 'POST', headers }),
  ])

  return NextResponse.json({
    ok: true,
    bling: blRes.status === 'fulfilled' ? 'triggered' : 'failed',
    marketplaces: mpRes.status === 'fulfilled' ? 'triggered' : 'failed',
  })
}
