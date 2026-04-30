import type { DRERow } from '@/types'

const MP_COLS = [
  { key: 'mercado_livre' as const, label: 'Merc. Livre' },
  { key: 'shopee' as const, label: 'Shopee' },
  { key: 'amazon' as const, label: 'Amazon' },
]

function fmt(v: number): string {
  if (v === 0) return '—'
  const abs = Math.abs(v)
  const formatted = abs.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return v < 0 ? `(${formatted})` : formatted
}

export function DRETable({ rows }: { rows: DRERow[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-5 py-3 text-xs text-gray-400 font-medium w-72">Linha DRE</th>
            {MP_COLS.map(mp => (
              <th key={mp.key} className="text-right px-4 py-3 text-xs font-semibold text-gray-600">{mp.label}</th>
            ))}
            <th className="text-right px-5 py-3 text-xs font-bold text-gray-900">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.isHeader) {
              return (
                <tr key={i} className="bg-gray-50/80">
                  <td colSpan={5} className="px-5 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {row.label}
                  </td>
                </tr>
              )
            }

            if (row.isTotal || row.isHighlight) {
              const bg = row.isHighlight ? 'bg-blue-50' : 'bg-slate-50'
              const textColor = (v: number) => v < 0 ? 'text-red-600' : row.isHighlight ? 'text-blue-800' : 'text-slate-700'
              return (
                <tr key={i} className={`${bg} border-t border-b border-gray-200`}>
                  <td className="px-5 py-3 font-bold text-gray-900 text-sm">{row.label}</td>
                  {MP_COLS.map(mp => (
                    <td key={mp.key} className={`text-right px-4 py-3 font-bold ${textColor(row[mp.key])}`}>
                      {fmt(row[mp.key])}
                    </td>
                  ))}
                  <td className={`text-right px-5 py-3 font-bold text-base ${textColor(row.total)}`}>
                    {fmt(row.total)}
                  </td>
                </tr>
              )
            }

            return (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-2.5 text-gray-600 pl-8">{row.label}</td>
                {MP_COLS.map(mp => (
                  <td key={mp.key} className={`text-right px-4 py-2.5 text-sm ${row[mp.key] < 0 ? 'text-red-500' : 'text-gray-700'}`}>
                    {fmt(row[mp.key])}
                  </td>
                ))}
                <td className={`text-right px-5 py-2.5 font-semibold ${row.total < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {fmt(row.total)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
