/**
 * Chama /api/landed-cost/relink de dentro do servidor.
 * URL de origem CONFIÁVEL (domínio de produção da Vercel, não o Host da
 * requisição) e autenticação pelo x-cron-secret — nunca repassar a senha do app.
 */
export async function callRelink(body: { productIds?: string[]; from?: string }) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const base = host ? `https://${host}` : 'https://www.oryma.com.br'
  const res = await fetch(`${base}/api/landed-cost/relink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET ?? 'internal' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => null)
}
