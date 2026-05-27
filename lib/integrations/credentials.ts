import { createSupabaseServiceClient } from '@/lib/supabase/server'
import type { IntegrationId } from '@/types'

export async function getCredential(id: IntegrationId) {
  const db = createSupabaseServiceClient()
  const { data } = await db.from('credentials').select('*').eq('id', id).single()
  return data
}

export async function saveCredential(
  id: IntegrationId,
  data: {
    access_token?: string
    refresh_token?: string
    expires_at?: string
    extra?: Record<string, unknown>
  }
) {
  const db = createSupabaseServiceClient()
  const { error } = await db.from('credentials').upsert({
    id,
    ...data,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Falha ao salvar credencial '${id}': ${error.message}`)
}

export async function getAllCredentials() {
  const db = createSupabaseServiceClient()
  const { data } = await db.from('credentials').select('id, access_token, expires_at, extra, updated_at')
  return data ?? []
}

export function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt) < new Date(Date.now() + 60_000)
}
