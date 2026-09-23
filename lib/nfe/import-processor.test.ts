// Auto-checagem do resolvedor NF → SKU (famílias Ragaluma). Rodar: npx tsx lib/nfe/import-processor.test.ts
import { resolveVariantSkus as r } from './import-processor'

const casos: [string, string, string[]][] = [
  ['CFOP3102', 'GRAY-3038 - BERCO PORTATIL DE METAL, DOIS ANDARES', ['RAGA001-C']],
  ['CFOP3102', 'BERCO PORTATIL DE METAL, DOIS ANDARES, COM TECIDO DE LINHO', ['RAGA001-C', 'RAGA001-R', 'RAGA001-A', 'RAGA001-B']],
  ['CFOP3102', 'CADEIRA DE ALIMENTACAO RAGALUMA LUPPA 12 EM 1 - CINZA', ['RAGA002-CINZA']],
  ['CFOP5152', 'MUH-035-1 - CADEIRA DE ALIMENTACAO INFANTIL CINZA RAJADO', ['RAGA002-C']],
  ['CFOP5152', 'MUH-035-1 - CADEIRA DE ALIMENTACAO INFANTIL ROSA MUH-035-1', ['RAGA002-R']],
  ['CFOP3102', 'MUB004 - BERCO INFANTIL DO TIPO BEDSIDE SLEEPER, NA COR BEGE (BEIGE)', ['RAGA003-BG']],
  ['CFOP3102', 'MUC101 - DISPOSITIVO DE RETENCAO PARA CRIANCAS', ['RAGA004-BG', 'RAGA004-P', 'RAGA004-C']],
  ['CFOP3102', 'COLCHAO PARA TROCADOR DE BEBE - SENDO PARTE DE REPOSICAO PARA O BERCO', []],
  ['CFOP5557', 'CAIXA DE PAPELAO ONDULADO (CARTON BOX) VAZIA, EMBALAGEM DE REPOSIC', []],
  ['RAGA002-C', 'qualquer', ['RAGA002-C']],
]
let falhas = 0
for (const [c, x, esperado] of casos) {
  const obtido = r(c, x)
  if (JSON.stringify(obtido) !== JSON.stringify(esperado)) { falhas++; console.log('FALHOU', x.slice(0, 45), obtido, esperado) }
}
console.log(`${casos.length - falhas}/${casos.length} ok`)
if (falhas) process.exit(1)
