import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { parseNFeXml } from '@/lib/nfe/parser'
import { processImportNFe } from '@/lib/nfe/import-processor'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const files = formData.getAll('files') as File[]
  const db = createSupabaseServiceClient()
  const results: { file: string; orderId?: string; items?: number; error?: string }[] = []

  for (const file of files) {
    try {
      const xmlContent = await file.text()
      const nfe = parseNFeXml(xmlContent)
      const storagePath = `nfe-entrada/${Date.now()}-${file.name}`

      await db.storage
        .from('nfe-xml')
        .upload(storagePath, new Blob([xmlContent], { type: 'text/xml' }), { upsert: true })

      const { orderId, itemsProcessed } = await processImportNFe(nfe, storagePath)
      results.push({ file: file.name, orderId, items: itemsProcessed })
    } catch (err) {
      results.push({ file: file.name, error: String(err) })
    }
  }

  return NextResponse.json({ ok: true, results })
}
