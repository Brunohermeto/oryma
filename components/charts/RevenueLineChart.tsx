'use client'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { MP_INFO, MP_ORDER, MP_TOTAL_COLOR } from '@/components/marketplaces'

export interface RevenuePoint {
  date: string
  total: number
  [marketplace: string]: number | string
}

function fmtR(v: number) {
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}

export function RevenueLineChart({ data }: { data: RevenuePoint[] }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: 'oklch(0.70 0.012 285)' }}>
        Sem dados de venda ainda
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 285)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }} tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }}
          tickLine={false} axisLine={false}
        />
        <Tooltip
          formatter={(value, name) => [fmtR(Number(value)), name === 'total' ? 'Total' : (MP_INFO[name as string]?.label ?? name)]}
          contentStyle={{ borderRadius: '10px', border: '1px solid oklch(0.89 0.012 285)', fontSize: 12, background: '#ffffff', color: 'oklch(0.16 0.018 285)' }}
        />
        <Legend
          formatter={v => v === 'total' ? 'Total' : (MP_INFO[v as string]?.label ?? v)}
          wrapperStyle={{ fontSize: 12, color: 'oklch(0.50 0.022 285)' }}
        />
        {MP_ORDER.map(mp => (
          <Line key={mp} type="monotone" dataKey={mp} stroke={MP_INFO[mp].color} strokeWidth={1.8} dot={false} />
        ))}
        <Line type="monotone" dataKey="total" stroke={MP_TOTAL_COLOR} strokeWidth={2.6} strokeDasharray="7 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
