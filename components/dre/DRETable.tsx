'use client'
import type { DRERow } from '@/types'

const MP_COLS = [
  { key: 'mercado_livre' as const, label: 'Merc. Livre' },
  { key: 'shopee' as const, label: 'Shopee' },
  { key: 'amazon' as const, label: 'Amazon' },
]

// Oryma brand
const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  bgBlue:   'oklch(0.94 0.06 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

function fmt(v: number): string {
  if (v === 0) return '—'
  const abs = Math.abs(v)
  const formatted = abs.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return v < 0 ? `(${formatted})` : formatted
}

export function DRETable({ rows }: { rows: DRERow[] }) {
  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: `1px solid ${B.border}`, background: B.bgSubtle }}>
            <th className="text-left px-5 py-3 text-xs font-medium w-72" style={{ color: B.muted }}>Linha DRE</th>
            {MP_COLS.map(mp => (
              <th key={mp.key} className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'oklch(0.35 0.020 258)' }}>
                {mp.label}
              </th>
            ))}
            <th className="text-right px-5 py-3 text-xs font-bold" style={{ color: B.text }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.isHeader) {
              return (
                <tr key={i} style={{ background: B.bgSubtle }}>
                  <td colSpan={5} className="px-5 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: B.muted }}>
                    {row.label}
                  </td>
                </tr>
              )
            }

            if (row.isTotal || row.isHighlight) {
              const bg = row.isHighlight ? B.bgBlue : B.bgSubtle
              const valueColor = (v: number) =>
                v < 0 ? '#dc2626' : row.isHighlight ? B.brand : 'oklch(0.30 0.02 258)'
              return (
                <tr key={i} style={{ background: bg, borderTop: `1px solid ${B.border}`, borderBottom: `1px solid ${B.border}` }}>
                  <td className="px-5 py-3 font-bold text-sm" style={{ color: B.text }}>{row.label}</td>
                  {MP_COLS.map(mp => (
                    <td key={mp.key} className="text-right px-4 py-3 font-bold num" style={{ color: valueColor(row[mp.key]), fontFamily: 'var(--font-geist-mono)' }}>
                      {fmt(row[mp.key])}
                    </td>
                  ))}
                  <td className="text-right px-5 py-3 font-bold text-base num" style={{ color: valueColor(row.total), fontFamily: 'var(--font-geist-mono)' }}>
                    {fmt(row.total)}
                  </td>
                </tr>
              )
            }

            return (
              <tr key={i} className="transition-colors" style={{ borderBottom: `1px solid ${B.bgSubtle}` }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = B.bgSubtle }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
              >
                <td className="px-5 py-2.5 pl-8" style={{ color: 'oklch(0.40 0.020 258)' }}>{row.label}</td>
                {MP_COLS.map(mp => (
                  <td key={mp.key} className="text-right px-4 py-2.5 text-sm num" style={{
                    color: row[mp.key] < 0 ? '#dc2626' : 'oklch(0.35 0.020 258)',
                    fontFamily: 'var(--font-geist-mono)',
                  }}>
                    {fmt(row[mp.key])}
                  </td>
                ))}
                <td className="text-right px-5 py-2.5 font-semibold num" style={{
                  color: row.total < 0 ? '#dc2626' : B.text,
                  fontFamily: 'var(--font-geist-mono)',
                }}>
                  {fmt(row.total)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
