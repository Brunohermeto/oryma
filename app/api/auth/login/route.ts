import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const isDemo = !!process.env.DEMO_PASSWORD && password === process.env.DEMO_PASSWORD
  if (password !== process.env.APP_PASSWORD && !isDemo) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
  }
  const response = NextResponse.json({ ok: true })
  // demo entra com o próprio cookie: navega, mas as rotas de API (que exigem
  // APP_PASSWORD) recusam — leitura apenas
  response.cookies.set('mi_auth', password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return response
}
