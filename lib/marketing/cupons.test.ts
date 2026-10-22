// npx tsx lib/marketing/cupons.test.ts
import assert from 'node:assert/strict'
import { cupomML, cupomShopee } from './cupons'

assert.deepEqual(cupomShopee({ seller_voucher_code: ['BEBE360'], voucher_from_seller: 100, voucher_from_shopee: 0 }), { codigo: 'BEBE360', vendedor: 100, marketplace: 0 })
assert.equal(cupomShopee({ seller_voucher_code: [], voucher_from_shopee: 25 }).codigo, 'Cupom da Shopee')
assert.equal(cupomShopee({ seller_voucher_code: [] }).codigo, '')

const camps = [{ nome: 'NINA', codigo: 'RAGALUMAMARINA', fixo: 25, pct: null, ini: '2026-09-23', fim: '2026-10-23' }]
const det = (seller: number, total: number) => [{ type: 'coupon', items: [{ amounts: { seller, total } }] }]
assert.equal(cupomML(det(25, 25), camps, '2026-10-05', 899).codigo, 'RAGALUMAMARINA (NINA)')
assert.equal(cupomML(det(25, 25), camps, '2026-11-05', 899).codigo, 'Cupom do vendedor R$ 25,00 (campanha ML)') // fora da vigência
assert.deepEqual(cupomML(det(0, 50), camps, '2026-10-05', 899), { codigo: 'Cupom do Mercado Livre', vendedor: 0, marketplace: 50 })
assert.equal(cupomML([{ type: 'discount', items: [] }], camps, '2026-10-05', 899).codigo, '')  // desconto de preço não é cupom
console.log('ok — cupons')
