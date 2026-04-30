import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  if (password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set('mi_auth', process.env.APP_PASSWORD!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return response
}
