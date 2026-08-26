'use client'
import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'

/** Seletor de período (De/Até) + atalhos rápidos para velocidade/cobertura. */
export function PeriodoFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [de, setDe] = useState(from)
  const [ate, setAte] = useState(to)

  const aplicar = (f: string, t: string) => router.push(`${pathname}?from=${f}&to=${t}`)
  const atalho = (dias: number) => {
    const t = new Date()
    const f = new Date(t.getTime() - dias * 86400000)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    aplicar(iso(f), iso(t))
  }

  const chip = { fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, background: 'oklch(0.96 0.010 258)', color: '#125BFF', border: 'none', cursor: 'pointer' } as const

  return (
    <div className="flex gap-2 flex-wrap items-end">
      <span className="text-[12px] self-center" style={{ color: 'oklch(0.55 0.02 258)' }}>Período:</span>
      <label className="text-[11px]" style={{ color: 'oklch(0.55 0.02 258)' }}>
        De
        <input type="date" value={de} onChange={e => setDe(e.target.value)}
          className="block mt-0.5 h-8 text-[13px] px-2 rounded-md border" style={{ borderColor: 'oklch(0.88 0.016 258)' }} />
      </label>
      <label className="text-[11px]" style={{ color: 'oklch(0.55 0.02 258)' }}>
        Até
        <input type="date" value={ate} onChange={e => setAte(e.target.value)}
          className="block mt-0.5 h-8 text-[13px] px-2 rounded-md border" style={{ borderColor: 'oklch(0.88 0.016 258)' }} />
      </label>
      <button onClick={() => aplicar(de, ate)} className="h-8 px-4 rounded-md text-[12px] font-bold" style={{ background: '#125BFF', color: 'white', border: 'none', cursor: 'pointer' }}>
        Aplicar
      </button>
      <span className="mx-1 self-center text-[11px]" style={{ color: 'oklch(0.70 0.01 258)' }}>atalhos:</span>
      {[['7d', 7], ['30d', 30], ['90d', 90], ['180d', 180], ['12m', 365]].map(([lbl, d]) => (
        <button key={lbl} onClick={() => atalho(Number(d))} style={chip}>{lbl as string}</button>
      ))}
    </div>
  )
}
