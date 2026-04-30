import { NextResponse } from 'next/server'
import { getMercadoLivreAuthUrl } from '@/lib/integrations/mercado-livre'
export async function GET() {
  return NextResponse.redirect(getMercadoLivreAuthUrl())
}
