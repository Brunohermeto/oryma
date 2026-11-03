/**
 * DRE comparativo dos últimos 12 meses (pedido do Bruno 03/11/2026: "mais
 * simplificado, comparativo de 12 meses, subtotais em cada categoria").
 * Reaproveita o buildDRE mensal (coluna Total) e reorganiza:
 *  - cada seção vira UMA linha de subtotal, com o detalhe recolhível;
 *  - só ficam os resultados-chave (Receita Líquida, Lucro Bruto, EBITDA, Resultado);
 *  - margens % logo abaixo de cada resultado.
 */
import { buildDRE } from './engine'
import type { DRERow } from '@/types'

export type LinhaComparativo = {
  key: string
  label: string
  tipo: 'linha' | 'grupo' | 'detalhe' | 'resultado' | 'pct'
  grupo?: string
  valores: number[]
  total: number
}

// Resultados que ficam visíveis (os demais "= ..." intermediários somem)
const RESULTADOS = ['= Receita Líquida de Mercado', '= LUCRO BRUTO', '= EBITDA', '= RESULTADO LÍQUIDO']
const PCT: Record<string, string> = {
  '= LUCRO BRUTO': 'Margem bruta',
  '= EBITDA': 'Margem EBITDA',
  '= RESULTADO LÍQUIDO': 'Margem líquida',
}
const NOME_GRUPO: Record<string, string> = {
  'Impostos sobre Vendas': '(-) Impostos sobre vendas',
  'Custos do Canal de Venda': '(-) Custos dos marketplaces',
  'Custo dos Produtos Vendidos': '(-) Custo dos produtos (CMV)',
  'Despesas com Pessoal': '(-) Despesas com pessoal',
  'Despesas Operacionais': '(-) Despesas operacionais',
  'Resultado Financeiro': '(-) Despesas financeiras',
  'Apuração Tributária (Lucro Real)': '(-) IRPJ e CSLL',
}
// rótulo sem a margem embutida: "= EBITDA  (12.3% mg. EBITDA)" → "= EBITDA"
const limpa = (l: string) => l.split('  (')[0]

/** Sequência de chaves + valores de UM mês, já no formato simplificado. */
function achata(rows: DRERow[]) {
  const seq: Array<Omit<LinhaComparativo, 'valores' | 'total'> & { valor: number }> = []
  let grupo = ''
  let sub: (typeof seq)[number] | null = null
  for (const r of rows) {
    const label = limpa(r.label)
    if (r.isHeader) {
      grupo = r.label
      sub = null
      if (grupo !== 'Receita') {
        sub = { key: `g:${grupo}`, label: NOME_GRUPO[grupo] ?? grupo, tipo: 'grupo', valor: 0 }
        seq.push(sub)
      }
      continue
    }
    if (r.isTotal || r.isHighlight) {
      if (RESULTADOS.includes(label)) seq.push({ key: `t:${label}`, label: label.replace('= ', ''), tipo: 'resultado', valor: r.total })
      continue
    }
    if (!sub) { seq.push({ key: `d:${grupo}:${label}`, label: label.replace(/^\([+-]\) /, ''), tipo: 'linha', valor: r.total }); continue }
    sub.valor += r.total
    seq.push({ key: `d:${grupo}:${label}`, label: label.replace(/^\([+-]\) /, ''), tipo: 'detalhe', grupo: sub.key, valor: r.total })
  }
  return seq
}

/** Últimos 12 meses terminando em `fim` (inclusive). */
export async function buildDREComparativo(fim: Date) {
  const meses = Array.from({ length: 12 }, (_, i) => new Date(fim.getFullYear(), fim.getMonth() - 11 + i, 1))
  const porMes = await Promise.all(meses.map(m => buildDRE(m).then(achata)))

  // ordem estável: chave nova entra logo depois da anterior do mesmo mês
  // (despesa que só existe em alguns meses fica dentro do seu grupo)
  const ordem: string[] = []
  const meta = new Map<string, Omit<LinhaComparativo, 'valores' | 'total'>>()
  const valores = new Map<string, number[]>()
  porMes.forEach((seq, i) => {
    let ant: string | null = null
    for (const { valor, ...m } of seq) {
      if (!meta.has(m.key)) {
        meta.set(m.key, m)
        valores.set(m.key, Array(12).fill(0))
        ordem.splice(ant ? ordem.indexOf(ant) + 1 : 0, 0, m.key)
      }
      valores.get(m.key)![i] = valor
      ant = m.key
    }
  })

  const receita = valores.get('t:= Receita Líquida de Mercado') ?? Array(12).fill(0)
  const soma = (v: number[]) => v.reduce((s, x) => s + x, 0)
  const linhas: LinhaComparativo[] = []
  for (const key of ordem) {
    const v = valores.get(key)!
    linhas.push({ ...meta.get(key)!, valores: v, total: soma(v) })
    const nomePct = PCT[key.slice(2)]
    if (nomePct) {
      linhas.push({
        key: `p:${key}`, label: nomePct, tipo: 'pct',
        valores: v.map((x, i) => (receita[i] ? (x / receita[i]) * 100 : 0)),
        total: soma(receita) ? (soma(v) / soma(receita)) * 100 : 0,
      })
    }
  }
  // mês sem despesas importadas da Conta Azul: EBITDA fica superestimado — avisa
  const semDespesas = meses.map((_, i) =>
    receita[i] !== 0 && !['g:Despesas com Pessoal', 'g:Despesas Operacionais'].some(k => valores.get(k)?.[i]))
  return { meses: meses.map(m => `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`), linhas, semDespesas }
}
