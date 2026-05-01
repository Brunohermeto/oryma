'use client'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DataPoint {
  date: string
  mercado_livre: number
  shopee: number
  amazon: number
}

// Oryma — Manual de Marca
const COLORS = {
  mercado_livre: '#125BFF',   // Azul Elétrico
  shopee:        '#7B61FF',   // Violeta
  amazon:        '#00D6FF',   // Ciano
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
    return (
      <div
        className="flex items-center justify-center h-48 text-sm"
        style={{ color: 'oklch(0.70 0.012 285)' }}
      >
        Sem dados de venda ainda
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 285)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 11, fill: 'oklch(0.60 0.015 285)' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value, name) => [fmtR(Number(value)), (LABELS as any)[name as string] ?? name]}
          contentStyle={{
            borderRadius: '10px',
            border: '1px solid oklch(0.89 0.012 285)',
            fontSize: 12,
            background: '#ffffff',
            color: 'oklch(0.16 0.018 285)',
          }}
        />
        <Legend
          formatter={v => (LABELS as any)[v] ?? v}
          wrapperStyle={{ fontSize: 12, color: 'oklch(0.50 0.022 285)' }}
        />
        <Line type="monotone" dataKey="mercado_livre" stroke={COLORS.mercado_livre} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="shopee" stroke={COLORS.shopee} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="amazon" stroke={COLORS.amazon} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
