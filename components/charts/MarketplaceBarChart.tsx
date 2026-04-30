'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface DataPoint {
  marketplace: string
  margem: number
  receita: number
}

const COLORS: Record<string, string> = {
  'Mercado Livre': '#f97316',
  'Shopee': '#ef4444',
  'Amazon': '#f59e0b',
}

export function MarketplaceBarChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return <div className="flex items-center justify-center h-48 text-gray-300 text-sm">Sem dados ainda</div>
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="marketplace" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} domain={[0, 60]} />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Margem Bruta']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Bar dataKey="margem" radius={[6, 6, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={COLORS[entry.marketplace] ?? '#6366f1'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
