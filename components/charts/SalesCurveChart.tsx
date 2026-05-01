'use client'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface DataPoint {
  date: string
  units: number
}

export function SalesCurveChart({ data, color = '#125BFF', label = 'Unidades' }: {
  data: DataPoint[]
  color?: string
  label?: string
}) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-32 text-xs" style={{ color: 'oklch(0.65 0.015 258)' }}>
        Sem dados de venda
      </div>
    )
  }
  const gradId = `grad-${color.replace('#', '')}`
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.010 258)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: 'oklch(0.60 0.012 258)' }}
          tickLine={false} axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'oklch(0.60 0.012 258)' }}
          tickLine={false} axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          formatter={(v) => [Number(v).toFixed(0), label]}
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid oklch(0.88 0.016 258)',
            fontSize: 11,
            background: '#ffffff',
            color: '#0B1023',
          }}
        />
        <Area
          type="monotone" dataKey="units"
          stroke={color} strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
