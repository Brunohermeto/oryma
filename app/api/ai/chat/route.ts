import { NextRequest, NextResponse } from 'next/server'

// Oryma Intelligence — Chat API
// Uses Anthropic Claude for contextual business intelligence
// Add ANTHROPIC_API_KEY to .env.local to activate

const SYSTEM_PROMPT = `Você é a Oryma Intelligence, a assistente de inteligência financeira da plataforma Oryma da empresa MCL Informática LTDA (marca RAGALUMA).

A empresa é uma importadora de produtos de bebê que vende nos marketplaces Mercado Livre, Shopee e Amazon, no regime tributário Lucro Real.

Produtos principais:
- RAGA001: Berço SLEEPGUARD
- RAGA002: Cadeira LUPPA
- RAGA003: Berço COBED
- RAGA004: Cadeirinha GIO ISOFIX

Você tem acesso ao contexto da tela atual onde o usuário está. Use esse contexto para dar respostas precisas e relevantes.

Regras:
- Responda sempre em português brasileiro
- Seja direto, preciso e orientado a dados
- Use R$ para valores monetários no formato brasileiro
- Quando falar de margem, explique se é bruta (sem despesas operacionais) ou líquida
- Tributação: PIS 1,65% / COFINS 7,60% não-cumulativo, ICMS MG, DIFAL por UF destino, IRPJ 15%+10%, CSLL 9%
- Custo landed = FOB + II + IPI + PIS-Importação + COFINS-Importação + ICMS-GNRE + frete marítimo + seguro + AFRMM + armazenagem + frete rodoviário + despachante + GRU INMETRO + SISCOMEX
- Se não souber algo específico sobre os dados do usuário, diga que precisa dos dados sincronizados`

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    // Return a helpful mock response when API key is not configured
    return NextResponse.json({
      message: 'A Oryma Intelligence está pronta! Para ativar o chat com IA real, adicione ANTHROPIC_API_KEY ao seu .env.local.\n\nEnquanto isso, posso ajudar com dúvidas sobre como usar a plataforma.',
      mock: true,
    })
  }

  const { messages, context } = await req.json()

  const systemWithContext = context
    ? `${SYSTEM_PROMPT}\n\nContexto atual da tela:\n${context}`
    : SYSTEM_PROMPT

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: systemWithContext,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('Anthropic API error:', error)
    return NextResponse.json({ error: 'Erro ao consultar a IA. Tente novamente.' }, { status: 500 })
  }

  const data = await response.json()
  const message = data.content?.[0]?.text ?? 'Não consegui gerar uma resposta.'

  return NextResponse.json({ message })
}
