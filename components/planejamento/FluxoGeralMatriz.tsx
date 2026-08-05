'use client'

/**
 * Fluxo Geral de Importação — formato da planilha do Bruno: blocos empilhados
 * com as MESMAS colunas de meses (24m). Ler uma coluna de cima a baixo conta a
 * história do mês: entradas → vendas planejadas (EDITÁVEL, com rampa) → saldo
 * de estoque (negativo = ruptura) → faturamento → CMV → estoque em R$ →
 * resumo de caixa da empresa (saldo inicial, dívida, retirada, DIFAL).
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

export interface FluxoGeralData {
  meses: string[]
  rows: Array<{
    productId: string; sku: string; name: string
    estoqueAtual: number; velReal: number; cmp: number
    velProj: number | null            // velocidade PROJETADA (manual, persistida)
    estoqueManual: number | null      // estoque informado manualmente…
    estoqueManualMes: string | null   // …para este mês (normalmente o anterior)
    custoPlan: number | null          // custo unitário vindo do pedido (planilha)
    precoReal: number; precoParam: number | null; marginPct: number
    entradas: Record<string, number>      // pedidos compromissados
    entradasPrev: Record<string, number>  // pedidos PREVISTOS (em estudo)
    plano: Record<string, number>
  }>
  saldoInicial: number
  difalPct: number
  difalSaldoInicial: number
  cashMonths: Record<string, { divida: number; retirada: number }>
}

interface Props {
  data: FluxoGeralData
  pagamentosMes: Record<string, number>   // desencaixe das importações por mês
}

const B = {
  border: 'oklch(0.88 0.016 258)', bgSubtle: 'oklch(0.97 0.008 258)',
  text: '#0B1023', muted: 'oklch(0.50 0.025 258)', brand: '#125BFF',
}
const fmtMes = (m: string) => {
  const n = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${n[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
}
const fmtRk = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}M`
    : a >= 1000 ? `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`
    : a.toFixed(0)
  return v < 0 ? `(${s})` : s
}
const diasNoMes = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()

function Th({ children, left = false }: { children: React.ReactNode; left?: boolean }) {
  return (
    <th className={`px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${left ? 'text-left sticky left-0 bg-white' : 'text-right'}`} style={{ color: B.muted }}>
      {children}
    </th>
  )
}

export function FluxoGeralMatriz({ data, pagamentosMes }: Props) {
  const router = useRouter()
  const { meses } = data
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // Edições locais (aplicadas na tela na hora; "salvar" persiste)
  const [planoEdit, setPlanoEdit] = useState<Record<string, Record<string, number>>>({})
  const [precoEdit, setPrecoEdit] = useState<Record<string, number>>({})
  const [velEdit, setVelEdit] = useState<Record<string, number | null>>({})
  const [estqEdit, setEstqEdit] = useState<Record<string, number | null>>({})
  const [cashEdit, setCashEdit] = useState<Record<string, { divida?: number; retirada?: number }>>({})
  const [cfgEdit, setCfgEdit] = useState<{ saldo_inicial?: number; difal_pct?: number; difal_saldo_inicial?: number }>({})
  const [incluirPrev, setIncluirPrev] = useState(true)

  // mês anterior ao primeiro mês da matriz (editável no bloco 3)
  const mesAnterior = useMemo(() => {
    const d = new Date(Number(meses[0].slice(0, 4)), Number(meses[0].slice(5, 7)) - 1, 1)
    d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [meses])

  const temEdicao = Object.keys(planoEdit).length + Object.keys(precoEdit).length + Object.keys(velEdit).length + Object.keys(estqEdit).length + Object.keys(cashEdit).length + Object.keys(cfgEdit).length > 0

  async function post(payload: Record<string, unknown>) {
    const r = await fetch('/api/import-planning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (!r.ok) throw new Error((await r.json()).error ?? 'falhou')
  }
  async function salvarTudo() {
    setBusy(true); setMsg('Salvando…')
    try {
      const entries: Array<{ product_id: string; mes: string; qty: number }> = []
      for (const [pid, ms] of Object.entries(planoEdit))
        for (const [mes, qty] of Object.entries(ms)) entries.push({ product_id: pid, mes, qty })
      if (entries.length) await post({ action: 'save_sales_plan', entries })
      for (const [pid, preco] of Object.entries(precoEdit)) await post({ action: 'save_price', product_id: pid, preco_venda: preco || null })
      for (const [pid, vel] of Object.entries(velEdit)) await post({ action: 'save_params', product_id: pid, vel_projetada: vel })
      for (const [pid, estq] of Object.entries(estqEdit)) await post({ action: 'save_params', product_id: pid, estoque_manual: estq, estoque_manual_mes: estq === null ? null : mesAnterior })
      for (const [mes, v] of Object.entries(cashEdit)) {
        const base = data.cashMonths[mes] ?? { divida: 0, retirada: 0 }
        await post({ action: 'save_cash_month', mes, divida: v.divida ?? base.divida, retirada: v.retirada ?? base.retirada })
      }
      if (Object.keys(cfgEdit).length) {
        await post({ action: 'save_cash_config', saldo_inicial: cfgEdit.saldo_inicial ?? data.saldoInicial, difal_pct: cfgEdit.difal_pct ?? data.difalPct, difal_saldo_inicial: cfgEdit.difal_saldo_inicial ?? data.difalSaldoInicial })
      }
      setMsg('✓ plano salvo')
      setPlanoEdit({}); setPrecoEdit({}); setVelEdit({}); setEstqEdit({}); setCashEdit({}); setCfgEdit({})
      router.refresh()
    } catch (e) { setMsg(`Erro: ${String(e).replace('Error: ', '')}`) }
    setBusy(false)
  }

  // ── Motor: tudo derivado das edições em tempo real ──
  const calc = useMemo(() => {
    const vendas = new Map<string, Record<string, number>>()   // efetivas (plano ?? sugestão)
    const saldo  = new Map<string, Record<string, number>>()
    const estoqueRsBy = new Map<string, Record<string, number>>() // estoque em R$ por SKU
    const porMes = Object.fromEntries(meses.map(m => [m, { fat: 0, cmv: 0, lucro: 0, estoqueRs: 0, un: 0 }])) as Record<string, { fat: number; cmv: number; lucro: number; estoqueRs: number; un: number }>
    for (const r of data.rows) {
      const vm: Record<string, number> = {}
      const sm: Record<string, number> = {}
      const em: Record<string, number> = {}
      const preco = precoEdit[r.productId] ?? r.precoParam ?? r.precoReal
      const velBase = (velEdit[r.productId] !== undefined ? velEdit[r.productId] : r.velProj) ?? r.velReal
      const custo = r.custoPlan ?? r.cmp
      // estoque manual do mês anterior (edição > salvo) substitui o estoque atual
      const manual = estqEdit[r.productId] !== undefined
        ? estqEdit[r.productId]
        : (r.estoqueManualMes === mesAnterior ? r.estoqueManual : null)
      let s = manual ?? r.estoqueAtual
      for (const m of meses) {
        const planoCel = planoEdit[r.productId]?.[m] ?? r.plano[m]
        const v = planoCel !== undefined ? planoCel : Math.round(velBase * diasNoMes(m))
        vm[m] = v
        const entrada = (r.entradas[m] ?? 0) + (incluirPrev ? (r.entradasPrev[m] ?? 0) : 0)
        s = s + entrada - v
        sm[m] = Math.round(s)
        em[m] = Math.max(s, 0) * custo
        porMes[m].fat       += v * preco
        porMes[m].cmv       += v * custo
        porMes[m].lucro     += v * preco * (r.marginPct / 100)
        porMes[m].estoqueRs += em[m]
        porMes[m].un        += v
      }
      vendas.set(r.productId, vm)
      saldo.set(r.productId, sm)
      estoqueRsBy.set(r.productId, em)
    }
    // Resumo de caixa
    const saldoIni = cfgEdit.saldo_inicial ?? data.saldoInicial
    const difalPct = cfgEdit.difal_pct ?? data.difalPct
    const resumo = meses.map(m => {
      const cm = { ...(data.cashMonths[m] ?? { divida: 0, retirada: 0 }), ...(cashEdit[m] ?? {}) }
      return {
        mes: m,
        fat: porMes[m].fat, lucro: porMes[m].lucro,
        pagImport: pagamentosMes[m] ?? 0,
        divida: cm.divida ?? 0, retirada: cm.retirada ?? 0,
        estoqueRs: porMes[m].estoqueRs,
        difalMes: porMes[m].fat * (difalPct / 100),
      }
    })
    let acumulado = saldoIni, difalAcum = cfgEdit.difal_saldo_inicial ?? data.difalSaldoInicial
    const linhasCaixa = resumo.map(r => {
      const liquidoMes = r.lucro - r.pagImport - r.divida - r.retirada
      acumulado += liquidoMes
      difalAcum += r.difalMes
      return { ...r, liquidoMes, acumulado, difalAcum, saldoMenosDifal: acumulado - difalAcum, saldoMaisEstoque: acumulado + r.estoqueRs }
    })
    // preço médio ponderado da projeção (Σ faturamento ÷ Σ unidades)
    const totFat = meses.reduce((a, m) => a + porMes[m].fat, 0)
    const totUn  = meses.reduce((a, m) => a + porMes[m].un, 0)
    const precoPonderado = totUn > 0 ? totFat / totUn : 0
    return { vendas, saldo, estoqueRsBy, porMes, linhasCaixa, precoPonderado }
  }, [data, meses, mesAnterior, planoEdit, precoEdit, velEdit, estqEdit, cashEdit, cfgEdit, incluirPrev, pagamentosMes])

  const inputCls = 'w-14 text-right text-[12px] px-1 py-0.5 rounded outline-none'
  const inputStyle = (edited: boolean) => ({
    border: `1px solid ${edited ? '#d97706' : 'transparent'}`,
    background: edited ? 'oklch(0.98 0.03 70)' : 'transparent',
    color: B.text, fontFamily: 'var(--font-geist-mono)',
  })

  function Bloco({ titulo, sub, children, open = true }: { titulo: string; sub?: string; children: React.ReactNode; open?: boolean }) {
    return (
      <details open={open} className="bg-white rounded-2xl" style={{ border: `1px solid ${B.border}` }}>
        <summary className="cursor-pointer select-none px-5 py-3">
          <span className="font-semibold text-sm" style={{ color: B.text, fontFamily: 'var(--font-sora)' }}>{titulo}</span>
          {sub && <span className="text-[11px] ml-2" style={{ color: B.muted }}>{sub}</span>}
        </summary>
        <div className="px-5 pb-4 overflow-x-auto">{children}</div>
      </details>
    )
  }

  const HeadMeses = ({ firstCols }: { firstCols: string[] }) => (
    <thead>
      <tr style={{ borderBottom: `2px solid ${B.border}` }}>
        {firstCols.map((c, i) => <Th key={c + i} left={i === 0}>{c}</Th>)}
        {meses.map(m => <Th key={m}>{fmtMes(m)}</Th>)}
      </tr>
    </thead>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[12px]" style={{ color: B.muted }}>
          Formato da planilha: mesmas colunas de meses em todos os blocos. Células âmbar = editadas (plano).
        </span>
        {temEdicao && (
          <button onClick={salvarTudo} disabled={busy}
                  className="text-[12px] font-bold px-4 py-1.5 rounded-lg cursor-pointer"
                  style={{ background: '#d97706', color: 'white', border: 'none' }}>
            {busy ? 'salvando…' : 'salvar alterações do plano'}
          </button>
        )}
        {busy && <RefreshCw size={13} className="animate-spin" style={{ color: B.muted }} />}
        {msg && <span className="text-[12px]" style={{ color: msg.startsWith('Erro') ? '#dc2626' : '#16a34a' }}>{msg}</span>}
      </div>

      {/* 1. ENTRADA DE ESTOQUE */}
      <Bloco titulo="1 · Entrada de estoque" sub="azul = pedidos em curso/compromissados · âmbar tracejado = pedidos PLANEJADOS (em estudo)" open={false}>
        <label className="text-[12px] flex items-center gap-1.5 mb-2" style={{ color: B.muted }}>
          <input type="checkbox" checked={incluirPrev} onChange={e => setIncluirPrev(e.target.checked)} />
          incluir pedidos planejados (em estudo) nos cálculos
        </label>
        <table className="text-[12px]" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <HeadMeses firstCols={['SKU']} />
          <tbody>
            {data.rows.map(r => (
              <tr key={r.productId} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-2 py-1.5 sticky left-0 bg-white text-[12px] font-medium whitespace-nowrap" style={{ color: B.text }}>{r.sku}</td>
                {meses.map(m => {
                  const firm = r.entradas[m] ?? 0
                  const prev = incluirPrev ? (r.entradasPrev[m] ?? 0) : 0
                  return (
                    <td key={m} className="px-2 py-1.5 text-right whitespace-nowrap" style={{ fontFamily: 'var(--font-geist-mono)' }}>
                      {firm > 0 && <span style={{ color: '#125BFF', fontWeight: 700 }}>{firm}</span>}
                      {firm > 0 && prev > 0 && <span style={{ color: B.muted }}> + </span>}
                      {prev > 0 && <span style={{ color: '#d97706', fontWeight: 700, borderBottom: '1.5px dashed #d97706' }}>{prev}</span>}
                      {firm === 0 && prev === 0 && <span style={{ color: 'oklch(0.88 0.01 258)' }}>·</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Bloco>

      {/* 2. VENDAS PLANEJADAS (editável) */}
      <Bloco titulo="2 · Vendas planejadas por mês" sub="EDITÁVEL — sugestão = velocidade (projetada, se preenchida; senão a real) × dias do mês">
        <table className="text-[12px]" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <HeadMeses firstCols={['SKU', 'Vel real', 'Vel proj']} />
          <tbody>
            {data.rows.map(r => {
              const velProjVal = velEdit[r.productId] !== undefined ? velEdit[r.productId] : r.velProj
              const velBase = velProjVal ?? r.velReal
              return (
              <tr key={r.productId} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-2 py-1 sticky left-0 bg-white text-[12px] font-medium whitespace-nowrap" style={{ color: B.text }}>{r.sku}</td>
                <td className="px-2 py-1 text-right" style={{ color: B.muted, fontFamily: 'var(--font-geist-mono)' }}>{r.velReal.toFixed(1)}/d</td>
                <td className="px-1 py-0.5 text-right">
                  <input type="number" step="0.1" min="0" placeholder="—"
                    value={velProjVal ?? ''}
                    onChange={e => setVelEdit(prev => ({ ...prev, [r.productId]: e.target.value === '' ? null : Number(e.target.value) }))}
                    className="w-14 text-right text-[12px] px-1 py-0.5 rounded outline-none"
                    style={{ ...inputStyle(velEdit[r.productId] !== undefined), border: `1px solid ${velEdit[r.productId] !== undefined ? '#d97706' : B.border}` }} />
                </td>
                {meses.map(m => {
                  const edited = planoEdit[r.productId]?.[m] !== undefined
                  const persisted = r.plano[m] !== undefined
                  const val = planoEdit[r.productId]?.[m] ?? r.plano[m] ?? Math.round(velBase * diasNoMes(m))
                  return (
                    <td key={m} className="px-1 py-0.5 text-right">
                      <input
                        type="number" min="0"
                        value={val}
                        onChange={e => setPlanoEdit(prev => ({
                          ...prev,
                          [r.productId]: { ...(prev[r.productId] ?? {}), [m]: Math.max(0, Number(e.target.value)) },
                        }))}
                        className={inputCls}
                        style={{
                          ...inputStyle(edited),
                          color: edited ? '#92400e' : persisted ? B.text : 'oklch(0.62 0.02 258)',
                          fontWeight: edited || persisted ? 700 : 400,
                        }}
                      />
                    </td>
                  )
                })}
              </tr>
            )})}
          </tbody>
        </table>
        <div className="text-[11px] mt-2" style={{ color: B.muted }}>
          Números cinza = sugestão automática (Vel proj, se preenchida; senão a velocidade real). Ao editar, a célula vira parte do SEU plano e é salva.
        </div>
      </Bloco>

      {/* 3. SALDO DE ESTOQUE */}
      <Bloco titulo="3 · Saldo final de estoque" sub={`estoque + entradas − vendas planejadas · vermelho = ruptura · "${fmtMes(mesAnterior)} manual" = ponto de partida editável (vazio = usa o estoque real de hoje)`}>
        <table className="text-[12px]" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <HeadMeses firstCols={['SKU', `${fmtMes(mesAnterior)} manual`, 'Hoje']} />
          <tbody>
            {data.rows.map(r => (
              <tr key={r.productId} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-2 py-1.5 sticky left-0 bg-white text-[12px] font-medium whitespace-nowrap" style={{ color: B.text }}>{r.sku}</td>
                <td className="px-1 py-0.5 text-right">
                  <input type="number" min="0" placeholder="—"
                    value={(estqEdit[r.productId] !== undefined ? estqEdit[r.productId] : (r.estoqueManualMes === mesAnterior ? r.estoqueManual : null)) ?? ''}
                    onChange={e => setEstqEdit(prev => ({ ...prev, [r.productId]: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) }))}
                    className="w-14 text-right text-[12px] px-1 py-0.5 rounded outline-none"
                    style={{ ...inputStyle(estqEdit[r.productId] !== undefined), border: `1px solid ${estqEdit[r.productId] !== undefined ? '#d97706' : B.border}` }} />
                </td>
                <td className="px-2 py-1.5 text-right font-semibold" style={{ fontFamily: 'var(--font-geist-mono)' }}>{r.estoqueAtual}</td>
                {meses.map(m => {
                  const s = calc.saldo.get(r.productId)?.[m] ?? 0
                  const cob30 = r.velReal * 30
                  return (
                    <td key={m} className="px-2 py-1.5 text-right" style={{
                      fontFamily: 'var(--font-geist-mono)',
                      background: s < 0 ? 'oklch(0.94 0.06 25)' : s < cob30 ? 'oklch(0.97 0.06 70)' : undefined,
                      color: s < 0 ? '#dc2626' : s < cob30 ? '#92400e' : B.text,
                      fontWeight: s < 0 ? 700 : 500,
                    }}>
                      {s.toLocaleString('pt-BR')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Bloco>

      {/* 4. FATURAMENTO */}
      <Bloco titulo="4 · Faturamento projetado" sub="vendas planejadas × preço (edite o preço por produto)" open={false}>
        <table className="text-[12px]" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <HeadMeses firstCols={['SKU', 'Preço R$']} />
          <tbody>
            {data.rows.map(r => {
              const preco = precoEdit[r.productId] ?? r.precoParam ?? r.precoReal
              const vm = calc.vendas.get(r.productId) ?? {}
              return (
                <tr key={r.productId} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                  <td className="px-2 py-1 sticky left-0 bg-white text-[12px] font-medium whitespace-nowrap" style={{ color: B.text }}>{r.sku}</td>
                  <td className="px-1 py-0.5 text-right">
                    <input type="number" min="0" step="10" value={preco}
                      onChange={e => setPrecoEdit(prev => ({ ...prev, [r.productId]: Number(e.target.value) }))}
                      className="w-16 text-right text-[12px] px-1 py-0.5 rounded outline-none"
                      style={inputStyle(precoEdit[r.productId] !== undefined)} />
                    {r.precoReal > 0 && Math.abs(preco - r.precoReal) > 0.5 && (
                      <div className="text-[10px]" style={{ color: B.muted }}>médio real: {r.precoReal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
                    )}
                  </td>
                  {meses.map(m => (
                    <td key={m} className="px-2 py-1 text-right" style={{ fontFamily: 'var(--font-geist-mono)', color: (vm[m] ?? 0) > 0 ? B.text : 'oklch(0.88 0.01 258)' }}>
                      {(vm[m] ?? 0) > 0 ? fmtRk(vm[m] * preco) : '·'}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr style={{ borderTop: `2px solid ${B.border}`, background: B.bgSubtle }}>
              <td className="px-2 py-1.5 text-[11px] font-bold sticky left-0" style={{ background: B.bgSubtle }}>TOTAL</td>
              <td />
              {meses.map(m => (
                <td key={m} className="px-2 py-1.5 text-right font-bold" style={{ fontFamily: 'var(--font-geist-mono)' }}>{fmtRk(calc.porMes[m].fat)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </Bloco>

      {/* 5. CMV + ESTOQUE EM R$ */}
      <Bloco titulo="5 · CMV e capital em estoque" sub="estoque valorizado a custo POR SKU · custo do pedido (se informado no cadastro) ou CMP · CMV total do mês" open={false}>
        <table className="text-[12px]" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <HeadMeses firstCols={['SKU', 'Custo un.']} />
          <tbody>
            {data.rows.map(r => {
              const custo = r.custoPlan ?? r.cmp
              const em = calc.estoqueRsBy.get(r.productId) ?? {}
              return (
                <tr key={r.productId} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                  <td className="px-2 py-1.5 sticky left-0 bg-white text-[12px] font-medium whitespace-nowrap" style={{ color: B.text }}>{r.sku}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap" style={{ fontFamily: 'var(--font-geist-mono)', color: r.custoPlan != null ? '#125BFF' : B.muted }}
                      title={r.custoPlan != null ? 'custo informado no pedido' : 'CMP (custo médio da plataforma)'}>
                    {custo > 0 ? custo.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'}{r.custoPlan != null ? '*' : ''}
                  </td>
                  {meses.map(m => (
                    <td key={m} className="px-2 py-1.5 text-right" style={{ fontFamily: 'var(--font-geist-mono)', color: (em[m] ?? 0) > 0 ? '#7B61FF' : 'oklch(0.88 0.01 258)' }}>
                      {(em[m] ?? 0) > 0 ? fmtRk(em[m]) : '·'}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr style={{ borderTop: `2px solid ${B.border}`, background: B.bgSubtle }}>
              <td className="px-2 py-1.5 text-[11px] font-bold sticky left-0 whitespace-nowrap" style={{ background: B.bgSubtle, color: '#7B61FF' }}>ESTOQUE TOTAL R$</td>
              <td style={{ background: B.bgSubtle }} />
              {meses.map(m => (
                <td key={m} className="px-2 py-1.5 text-right font-bold" style={{ fontFamily: 'var(--font-geist-mono)', color: '#7B61FF' }}>{fmtRk(calc.porMes[m].estoqueRs)}</td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1.5 sticky left-0 bg-white text-[12px] font-semibold whitespace-nowrap" style={{ color: '#dc2626' }}>CMV do mês</td>
              <td />
              {meses.map(m => (
                <td key={m} className="px-2 py-1.5 text-right" style={{ fontFamily: 'var(--font-geist-mono)', color: '#dc2626' }}>{fmtRk(calc.porMes[m].cmv)}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <div className="text-[11px] mt-2" style={{ color: B.muted }}>
          * = custo unitário informado no cadastro do pedido (custo total ÷ quantidade). Sem asterisco = CMP da plataforma. Este custo é da PLANILHA de planejamento — não altera o cálculo de margem do Oryma.
        </div>
      </Bloco>

      {/* 6. RESUMO DE CAIXA */}
      <Bloco titulo="6 · Resumo de caixa da empresa" sub="lucro projetado − importações − dívida − retiradas · DIFAL acumulado">
        <div className="flex items-center gap-4 flex-wrap mb-3 text-[12px]" style={{ color: B.muted }}>
          <label>Saldo inicial (R$):{' '}
            <input type="number" step="1000"
              value={cfgEdit.saldo_inicial ?? data.saldoInicial}
              onChange={e => setCfgEdit(prev => ({ ...prev, saldo_inicial: Number(e.target.value) }))}
              className="w-28 text-right text-[12px] px-1.5 py-0.5 rounded outline-none"
              style={{ ...inputStyle(cfgEdit.saldo_inicial !== undefined), border: `1px solid ${B.border}` }} />
          </label>
          <label>DIFAL estimado (% do faturamento):{' '}
            <input type="number" step="0.5" min="0" max="30"
              value={cfgEdit.difal_pct ?? data.difalPct}
              onChange={e => setCfgEdit(prev => ({ ...prev, difal_pct: Number(e.target.value) }))}
              className="w-16 text-right text-[12px] px-1.5 py-0.5 rounded outline-none"
              style={{ ...inputStyle(cfgEdit.difal_pct !== undefined), border: `1px solid ${B.border}` }} />
          </label>
          <label>Saldo inicial do DIFAL (R$ já devidos):{' '}
            <input type="number" step="1000" min="0"
              value={cfgEdit.difal_saldo_inicial ?? data.difalSaldoInicial}
              onChange={e => setCfgEdit(prev => ({ ...prev, difal_saldo_inicial: Number(e.target.value) }))}
              className="w-24 text-right text-[12px] px-1.5 py-0.5 rounded outline-none"
              style={{ ...inputStyle(cfgEdit.difal_saldo_inicial !== undefined), border: `1px solid ${B.border}` }} />
          </label>
          <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: B.bgSubtle, color: B.text }}>
            preço médio ponderado da projeção: R$ {calc.precoPonderado.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
          </span>
        </div>
        <table className="text-[12px]" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <HeadMeses firstCols={['Linha']} />
          <tbody>
            {([
              ['Faturamento', (l: any) => fmtRk(l.fat), B.text],
              ['Lucro projetado', (l: any) => fmtRk(l.lucro), '#16a34a'],
              ['(−) Importações', (l: any) => l.pagImport ? fmtRk(-l.pagImport) : '·', '#dc2626'],
            ] as const).map(([label, fn, cor]) => (
              <tr key={label as string} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-2 py-1.5 sticky left-0 bg-white text-[12px] font-semibold whitespace-nowrap" style={{ color: cor as string }}>{label as string}</td>
                {calc.linhasCaixa.map(l => (
                  <td key={l.mes} className="px-2 py-1.5 text-right" style={{ fontFamily: 'var(--font-geist-mono)', color: cor as string }}>{(fn as any)(l)}</td>
                ))}
              </tr>
            ))}
            {/* Dívida e Retirada — editáveis */}
            {(['divida', 'retirada'] as const).map(campo => (
              <tr key={campo} style={{ borderBottom: `1px solid ${B.bgSubtle}` }}>
                <td className="px-2 py-1 sticky left-0 bg-white text-[12px] font-semibold whitespace-nowrap" style={{ color: '#dc2626' }}>
                  (−) {campo === 'divida' ? 'Pagamento dívida' : 'Retirada sócios'}
                </td>
                {calc.linhasCaixa.map(l => {
                  const edited = cashEdit[l.mes]?.[campo] !== undefined
                  return (
                    <td key={l.mes} className="px-1 py-0.5 text-right">
                      <input type="number" min="0" step="1000"
                        value={cashEdit[l.mes]?.[campo] ?? (campo === 'divida' ? l.divida : l.retirada)}
                        onChange={e => setCashEdit(prev => ({ ...prev, [l.mes]: { ...(prev[l.mes] ?? {}), [campo]: Math.max(0, Number(e.target.value)) } }))}
                        className="w-16 text-right text-[12px] px-1 py-0.5 rounded outline-none"
                        style={{ ...inputStyle(edited), color: '#dc2626' }} />
                    </td>
                  )
                })}
              </tr>
            ))}
            {([
              ['= Líquido do mês', (l: any) => fmtRk(l.liquidoMes), (l: any) => l.liquidoMes >= 0 ? '#16a34a' : '#dc2626'],
              ['= SALDO ACUMULADO', (l: any) => fmtRk(l.acumulado), (l: any) => l.acumulado >= 0 ? B.text : '#dc2626', true],
              ['DIFAL a pagar (acum.)', (l: any) => fmtRk(-l.difalAcum), () => '#d97706'],
              ['Saldo − DIFAL', (l: any) => fmtRk(l.saldoMenosDifal), (l: any) => l.saldoMenosDifal >= 0 ? B.text : '#dc2626'],
              ['Saldo + Estoque', (l: any) => fmtRk(l.saldoMaisEstoque), () => '#7B61FF'],
            ] as const).map(([label, fn, corFn, bold]) => (
              <tr key={label as string} style={{ borderBottom: `1px solid ${B.bgSubtle}`, background: bold ? B.bgSubtle : undefined }}>
                <td className="px-2 py-1.5 sticky left-0 text-[12px] font-bold whitespace-nowrap" style={{ color: B.text, background: bold ? B.bgSubtle : 'white' }}>{label as string}</td>
                {calc.linhasCaixa.map(l => (
                  <td key={l.mes} className="px-2 py-1.5 text-right font-bold" style={{ fontFamily: 'var(--font-geist-mono)', color: (corFn as any)(l) }}>{(fn as any)(l)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[11px] mt-2" style={{ color: B.muted }}>
          Lucro projetado usa a margem real média de cada produto (todos os custos e impostos, crédito devolvido).
          "Importações" = parcelas em aberto dos pedidos. DIFAL estimado como % do faturamento, acumulando até o pagamento.
        </div>
      </Bloco>
    </div>
  )
}
