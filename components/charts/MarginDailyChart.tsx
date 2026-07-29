'use client'
/**
 * Margem por dia: barras = lucro R$ do dia (vendas completas), linha = margem %.
 * Dias sem vendas completas ficam sem ponto (margem nula ≠ margem zero).
 */
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

export interface MarginDailyPoint {
  date: string            // dd/MM
  lucro: number | null    // Σ margin_value do dia (null = nenhuma venda completa)
  margem: number | null   // % sobre bruto das vendas completas
}

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }

export function MarginDailyChart({ data, avgMargin }: { data: MarginDailyPoint[]; avgMargin?: number }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: 'oklch(0.70 0.012 285)' }}>
        Sem dados ainda
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 285)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="lucro" tickFormatter={v => `R$${(Number(v) / 1000).toFixed(1)}k`}
               tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="margem" orientation="right" tickFormatter={v => `${v}%`}
               tick={{ fontSize: 11, fill: '#7B61FF' }} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(value, name) => name === 'margem'
            ? [`${Number(value).toFixed(1)}%`, 'Margem %']
            : [fmtR(Number(value)), 'Lucro do dia']}
          contentStyle={{ borderRadius: '10px', border: '1px solid oklch(0.89 0.012 285)', fontSize: 12, background: '#ffffff', color: 'oklch(0.16 0.018 285)' }}
        />
        <Bar yAxisId="lucro" dataKey="lucro" radius={[4, 4, 0, 0]} maxBarSize={18}>
          {data.map((d, i) => (
            <Cell key={i} fill={(d.lucro ?? 0) >= 0 ? 'rgba(18,91,255,0.75)' : 'rgba(220,38,38,0.75)'} />
          ))}
        </Bar>
        {avgMargin !== undefined && (
          <ReferenceLine yAxisId="margem" y={Math.round(avgMargin * 10) / 10} stroke="#16a34a"
            strokeDasharray="6 4" strokeWidth={1.5}
            label={{ value: `média ${avgMargin.toFixed(1)}%`, position: 'insideTopRight', fontSize: 11, fill: '#16a34a' }} />
        )}
        <Line yAxisId="margem" type="monotone" dataKey="margem" stroke="#7B61FF" strokeWidth={2}
              dot={{ r: 2 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
