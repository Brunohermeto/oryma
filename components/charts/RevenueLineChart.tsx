'use client'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DataPoint {
  date: string
  mercado_livre: number
  shopee: number
  amazon: number
}

const COLORS = {
  mercado_livre: '#f97316',
  shopee: '#ef4444',
  amazon: '#f59e0b',
}

const LABELS = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}

function fmtR(v: number) {
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}

export function RevenueLineChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return <div className="flex items-center justify-center h-48 text-gray-300 text-sm">Sem dados de venda ainda</div>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(value, name) => [fmtR(Number(value)), (LABELS as any)[name as string] ?? name]}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Legend formatter={(v) => (LABELS as any)[v] ?? v} wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="mercado_livre" stroke={COLORS.mercado_livre} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="shopee" stroke={COLORS.shopee} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="amazon" stroke={COLORS.amazon} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
