'use client'
import { useState } from 'react'
import type { LinhaComparativo } from '@/lib/dre/comparativo'

const B = {
  border:   'oklch(0.88 0.016 258)',
  bgSubtle: 'oklch(0.96 0.010 258)',
  bgBlue:   'oklch(0.92 0.07 258)',
  text:     '#0B1023',
  muted:    'oklch(0.50 0.025 258)',
  brand:    '#125BFF',
  red:      '#dc2626',
}
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mono = { fontFamily: 'var(--font-geist-mono)' }

function fmt(v: number): string {
  if (Math.abs(v) < 0.5) return '—'
  const s = Math.round(Math.abs(v)).toLocaleString('pt-BR')
  return v < 0 ? `(${s})` : s
}
const fmtPct = (v: number) => (v === 0 ? '—' : `${v.toFixed(1).replace('.', ',')}%`)

export function DREComparativo({ meses, linhas, semDespesas }: { meses: string[]; linhas: LinhaComparativo[]; semDespesas: boolean[] }) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setAbertos(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const temDetalhe = new Set(linhas.filter(l => l.tipo === 'detalhe').map(l => l.grupo))
  const algumSemDespesa = semDespesas.some(Boolean)

  return (
    <div className="space-y-2">
      <div className="bg-white rounded-xl overflow-x-auto" style={{ border: `1px solid ${B.border}` }}>
        <table className="text-sm" style={{ minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ background: B.bgSubtle }}>
              <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide sticky left-0 z-10"
                  style={{ color: B.muted, background: B.bgSubtle, minWidth: 240, borderBottom: `1px solid ${B.border}` }}>
                R$ · clique no mês para detalhar
              </th>
              {meses.map((m, i) => {
                const [a, mm] = m.split('-')
                return (
                  <th key={m} className="text-right px-3 py-3 text-[12px] font-semibold whitespace-nowrap" style={{ borderBottom: `1px solid ${B.border}` }}>
                    <a href={`/dashboard/dre?month=${m}`} style={{ color: B.brand }} title="Abrir o DRE do mês por marketplace">
                      {MES[Number(mm) - 1]}/{a.slice(2)}{semDespesas[i] ? '*' : ''}
                    </a>
                  </th>
                )
              })}
              <th className="text-right px-4 py-3 text-[12px] font-bold uppercase whitespace-nowrap"
                  style={{ color: B.text, borderBottom: `1px solid ${B.border}`, borderLeft: `1px solid ${B.border}` }}>
                12 meses
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => {
              if (l.tipo === 'detalhe' && !abertos.has(l.grupo!)) return null
              const resultado = l.tipo === 'resultado'
              const grupo = l.tipo === 'grupo'
              const pct = l.tipo === 'pct'
              const expansivel = grupo && temDetalhe.has(l.key)
              const bg = resultado ? B.bgBlue : grupo && abertos.has(l.key) ? B.bgSubtle : 'white'
              const cor = (v: number) => (v < 0 ? B.red : resultado ? B.brand : pct ? B.muted : B.text)
              const celula = (v: number) => (pct ? fmtPct(v) : fmt(v))
              return (
                <tr key={l.key} onClick={expansivel ? () => toggle(l.key) : undefined}
                    className={expansivel ? 'hover-row' : undefined}
                    style={{ cursor: expansivel ? 'pointer' : undefined, background: bg }}>
                  <td className={`px-4 sticky left-0 z-10 whitespace-nowrap ${pct ? 'py-1 text-[12px] italic' : 'py-2.5'} ${l.tipo === 'detalhe' ? 'pl-9 text-[13px]' : ''} ${resultado || grupo || l.tipo === 'linha' ? 'font-semibold' : ''} ${resultado ? 'font-bold' : ''}`}
                      style={{ color: l.tipo === 'detalhe' || pct ? B.muted : B.text, background: bg, borderBottom: `1px solid ${B.bgSubtle}` }}>
                    {expansivel && <span className="inline-block w-4" style={{ color: B.brand }}>{abertos.has(l.key) ? '▾' : '▸'}</span>}
                    {l.label}
                  </td>
                  {l.valores.map((v, i) => (
                    <td key={i} className={`text-right px-3 whitespace-nowrap num ${pct ? 'py-1 text-[12px]' : 'py-2.5'} ${resultado ? 'font-bold' : grupo ? 'font-semibold' : ''} ${l.tipo === 'detalhe' ? 'text-[12px]' : ''}`}
                        style={{ ...mono, color: cor(v), borderBottom: `1px solid ${B.bgSubtle}` }}>
                      {celula(v)}
                    </td>
                  ))}
                  <td className={`text-right px-4 whitespace-nowrap num font-bold ${pct ? 'py-1 text-[12px]' : 'py-2.5'}`}
                      style={{ ...mono, color: cor(l.total), borderBottom: `1px solid ${B.bgSubtle}`, borderLeft: `1px solid ${B.border}` }}>
                    {celula(l.total)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px]" style={{ color: B.muted }}>
        Clique numa linha com ▸ para abrir o detalhe. Valores negativos entre parênteses.
        {algumSemDespesa && ' * Mês sem despesas da Conta Azul importadas — EBITDA e resultado ficam acima do real.'}
      </p>
    </div>
  )
}
