// npx tsx lib/despesas/contaazul.test.ts [arquivo.xls opcional]
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classificar, lerXlsx, MAPA_PADRAO } from './contaazul'

const head = ['Nome do fornecedor', 'Data de vencimento', 'Descrição', 'Categoria 1', 'Valor na Categoria 1']
const ls = classificar([head,
  [null, '01/09/2026', 'Quanttun Contabilidade', 'Contabilidade', -3512.41],
  [null, '19/09/2026', 'OCAN CERTIFICAÇÃO E AVALIAÇÃO', 'Importação de Mercadorias', -2867.64],
  [null, '09/09/2026', 'DA26MU09011 - Fornecedor parcela 1', 'Importação de Mercadorias', -27109.2],
  [null, '10/09/2026', 'algo novo', 'Categoria Nova', -10],
], MAPA_PADRAO)
assert.equal(ls[0].destino, 'contabilidade_consultoria'); assert.equal(ls[0].amount, 3512.41); assert.equal(ls[0].period, '2026-09-01')
assert.equal(ls[1].destino, 'certificacoes')   // certificação não está no landed cost
assert.equal(ls[2].destino, 'ignorar')         // mercadoria importada já está no CMV
assert.equal(ls[3].destino, null)              // categoria desconhecida → pendente

if (process.argv[2]) {
  const real = classificar(lerXlsx(readFileSync(process.argv[2])), MAPA_PADRAO)
  const soma = (f: (l: typeof real[number]) => boolean) => Math.round(real.filter(f).reduce((s, l) => s + l.amount, 0))
  console.log('linhas', real.length, '| DRE', soma(l => !!l.destino && l.destino !== 'ignorar'),
    '| ignorado', soma(l => l.destino === 'ignorar'), '| pendente', real.filter(l => !l.destino).map(l => l.categoria))
}
console.log('ok — contaazul')
