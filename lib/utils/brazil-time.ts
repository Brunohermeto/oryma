/**
 * Utilitários de fuso horário para o Brasil (America/Sao_Paulo = UTC-3, sem DST desde 2019).
 *
 * PROBLEMA: Vercel roda em UTC. Às 21:49 BRT = 00:49 UTC do dia seguinte.
 * `new Date().toISOString().slice(0,10)` daria o dia errado para o usuário brasileiro.
 *
 * SOLUÇÃO: Usar Intl.DateTimeFormat com timeZone 'America/Sao_Paulo' para extrair
 * datas locais corretamente, independente do fuso do servidor.
 */

/**
 * Converte qualquer ISO string ou timestamp em data no fuso de São Paulo (YYYY-MM-DD).
 * Exemplo: '2025-05-06T00:49:00.000Z' → '2025-05-05' (ainda dia 5 no Brasil)
 */
export function toBrazilDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  // en-CA dá formato YYYY-MM-DD diretamente
}

/**
 * Retorna a data de hoje no fuso de São Paulo (YYYY-MM-DD).
 */
export function brazilToday(): string {
  return toBrazilDate(new Date())
}

/**
 * Retorna a data de N dias atrás no fuso de São Paulo (YYYY-MM-DD).
 */
export function brazilDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return toBrazilDate(d)
}
