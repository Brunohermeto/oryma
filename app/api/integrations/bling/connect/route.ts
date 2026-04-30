import { NextResponse } from 'next/server'
import { getBlingAuthUrl } from '@/lib/integrations/bling'
export async function GET() {
  return NextResponse.redirect(getBlingAuthUrl())
}
