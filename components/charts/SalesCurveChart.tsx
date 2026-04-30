'use client'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface DataPoint {
  date: string
  units: number
}

export function SalesCurveChart({ data, color = '#6366f1', label = 'Unidades' }: {
  data: DataPoint[]
  color?: string
  label?: string
}) {
  if (!data.length) {
    return <div className="flex items-center justify-center h-32 text-gray-300 text-xs">Sem dados de venda</div>
  }
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.15} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          formatter={(v) => [Number(v).toFixed(0), label]}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: 11 }}
        />
        <Area type="monotone" dataKey="units" stroke={color} strokeWidth={2}
          fill={`url(#grad-${color.replace('#','')})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
