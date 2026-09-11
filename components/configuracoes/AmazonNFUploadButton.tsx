'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const B = { border: 'oklch(0.88 0.016 258)', bg: 'oklch(0.96 0.010 258)', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF' }

export function AmazonNFUploadButton() {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'relink' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setStatus('uploading'); setMsg('')
    try {
      const form = new FormData()
      Array.from(files).forEach(f => form.append('files', f))
      const res = await fetch('/api/sync/amazon/nfe-vendas', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.ok) { setMsg(data.error ?? 'Falha ao importar'); setStatus('error'); return }

      // recalcula as margens das vendas recém-vinculadas
      setStatus('relink')
      setMsg(`${data.vendas_vinculadas} vendas vinculadas — recalculando margens...`)
      await fetch('/api/landed-cost/relink', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 45 }),
      })
      setMsg(`✓ ${data.vendas_vinculadas} vendas Amazon vinculadas · ${data.notas_venda} notas de venda no arquivo · ${data.pedidos_ja_com_nf} já tinham NF · ${data.ignoradas_nao_venda} remessas ignoradas`)
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
