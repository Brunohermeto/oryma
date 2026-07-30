/**
 * Identidade visual central dos marketplaces — cores de marca, rótulos e a
 * "bandeirinha" usada em tabelas/feeds. Fonte única: adicionar canal novo AQUI.
 */

export const MP_ORDER = ['mercado_livre', 'magalu', 'amazon', 'shopee'] as const

export const MP_INFO: Record<string, { label: string; short: string; color: string; bg: string; fg: string }> = {
  // color = cor de linha/série em gráficos (contraste em fundo branco)
  // bg/fg = bandeirinha
  mercado_livre: { label: 'Mercado Livre', short: 'ML', color: '#E6A800', bg: '#FFE600', fg: '#2D3277' },
  magalu:        { label: 'Magalu',        short: 'MAG', color: '#0086FF', bg: '#0086FF', fg: '#ffffff' },
  amazon:        { label: 'Amazon',        short: 'AMZ', color: '#232F3E', bg: '#232F3E', fg: '#FF9900' },
  shopee:        { label: 'Shopee',        short: 'SHO', color: '#EE4D2D', bg: '#EE4D2D', fg: '#ffffff' },
}

export const MP_TOTAL_COLOR = '#7B61FF' // linha totalizadora (violeta Oryma)

export function mpLabel(mp: string): string {
  return MP_INFO[mp]?.label ?? mp
}

/** Bandeirinha do marketplace (chip com as cores da marca). */
export function MarketplaceBadge({ mp, size = 13 }: { mp: string; size?: number }) {
  const info = MP_INFO[mp] ?? { label: mp, short: mp.slice(0, 3).toUpperCase(), bg: '#e2e8f0', fg: '#334155', color: '#64748b' }
  return (
    <span
      title={info.label}
      className="inline-flex items-center justify-center rounded-md font-extrabold align-middle select-none"
      style={{
        background: info.bg,
        color: info.fg,
        fontSize: size - 4,
        lineHeight: 1,
        padding: `${Math.round(size * 0.32)}px ${Math.round(size * 0.5)}px`,
        letterSpacing: '0.02em',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
      }}
    >
      {info.short}
    </span>
  )
}
