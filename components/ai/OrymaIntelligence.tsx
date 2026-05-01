'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { X, Send, Loader2, Sparkles, ChevronDown } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Page context strings for each route
function getPageContext(pathname: string): string {
  const contexts: Record<string, string> = {
    '/dashboard':                'Dashboard principal — visão consolidada de KPIs, receita, margem e top produtos do mês.',
    '/dashboard/dre':            'DRE Gerencial — Demonstração de Resultado do Exercício com colunas por marketplace (ML, Shopee, Amazon) e total.',
    '/dashboard/tributario':     'Painel Tributário — Apuração Lucro Real: PIS/COFINS não-cumulativo, ICMS MG + DIFAL, IRPJ e CSLL.',
    '/dashboard/produtos':       'Custo por Produto — Breakdown de landed cost: FOB, impostos NF-e, despesas adicionais (frete, seguro, etc.), CMP atual.',
    '/dashboard/vendas':         'Feed de Vendas — Tabela de todas as vendas com filtros, mostrando faturamento, impostos, tarifas, CMV e margem por venda.',
    '/dashboard/velocidade':     'Velocidade de Venda — Curva de vendas por produto dos últimos 30 dias, unidades/dia e dias de estoque restante.',
    '/dashboard/precificacao':   'Simulador de Preço — Preço mínimo para 40% de margem baseado no CMP, por marketplace.',
    '/dashboard/importacoes':    'NF-e / Importações — Upload de XML de NF-e de importação e lançamento de despesas adicionais de landed cost.',
    '/dashboard/despesas':       'Despesas Operacionais — Lançamento manual de despesas por categoria (pessoal, energia, aluguel, etc.).',
    '/dashboard/configuracoes':  'Configurações — Integrações com Mercado Livre, Shopee, Amazon e Bling via OAuth/API.',
  }
  const match = Object.entries(contexts).find(([k]) => pathname === k || pathname.startsWith(k + '/'))
  return match ? match[1] : 'Plataforma Oryma — Sistema de inteligência financeira para e-commerce.'
}

const SUGGESTED: Record<string, string[]> = {
  '/dashboard':            ['Como está minha margem este mês?', 'Qual produto tem melhor desempenho?', 'O que significa margem bruta vs. líquida?'],
  '/dashboard/dre':        ['Explique as linhas do DRE', 'Como reduzir as tarifas de marketplace?', 'O que é receita líquida neste contexto?'],
  '/dashboard/tributario': ['Quando devo recolher o PIS/COFINS?', 'O que é DIFAL e como funciona?', 'Qual a alíquota de ICMS para MG?'],
  '/dashboard/produtos':   ['Como é calculado o CMP?', 'O que compõe o landed cost?', 'Como reduzir o custo de importação?'],
  '/dashboard/vendas':     ['Qual marketplace tem maior margem?', 'Como interpretar a coluna de impostos?', 'O que é CMV?'],
  '/dashboard/velocidade': ['Como calcular dias de estoque ideal?', 'Quando devo repor o estoque?', 'O que significa un./dia?'],
  '/dashboard/precificacao': ['Como calcular preço mínimo?', 'Qual a comissão do ML?', 'O que é margem-alvo de 40%?'],
  '/dashboard/importacoes': ['Quais são os 14 componentes do landed cost?', 'Como importar uma NF-e XML?', 'O que é AFRMM?'],
  '/dashboard/despesas':   ['Quais despesas entram no DRE?', 'Como categorizar pró-labore?', 'O que é competência?'],
}

function getSuggestions(pathname: string): string[] {
  const match = Object.entries(SUGGESTED).find(([k]) => pathname === k || pathname.startsWith(k + '/'))
  return match ? match[1] : ['Como usar a Oryma?', 'Me explique o Lucro Real', 'Como melhorar minha margem?']
}

export function OrymaIntelligence() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, minimized])

  async function sendMessage(text?: string) {
    const content = text ?? input.trim()
    if (!content || loading) return

    const userMsg: Message = { role: 'user', content }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          context: getPageContext(pathname),
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.message ?? data.error ?? 'Erro ao obter resposta.' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Erro de conexão. Tente novamente.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const suggestions = getSuggestions(pathname)

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 hover:scale-105 hover:shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, #125BFF, #7B61FF)',
            boxShadow: '0 4px 20px rgba(18,91,255,0.35)',
            animation: 'oryma-pulse 3s ease-in-out infinite',
          }}
          title="Pergunte à Oryma"
        >
          <Sparkles size={18} color="white" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl overflow-hidden shadow-2xl transition-all duration-200"
          style={{
            width: '380px',
            height: minimized ? '56px' : '560px',
            background: '#ffffff',
            border: '1px solid oklch(0.88 0.016 258)',
            boxShadow: '0 20px 60px rgba(18,91,255,0.15)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0 cursor-pointer"
            style={{ background: '#0B1023' }}
            onClick={() => setMinimized(m => !m)}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #125BFF, #7B61FF)' }}
              >
                <Sparkles size={13} color="white" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-white" style={{ fontFamily: 'var(--font-sora)' }}>
                  Oryma Intelligence
                </div>
                <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {loading ? 'Pensando…' : 'Pronto para ajudar'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="p-1 rounded-lg transition-colors"
                style={{ color: 'rgba(255,255,255,0.5)' }}
                onClick={e => { e.stopPropagation(); setMinimized(m => !m) }}
              >
                <ChevronDown size={14} className={minimized ? 'rotate-180' : ''} />
              </button>
              <button
                className="p-1 rounded-lg transition-colors"
                style={{ color: 'rgba(255,255,255,0.5)' }}
                onClick={e => { e.stopPropagation(); setOpen(false) }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ background: 'oklch(0.98 0.004 258)' }}>

                {/* Welcome */}
                {messages.length === 0 && (
                  <div>
                    <div
                      className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm max-w-[85%]"
                      style={{ background: 'white', border: '1px solid oklch(0.88 0.016 258)', color: '#0B1023' }}
                    >
                      <p className="font-medium mb-1" style={{ fontFamily: 'var(--font-sora)', fontSize: '13px' }}>
                        Olá! Sou a Oryma Intelligence ✦
                      </p>
                      <p className="text-xs" style={{ color: 'oklch(0.50 0.025 258)' }}>
                        Estou aqui para ajudar com análises financeiras, tributação Lucro Real e estratégias de precificação. O que você precisa?
                      </p>
                    </div>

                    {/* Suggested questions */}
                    <div className="mt-3 space-y-1.5">
                      {suggestions.map(q => (
                        <button
                          key={q}
                          onClick={() => sendMessage(q)}
                          className="w-full text-left text-xs px-3 py-2 rounded-xl transition-all"
                          style={{
                            background: 'white',
                            border: '1px solid oklch(0.88 0.016 258)',
                            color: '#125BFF',
                          }}
                          onMouseEnter={e => {
                            const el = e.currentTarget as HTMLElement
                            el.style.background = 'oklch(0.94 0.06 258)'
                          }}
                          onMouseLeave={e => {
                            const el = e.currentTarget as HTMLElement
                            el.style.background = 'white'
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message list */}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className="rounded-2xl px-4 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap"
                      style={msg.role === 'user'
                        ? { background: '#125BFF', color: 'white', borderBottomRightRadius: '6px' }
                        : { background: 'white', border: '1px solid oklch(0.88 0.016 258)', color: '#0B1023', borderBottomLeftRadius: '6px' }
                      }
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div
                      className="rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2"
                      style={{ background: 'white', border: '1px solid oklch(0.88 0.016 258)' }}
                    >
                      <Loader2 size={14} className="animate-spin" style={{ color: '#125BFF' }} />
                      <span className="text-xs" style={{ color: 'oklch(0.50 0.025 258)' }}>Analisando…</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid oklch(0.88 0.016 258)' }}>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Pergunte sobre margens, tributos, estoque…"
                    rows={1}
                    className="flex-1 resize-none text-sm rounded-xl px-3 py-2.5 outline-none transition-all"
                    style={{
                      background: 'oklch(0.96 0.010 258)',
                      border: '1px solid oklch(0.88 0.016 258)',
                      color: '#0B1023',
                      fontFamily: 'var(--font-inter)',
                      maxHeight: '120px',
                      lineHeight: '1.4',
                    }}
                    onFocus={e => {
                      const el = e.currentTarget
                      el.style.borderColor = '#125BFF'
                      el.style.boxShadow = '0 0 0 3px rgba(18,91,255,0.10)'
                    }}
                    onBlur={e => {
                      const el = e.currentTarget
                      el.style.borderColor = 'oklch(0.88 0.016 258)'
                      el.style.boxShadow = ''
                    }}
                  />
                  <button
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || loading}
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      background: input.trim() && !loading ? '#125BFF' : 'oklch(0.93 0.014 258)',
                      color: input.trim() && !loading ? 'white' : 'oklch(0.65 0.015 258)',
                    }}
                  >
                    <Send size={14} />
                  </button>
                </div>
                <p className="text-center text-[10px] mt-2" style={{ color: 'oklch(0.65 0.015 258)' }}>
                  Enter para enviar · Shift+Enter para nova linha
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
