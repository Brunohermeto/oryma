/**
 * Seletor de período (De/Até) + atalhos rápidos para velocidade/cobertura.
 * Form GET nativo (navegação completa): o router.push do client às vezes não
 * re-renderizava a página e a velocidade parecia não mudar (13/10/2026).
 */
export function PeriodoFilter({ from, to }: { from: string; to: string }) {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const hoje = new Date()
  const atalho = (dias: number) => `?from=${iso(new Date(hoje.getTime() - dias * 86400000))}&to=${iso(hoje)}`

  const chip = { fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, background: 'oklch(0.96 0.010 258)', color: '#125BFF' } as const

  return (
    <form method="get" className="flex gap-2 flex-wrap items-end">
      <span className="text-[12px] self-center" style={{ color: 'oklch(0.55 0.02 258)' }}>Período:</span>
      <label className="text-[11px]" style={{ color: 'oklch(0.55 0.02 258)' }}>
        De
        <input type="date" name="from" defaultValue={from} required
          className="block mt-0.5 h-8 text-[13px] px-2 rounded-md border" style={{ borderColor: 'oklch(0.88 0.016 258)' }} />
      </label>
      <label className="text-[11px]" style={{ color: 'oklch(0.55 0.02 258)' }}>
        Até
        <input type="date" name="to" defaultValue={to} required
          className="block mt-0.5 h-8 text-[13px] px-2 rounded-md border" style={{ borderColor: 'oklch(0.88 0.016 258)' }} />
      </label>
      <button type="submit" className="h-8 px-4 rounded-md text-[12px] font-bold" style={{ background: '#125BFF', color: 'white', border: 'none', cursor: 'pointer' }}>
        Aplicar
      </button>
      <span className="mx-1 self-center text-[11px]" style={{ color: 'oklch(0.70 0.01 258)' }}>atalhos:</span>
      {([['7d', 7], ['30d', 30], ['90d', 90], ['180d', 180], ['12m', 365]] as const).map(([lbl, d]) => (
        <a key={lbl} href={atalho(d)} style={chip}>{lbl}</a>
      ))}
    </form>
  )
}
