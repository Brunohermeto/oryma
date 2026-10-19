/**
 * Relatório "Visão Contas a Pagar" da Conta Azul (.xls que na verdade é .xlsx)
 * → despesas do DRE. Regras do Bruno (19/10/2026):
 *  - mês = VENCIMENTO da parcela (visão de caixa)
 *  - o que o Oryma já conta fica FORA: importação/fornecedores (landed cost/NF de
 *    entrada), ADS do ML (API de Ads), DIFAL das vendas (NF-e)
 *  - certificação (INMETRO/OCAN) dentro de "Importação" NÃO está no landed cost → DRE
 *  - empréstimo = despesa financeira (abaixo do EBITDA); cartão e retenções = despesa
 */
import { unzipSync, strFromU8 } from 'fflate'

export type Destino = string // dre_category de operational_expenses, ou 'ignorar'

// Categoria da Conta Azul → destino. Categoria nova (fora daqui e da tabela
// contaazul_categorias) volta como pendente para o Bruno escolher uma vez.
export const MAPA_PADRAO: Record<string, Destino> = {
  'importação de mercadorias': 'ignorar',
  'fornecedores': 'ignorar',
  'publicidade': 'ignorar',            // "ADS Mercado Livre" — já vem da API de Ads
  'icms difal compra': 'ignorar',      // DIFAL das NFs de venda — já está nos impostos
  'impostos - icms': 'ignorar',
  // Empréstimo: só os JUROS são despesa; o principal é amortização (fora do DRE).
  // Com a parcela inteira em "Empréstimos" ela entra toda como financeira — o ideal
  // é ratear na Conta Azul em "Empréstimos" (principal) + "Juros e Encargos" (19/10/2026)
  'empréstimos': 'despesas_financeiras',
  'juros': 'despesas_financeiras',
  'juros e encargos': 'despesas_financeiras',
  'juros e encargos financeiros': 'despesas_financeiras',
  'despesas financeiras': 'despesas_financeiras',
  'cartão de crédito': 'cartao_credito',
  'aluguel': 'aluguel',
  'salários': 'salarios',
  'encargos funcionários - inss': 'inss_patronal',
  'encargos funcionários - fgts': 'fgts',
  'encargos funcionários - exames pré e demissionais': 'bonificacoes',
  'férias': 'ferias_13',
  'vale alimentação': 'vale_alimentacao',
  'plano de saúde': 'plano_saude',
  'bonificação': 'bonificacoes',
  'transportadora': 'frete_operacional',
  'darf': 'impostos_taxas',
  'impostos - dae': 'impostos_taxas',
  'imposto - simples': 'impostos_taxas',
  'despesas fixas': 'escritorio',
  'reforma': 'manutencao',
  'contabilidade': 'contabilidade_consultoria',
  'terceirizados': 'servicos_terceiros',
  'marketing': 'publicidade_marketing',
  'ads': 'publicidade_marketing',
  'sistemas': 'sistemas_software',
  'ecommerce - ferramentall': 'sistemas_software',
  'energia elétrica': 'energia',
  'água': 'agua',
  'internet': 'escritorio',
  'telefonia e internet': 'escritorio',
}

const CERTIFICACAO = /INMETRO|OCAN|CERTIFICA/i

/** Lê a 1ª planilha de um .xlsx em linhas de células (string | number | null). */
export function lerXlsx(buf: Uint8Array): Array<Array<string | number | null>> {
  const z = unzipSync(buf)
  const xml = (p: string) => (z[p] ? strFromU8(z[p]) : '')
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')))
  const col = (ref: string) => ref.replace(/\d+/g, '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  const rows: Array<Array<string | number | null>> = []
  for (const r of xml('xl/worksheets/sheet1.xml').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Array<string | number | null> = []
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tipo = /t="(\w+)"/.exec(c[2])?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1]
      const inl = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1]
      row[col(c[1])] = tipo === 's' ? shared[Number(v)] : tipo === 'inlineStr' ? unesc(inl ?? '')
        : tipo === 'str' ? unesc(v ?? '') : v == null ? null : Number(v)
    }
    rows.push(Array.from(row, x => x ?? null))
  }
  return rows
}

export type Lancamento = {
  period: string; payment_date: string; categoria: string; destino: Destino | null
  description: string; supplier: string | null; amount: number
}

const dataBr = (v: unknown) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Linhas do relatório → lançamentos classificados (destino null = categoria pendente). */
export function classificar(rows: Array<Array<string | number | null>>, mapa: Record<string, Destino>): Lancamento[] {
  const head = (rows[0] ?? []).map(h => String(h ?? '').trim())
  const idx = (nome: string) => head.findIndex(h => h.toLowerCase() === nome.toLowerCase())
  const iVenc = idx('Data de vencimento'), iDesc = idx('Descrição'), iForn = idx('Nome do fornecedor')
  if (iVenc < 0) throw new Error('Arquivo não parece a "Visão Contas a Pagar" da Conta Azul (sem "Data de vencimento")')
  // pares Categoria N / Valor na Categoria N (lançamento rateado em várias categorias)
  const pares = head.flatMap((h, i) => /^Categoria \d+$/.test(h) ? [[i, idx(`Valor na ${h}`)] as const] : [])
  const out: Lancamento[] = []
  for (const r of rows.slice(1)) {
    const venc = dataBr(r[iVenc]); if (!venc) continue
    for (const [ic, iv] of pares) {
      const categoria = String(r[ic] ?? '').trim(); const valor = Math.abs(Number(r[iv] ?? 0))
      if (!categoria || !valor) continue
      const description = String(r[iDesc] ?? '').trim()
      let destino = mapa[categoria.toLowerCase()] ?? null
      if (destino === 'ignorar' && categoria.toLowerCase() === 'importação de mercadorias' && CERTIFICACAO.test(description)) destino = 'certificacoes'
      out.push({ period: `${venc.slice(0, 7)}-01`, payment_date: venc, categoria, destino, description,
        supplier: r[iForn] ? String(r[iForn]) : null, amount: Math.round(valor * 100) / 100 })
    }
  }
  return out
}
