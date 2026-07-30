'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface DataPoint {
  marketplace: string
  margem: number
  receita: number
}

import { MP_INFO } from '@/components/marketplaces'

// Cores de marca de cada canal (fonte única em components/marketplaces.tsx)
const COLORS: Record<string, string> = Object.fromEntries(
  Object.values(MP_INFO).map(i => [i.label, i.color])
)

export function MarketplaceBarChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center h-48 text-sm"
        style={{ color: 'oklch(0.70 0.012 285)' }}
      >
        Sem dados ainda
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 285)" vertical={false} />
        <XAxis
          dataKey="marketplace"
          tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={v => `${v}%`}
          tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }}
          tickLine={false}
          axisLine={false}
          domain={[0, 60]}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Margem Bruta']}
          contentStyle={{
            borderRadius: '10px',
            border: '1px solid oklch(0.89 0.012 285)',
            fontSize: 12,
            background: '#ffffff',
            color: 'oklch(0.16 0.018 285)',
          }}
        />
        <Bar dataKey="margem" radius={[6, 6, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={COLORS[entry.marketplace] ?? '#7c3aed'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
