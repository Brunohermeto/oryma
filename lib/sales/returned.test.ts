/**
 * Checagem da regra de venda devolvida. Rodar: npx tsx lib/sales/returned.test.ts
 */
import assert from 'node:assert'
import { isReturned } from './returned'

// Pedido Amazon 702-4116095-4193039 — devolvido integralmente
assert.equal(isReturned({ gross_price: 1439.1, cancellation: 1439.1 }), true)

// Venda normal
assert.equal(isReturned({ gross_price: 1439.1, cancellation: 0 }), false)
assert.equal(isReturned({ gross_price: 599, cancellation: null }), false)
assert.equal(isReturned({ gross_price: 599 }), false)

// Devolução PARCIAL continua valendo pelo líquido
assert.equal(isReturned({ gross_price: 1000, cancellation: 400 }), false)

// Centavo de diferença por arredondamento do extrato ainda é devolução total
assert.equal(isReturned({ gross_price: 1000, cancellation: 999.995 }), true)

// Numérico como string (PostgREST devolve numeric como string em alguns casos)
assert.equal(isReturned({ gross_price: '699.00', cancellation: '699.00' }), true)

// Sem faturamento não há o que devolver
assert.equal(isReturned({ gross_price: 0, cancellation: 0 }), false)

console.log('ok — isReturned')

// comissão zero real do ML (campanha) conta depois de 5 dias; antes, aguarda o extrato
import { comissaoApurada } from './returned'
const hoje = new Date('2026-10-27T12:00:00-03:00')
assert.equal(comissaoApurada({ marketplace: 'mercado_livre', marketplace_commission: 0, sale_date: '2026-10-10' }, hoje), true)
assert.equal(comissaoApurada({ marketplace: 'mercado_livre', marketplace_commission: 0, sale_date: '2026-10-25' }, hoje), false)
assert.equal(comissaoApurada({ marketplace: 'shopee', marketplace_commission: 0, sale_date: '2026-10-10' }, hoje), false)
assert.equal(comissaoApurada({ marketplace: 'amazon', marketplace_commission: 12.5, sale_date: '2026-10-26' }, hoje), true)
console.log('ok — comissaoApurada')
