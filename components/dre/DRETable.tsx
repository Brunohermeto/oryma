'use client'
import type { DRERow } from '@/types'

// Oryma brand
const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  bgBlue:   'oklch(0.92 0.07 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
}

const MP_COLS = [
  { key: 'mercado_livre' as const, label: 'Merc. Livre', color: '#125BFF' },
  { key: 'shopee'        as const, label: 'Shopee',      color: '#7B61FF' },
  { key: 'amazon'        as const, label: 'Amazon',      color: '#00D6FF' },
]

function fmt(v: number): string {
  if (v === 0) return '—'
  const abs = Math.abs(v)
  const s = abs >= 1000
    ? `R$ ${(abs / 1000).toFixed(1)}k`
    : `R$ ${abs.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`
  return v < 0 ? `(${s})` : s
}

function fmtFull(v: number): string {
  if (v === 0) return '—'
  const abs = Math.abs(v)
  const s = `R$ ${Math.round(abs).toLocaleString('pt-BR')}`
  return v < 0 ? `(${s})` : s
}

export function DRETable({ rows }: { rows: DRERow[] }) {
  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${B.border}` }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: B.bgSubtle, borderBottom: `1px solid ${B.border}` }}>
            {/* Label */}
            <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: B.muted, width: '40%' }}>
              Linha DRE
            </th>
            {/* TOTAL — destaque */}
            <th className="text-right px-5 py-3 text-[12px] font-bold uppercase tracking-wide" style={{ color: B.text, width: '18%' }}>
              TOTAL
            </th>
            {/* Separador visual */}
            <th style={{ width: '1px', background: B.border, padding: 0 }} />
            {/* Canais — secundário */}
            {MP_COLS.map(mp => (
              <th key={mp.key} className="text-right px-4 py-3 text-[11px] font-semibold" style={{ color: mp.color, width: '13%', opacity: 0.85 }}>
                {mp.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            // ── Cabeçalho de seção ──
            if (row.isHeader) {
              return (
                <tr key={i} style={{ background: B.bgSubtle }}>
                  <td colSpan={6} className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: B.muted }}>
                    {row.label}
                  </td>
                </tr>
              )
            }

            // ── Linhas de total / destaque ──
            if (row.isTotal || row.isHighlight) {
              const bg = row.isHighlight ? B.bgBlue : B.bgSubtle
              const totalColor = row.isHighlight
                ? (row.total >= 0 ? B.brand : '#dc2626')
                : (row.total >= 0 ? B.text : '#dc2626')

              return (
                <tr key={i} style={{ background: bg, borderTop: `1px solid ${B.border}`, borderBottom: `1px solid ${B.border}` }}>
                  <td className="px-5 py-3 font-bold" style={{ color: B.text }}>{row.label}</td>
                  {/* TOTAL — grande */}
                  <td className="text-right px-5 py-3 font-bold text-base num" style={{ color: totalColor, fontFamily: 'var(--font-geist-mono)' }}>
                    {fmtFull(row.total)}
                  </td>
                  <td style={{ background: B.border, padding: 0 }} />
                  {/* Canais */}
                  {MP_COLS.map(mp => (
                    <td key={mp.key} className="text-right px-4 py-3 text-[12px] font-semibold num" style={{
                      color: row[mp.key] < 0 ? '#dc2626' : row.isHighlight ? B.brand : 'oklch(0.35 0.020 258)',
                      fontFamily: 'var(--font-geist-mono)',
                      opacity: 0.75,
                    }}>
                      {fmt(row[mp.key])}
                    </td>
                  ))}
                </tr>
              )
            }

            // ── Linhas normais ──
            return (
              <tr key={i} className="hover-row" style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-5 py-2.5 pl-8" style={{ color: 'oklch(0.40 0.020 258)' }}>{row.label}</td>
                {/* TOTAL */}
                <td className="text-right px-5 py-2.5 font-semibold num" style={{
                  color: row.total < 0 ? '#dc2626' : B.text,
                  fontFamily: 'var(--font-geist-mono)',
                }}>
                  {fmtFull(row.total)}
                </td>
                <td style={{ background: B.border, padding: 0 }} />
                {/* Canais */}
                {MP_COLS.map(mp => (
                  <td key={mp.key} className="text-right px-4 py-2.5 text-[12px] num" style={{
                    color: row[mp.key] < 0 ? '#ef4444' : 'oklch(0.50 0.025 258)',
                    fontFamily: 'var(--font-geist-mono)',
                    opacity: 0.75,
                  }}>
                    {fmt(row[mp.key])}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
