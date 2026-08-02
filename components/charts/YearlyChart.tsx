'use client'
/**
 * Comparativo do ano: barras empilhadas por marketplace (faturamento do mês),
 * linha = margem real % do mês, nº de pedidos embaixo do rótulo do mês.
 */
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { MP_INFO, MP_ORDER } from '@/components/marketplaces'

export interface YearMonthPoint {
  mes: string        // 'jan', 'fev'…
  total: number
  margem: number | null
  pedidos: number
  [marketplace: string]: number | string | null
}

function fmtR(v: number) { return `R$ ${Math.round(v).toLocaleString('pt-BR')}` }

export function YearlyChart({ data }: { data: YearMonthPoint[] }) {
  if (!data.length) {
    return <div className="flex items-center justify-center h-48 text-sm" style={{ color: 'oklch(0.70 0.012 285)' }}>Sem dados no ano</div>
  }
  const byMes = Object.fromEntries(data.map(d => [d.mes, d]))

  const MonthTick = ({ x, y, payload }: any) => {
    const d = byMes[payload.value]
    return (
      <g transform={`translate(${x},${y})`}>
        <text dy={12} textAnchor="middle" fontSize={11} fill="oklch(0.40 0.02 285)" fontWeight={600}>{payload.value}</text>
        <text dy={26} textAnchor="middle" fontSize={10} fill="oklch(0.60 0.015 285)">{d ? `${d.pedidos} ped` : ''}</text>
      </g>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 285)" vertical={false} />
        <XAxis dataKey="mes" tick={<MonthTick />} tickLine={false} axisLine={false} interval={0} height={40} />
        <YAxis yAxisId="fat" tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
               tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="mg" orientation="right" tickFormatter={v => `${v}%`}
               tick={{ fontSize: 11, fill: '#7B61FF' }} tickLine={false} axisLine={false} domain={[0, 30]} />
        <Tooltip
          formatter={(value, name) => {
            if (name === 'margem') return [`${Number(value).toFixed(1)}%`, 'Margem do mês']
            if (name === 'total') return [fmtR(Number(value)), 'Total']
            return [fmtR(Number(value)), MP_INFO[name as string]?.label ?? name]
          }}
          labelFormatter={(mes) => {
            const d = byMes[mes as string]
            return `${mes} · ${d?.pedidos ?? 0} pedidos · total ${fmtR(Number(d?.total ?? 0))}`
          }}
          contentStyle={{ borderRadius: '10px', border: '1px solid oklch(0.89 0.012 285)', fontSize: 12, background: '#ffffff', color: 'oklch(0.16 0.018 285)' }}
        />
        <Legend formatter={v => v === 'margem' ? 'Margem %' : (MP_INFO[v as string]?.label ?? v)}
                wrapperStyle={{ fontSize: 12, color: 'oklch(0.50 0.022 285)' }} />
        {MP_ORDER.map(mp => (
          <Bar key={mp} yAxisId="fat" dataKey={mp} stackId="fat" fill={MP_INFO[mp].color} maxBarSize={46} />
        ))}
        <Line yAxisId="mg" type="monotone" dataKey="margem" stroke="#7B61FF" strokeWidth={2.4}
              dot={{ r: 3 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
