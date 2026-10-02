'use client'
/**
 * Upload quinzenal dos relatórios de Ads (Shopee / Amazon) + vínculo de campanha
 * sem produto → produto (feito uma vez; vale para os próximos uploads).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.97 0.008 258)', text: '#0B1023', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }
type Pendente = { marketplace: string; campaign_id: string; campaign_name: string | null; cost: number }

export function AdsUpload({ produtos, pendentes }: { produtos: Array<{ sku: string; name: string }>; pendentes: Pendente[] }) {
  const router = useRouter()
  const [canal, setCanal] = useState('shopee')
  const [de, setDe] = useState(''); const [ate, setAte] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  const [escolha, setEscolha] = useState<Record<string, string>>({})

  async function enviar() {
    if (!file || !de || !ate) { setMsg('Escolha o canal, o período (de/até) e o arquivo.'); return }
    setBusy(true); setMsg('Lendo o relatório e rateando nas vendas…')
    const fd = new FormData()
    fd.set('canal', canal); fd.set('de', de); fd.set('ate', ate); fd.set('file', file)
    const res = await fetch('/api/ads/upload', { method: 'POST', body: fd })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(`Erro: ${d.error ?? res.status}`); return }
    setMsg(`✓ ${d.anuncios} anúncios · R$ ${Number(d.gasto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} rateados em ${d.vendas_rateadas} vendas`
      + (d.sem_produto?.length ? ` · ${d.sem_produto.length} campanha(s) sem produto — vincule abaixo` : ''))
    router.refresh()
  }

  async function vincular(p: Pendente) {
    const sku = escolha[p.campaign_id]
    if (!sku) return
    setBusy(true); setMsg(`Vinculando "${p.campaign_name}"…`)
    const res = await fetch('/api/ads/map', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketplace: p.marketplace, campaign_id: p.campaign_id, campaign_name: p.campaign_name, // '*' = campanha geral: sem produto de propósito (rateia no canal), não volta como pendente
      product_skus: sku === '__geral__' ? ['*'] : [sku] }),
    })
    setBusy(false)
    setMsg(res.ok ? `✓ "${p.campaign_name}" vinculada` : 'Erro ao vincular')
    router.refresh()
  }

  const input = { border: `1px solid ${B.border}`, color: B.text } as const
  return (
    <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="text-sm font-semibold mb-1" style={{ color: B.text }}>Enviar relatório de Ads (a cada 15 dias)</div>
      <div className="text-[12px] mb-3" style={{ color: B.muted }}>
        Shopee: Marketing → Shopee Ads → Exportar (“Dados Gerais de Anúncios”). Amazon: tela de Campanhas → Exportar (informe o mesmo período da tela).
        Mercado Livre entra sozinho todo dia. Reenviar o mesmo período substitui o anterior.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={canal} onChange={e => setCanal(e.target.value)} className="text-[13px] px-2 py-1.5 rounded-lg" style={input}>
          <option value="shopee">Shopee</option><option value="amazon">Amazon</option>
        </select>
        <span className="text-[12px]" style={{ color: B.muted }}>de</span>
        <input type="date" value={de} onChange={e => setDe(e.target.value)} className="text-[13px] px-2 py-1 rounded-lg" style={input} />
        <span className="text-[12px]" style={{ color: B.muted }}>até</span>
        <input type="date" value={ate} onChange={e => setAte(e.target.value)} className="text-[13px] px-2 py-1 rounded-lg" style={input} />
        <input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
        <button onClick={enviar} disabled={busy} className="text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                style={{ background: B.brand, color: 'white', border: 'none', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Processando…' : 'Enviar'}
        </button>
      </div>
      {msg && <div className="text-[12px] mt-3 px-3 py-2 rounded-lg" style={{ background: B.bg, color: msg.startsWith('Erro') ? '#dc2626' : B.text }}>{msg}</div>}

      {pendentes.length > 0 && (
        <div className="mt-4">
          <div className="text-[12px] font-semibold mb-2" style={{ color: '#d97706' }}>
            Campanhas com gasto e sem produto ({pendentes.length}) — escolha uma vez; vale para os próximos uploads
          </div>
          {pendentes.map(p => (
            <div key={p.marketplace + p.campaign_id} className="flex flex-wrap items-center gap-2 py-1">
              <span className="text-[12px] w-[340px] truncate" style={{ color: B.text }} title={p.campaign_name ?? ''}>
                {p.marketplace === 'amazon' ? 'Amazon' : 'Shopee'} · {p.campaign_name}
              </span>
              <span className="text-[12px] w-24 text-right" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>
                R$ {p.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
              <select value={escolha[p.campaign_id] ?? ''} onChange={e => setEscolha({ ...escolha, [p.campaign_id]: e.target.value })}
                      className="text-[12px] px-2 py-1 rounded-lg max-w-[320px]" style={input}>
                <option value="">— escolher produto —</option>
                <option value="__geral__">Campanha geral (rateia em todas as vendas do canal)</option>
                {produtos.map(pr => <option key={pr.sku} value={pr.sku}>{pr.sku} · {pr.name.slice(0, 40)}</option>)}
              </select>
              <button onClick={() => vincular(p)} disabled={busy || !escolha[p.campaign_id]} className="text-[12px] px-2 py-1 rounded-lg cursor-pointer"
                      style={{ background: B.bg, color: B.brand, border: `1px solid ${B.border}` }}>vincular</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
