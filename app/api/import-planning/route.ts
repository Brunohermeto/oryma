/**
 * API do Planejamento de Importação (Etapa 1).
 *
 * POST body.action:
 *  - save_profile  {profile}                 → upsert por root_sku
 *  - delete_profile {id}
 *  - save_plan     {plan, items}             → upsert pedido + substitui itens
 *  - delete_plan   {id}
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic         = 'force-dynamic'
export const preferredRegion = 'gru1'

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('mi_auth')?.value
  if (authCookie !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const db = createSupabaseServiceClient()

  if (body.action === 'save_profile') {
    const p = body.profile ?? {}
    if (!p.root_sku || !p.name) return NextResponse.json({ error: 'root_sku e name são obrigatórios' }, { status: 400 })
    const row = {
      root_sku: String(p.root_sku).trim().toUpperCase(),
      name: String(p.name),
      dias_producao: Number(p.dias_producao ?? 45),
      dias_embarque: Number(p.dias_embarque ?? 60),
      dias_santos:   Number(p.dias_santos ?? 100),
      dias_galpao:   Number(p.dias_galpao ?? 125),
      parcelas: Array.isArray(p.parcelas) ? p.parcelas : [],
      imposto_frete_ancora: p.imposto_frete_ancora ?? 'D2',
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await db.from('import_profiles')
      .upsert(row, { onConflict: 'root_sku' }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  }

  if (body.action === 'delete_profile') {
    const { error } = await db.from('import_profiles').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'save_plan') {
    const p = body.plan ?? {}
    if (!p.invoice || !p.order_date || !p.profile_id) {
      return NextResponse.json({ error: 'invoice, order_date e profile_id são obrigatórios' }, { status: 400 })
    }
    const row: Record<string, unknown> = {
      invoice: String(p.invoice).trim(),
      profile_id: p.profile_id,
      containers: Number(p.containers ?? 1),
      order_date: p.order_date,
      embarque_real: p.embarque_real || null,
      santos_real: p.santos_real || null,
      galpao_real: p.galpao_real || null,
      status_override: p.status_override || null,
      valor_fornecedor: Number(p.valor_fornecedor ?? 0),
      valor_imposto_frete: Number(p.valor_imposto_frete ?? 0),
      parcelas: Array.isArray(p.parcelas) && p.parcelas.length ? p.parcelas : null,
      notes: p.notes || null,
      done: !!p.done,
      compromissado: p.compromissado !== false,
      extras: Array.isArray(p.extras)
        ? p.extras.filter((e: any) => e?.label && Number(e.valor) > 0)
        : [],
      updated_at: new Date().toISOString(),
    }
    let planId = p.id as string | undefined
    if (planId) {
      const { error } = await db.from('import_plans').update(row).eq('id', planId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { data, error } = await db.from('import_plans').insert(row).select('id').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      planId = data.id
    }
    // Itens: substitui o conjunto (simples e sem estado órfão)
    await db.from('import_plan_items').delete().eq('plan_id', planId)
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((i: any) => i.sku && Number(i.quantity) > 0)
      .map((i: any) => ({
        plan_id: planId,
        product_id: i.product_id || null,
        sku: String(i.sku).trim(),
        quantity: Number(i.quantity),
      }))
    if (items.length) {
      const { error } = await db.from('import_plan_items').insert(items)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: planId })
  }

  if (body.action === 'delete_plan') {
    const { error } = await db.from('import_plans').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'action inválida' }, { status: 400 })
}
