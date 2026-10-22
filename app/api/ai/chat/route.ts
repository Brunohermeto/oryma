import { NextRequest, NextResponse } from 'next/server'
import { TOOLS, runTool } from '@/lib/ai/tools'
import { brazilToday } from '@/lib/utils/brazil-time'

// Oryma Intelligence — Chat API com acesso (só leitura) aos dados da plataforma.
// O modelo chama as ferramentas de lib/ai/tools e responde com números reais.

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'gru1'

const MODEL = 'claude-sonnet-5-5'

const SYSTEM_PROMPT = `Você é a Oryma Intelligence, analista de negócios da plataforma Oryma da MCL Informática LTDA (marca RAGALUMA), importadora de produtos de bebê que vende no Mercado Livre, Shopee, Amazon e Magalu, no Lucro Real.

Você TEM ACESSO aos dados reais da plataforma pelas ferramentas. Sempre que a pergunta envolver números, períodos, produtos, estoque, margem, DRE, ads ou cupons, CONSULTE as ferramentas antes de responder — nunca invente números.

Como responder:
- Português do Brasil, direto, orientado a dados; valores em R$ no formato brasileiro.
- Comece pela resposta/insight principal; depois os números que sustentam (tabelas curtas quando ajudar).
- Para tendência: compare períodos equivalentes, aponte direção, variação % e possíveis causas visíveis nos dados (canal, produto, margem, ads, cupons). Mês corrente está incompleto — use a projeção.
- Termine com 1 a 3 ações sugeridas quando fizer sentido.
- Diga o período consultado. Se um dado não existir na plataforma, diga o que falta.
- Formato: o chat mostra TEXTO SIMPLES (sem markdown). Não use **, #, nem tabelas com |. Use frases curtas, listas com • e quebras de linha; números alinhados como "Set: R$ 1,46 mi (+48,7%)".

Definições da plataforma:
- Faturamento = bruto − devoluções − cupons/descontos; vendas devolvidas ficam fora.
- Margem % = lucro apurado ÷ faturamento das vendas com custo apurado (já descontados impostos, tarifas, frete, ads, CMV landed; rebate do canal soma).
- DRE: despesas da empresa vêm da Conta Azul e ficam só no total; IRPJ/CSLL do DRE são ESTIMADOS por fórmula.
- Rebate = o que o marketplace devolve ao vendedor (campanhas, cupons bancados pelo canal).`

type Msg = { role: 'user' | 'assistant'; content: unknown }

export async function POST(req: NextRequest) {
  if (req.cookies.get('mi_auth')?.value !== process.env.APP_PASSWORD)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      message: 'A Oryma Intelligence está sem a chave da IA configurada no servidor (ANTHROPIC_API_KEY na Vercel).',
      mock: true,
    })
  }

  const { messages, context } = await req.json()
  const system = `${SYSTEM_PROMPT}\n\nHoje é ${brazilToday()}.${context ? `\nTela atual do usuário: ${context}` : ''}`
  const conv: Msg[] = (messages ?? []).slice(-12).map((m: { role: string; content: string }) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? ''),
  }))

  const inicio = Date.now()
  for (let rodada = 0; rodada < 6; rodada++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system, tools: TOOLS, messages: conv }),
    })
    if (!res.ok) {
      console.error('Anthropic API error:', await res.text())
      return NextResponse.json({ error: 'Erro ao consultar a IA. Tente novamente.' }, { status: 500 })
    }
    const data = await res.json() as { stop_reason: string; content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> }
    if (data.stop_reason !== 'tool_use' || Date.now() - inicio > 45000) {
      const message = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      return NextResponse.json({ message: message || 'Não consegui gerar uma resposta.' })
    }
    conv.push({ role: 'assistant', content: data.content })
    const resultados = await Promise.all(data.content.filter(b => b.type === 'tool_use').map(async b => {
      let out: unknown
      try { out = await runTool(b.name!, b.input ?? {}) } catch (e) { out = { erro: String(e).slice(0, 200) } }
      return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out).slice(0, 60000) }
    }))
    conv.push({ role: 'user', content: resultados })
  }
  return NextResponse.json({ message: 'A análise ficou longa demais. Tente uma pergunta mais específica (um período ou um canal).' })
}
