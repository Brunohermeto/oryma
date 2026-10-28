'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

export function AmazonNFUploadButton() {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'relink' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // O .zip do mês inteiro passava dos 60s da Vercel numa chamada só ("An error o…"
  // em vez de JSON). Agora a tela abre o .zip e envia as notas em lotes de 40.
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setStatus('uploading'); setMsg('Abrindo o arquivo…')
    try {
      const { unzipSync, strFromU8 } = await import('fflate')
      const xmls: Array<{ nome: string; conteudo: string }> = []
      for (const f of Array.from(files)) {
        const nome = f.name.toLowerCase()
        if (nome.endsWith('.zip')) {
          for (const [n, u8] of Object.entries(unzipSync(new Uint8Array(await f.arrayBuffer()))))
            if (n.toLowerCase().endsWith('.xml')) xmls.push({ nome: n.split('/').pop() ?? n, conteudo: strFromU8(u8) })
        } else if (nome.endsWith('.xml')) xmls.push({ nome: f.name, conteudo: await f.text() })
      }
      if (!xmls.length) { setMsg('Nenhum XML encontrado no arquivo.'); setStatus('error'); return }

      const tot = { notas_venda: 0, vendas_vinculadas: 0, pedidos_ja_com_nf: 0, ignoradas_nao_venda: 0 }
      const LOTE = 40
      for (let i = 0; i < xmls.length; i += LOTE) {
        setMsg(`Enviando notas ${i + 1}–${Math.min(i + LOTE, xmls.length)} de ${xmls.length}…`)
        const form = new FormData()
        for (const x of xmls.slice(i, i + LOTE)) form.append('files', new File([x.conteudo], x.nome, { type: 'text/xml' }))
        const res = await fetch('/api/sync/amazon/nfe-vendas', { method: 'POST', body: form })
        const data = await res.json().catch(() => ({ ok: false, error: `servidor respondeu ${res.status} no lote ${Math.floor(i / LOTE) + 1}` }))
        if (!res.ok || !data.ok) { setMsg(`${data.error ?? 'Falha ao importar'} — reenviar o mesmo arquivo é seguro`); setStatus('error'); return }
        for (const k of Object.keys(tot) as Array<keyof typeof tot>) tot[k] += Number(data[k] ?? 0)
      }

      // recalcula as margens das vendas recém-vinculadas
      setStatus('relink')
      setMsg(`${tot.vendas_vinculadas} vendas vinculadas — recalculando margens...`)
      await fetch('/api/landed-cost/relink', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 45 }),
      }).catch(() => null)
      setMsg(`✓ ${tot.vendas_vinculadas} vendas Amazon vinculadas · ${tot.notas_venda} notas de venda no arquivo · ${tot.pedidos_ja_com_nf} já tinham NF · ${tot.ignoradas_nao_venda} remessas ignoradas`)
      setStatus('done')
      router.refresh()
    } catch (err) {
      setMsg(`Erro: ${String(err)}`); setStatus('error')
    }
  }

  const busy = status === 'uploading' || status === 'relink'
  return (
    <div className="bg-white rounded-xl p-5" style={{ border: `1px solid ${B.border}` }}>
      <div className="font-semibold text-[15px] mb-0.5" style={{ color: '#0B1023', fontFamily: 'var(--font-sora)' }}>
        Importar NF-e de Venda da Amazon (FBA)
      </div>
      <p className="text-[13px] mb-4" style={{ color: B.muted }}>
        A Amazon FBA não emite a nota pelo Bling. Baixe o pacote de XMLs no faturador
        (Seller Central) e solte o <b>.zip</b> aqui — o sistema separa só as notas de venda,
        casa por pedido e grava os impostos. Vendas sem imposto viram margem calculada.
      </p>
      <div
        className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors"
        style={{ borderColor: B.border }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (!busy) handleFiles(e.dataTransfer.files) }}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".zip,.xml" multiple className="hidden"
          onChange={e => handleFiles(e.target.files)} />
        <div className="text-2xl mb-1">📦</div>
        <p className="text-sm font-medium" style={{ color: busy ? B.muted : '#0B1023' }}>
          {status === 'uploading' ? 'Lendo XMLs e vinculando...'
            : status === 'relink' ? 'Recalculando margens...'
            : 'Arraste o .zip do faturador (ou os .xml) aqui'}
        </p>
        <p className="text-xs mt-1" style={{ color: B.muted }}>.zip ou vários .xml</p>
      </div>
      {msg && (
        <div className="text-sm mt-3 rounded-lg px-4 py-2"
          style={{
            background: status === 'error' ? '#fef2f2' : status === 'done' ? '#f0fdf4' : B.bg,
            color: status === 'error' ? '#dc2626' : status === 'done' ? '#15803d' : B.muted,
            border: `1px solid ${status === 'error' ? '#fecaca' : status === 'done' ? '#bbf7d0' : B.border}`,
          }}>
          {msg}
        </div>
      )}
    </div>
  )
}
