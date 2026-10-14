// npx tsx lib/marketplace/shopee-fees.test.ts
import assert from 'node:assert/strict'
import { shopeeFees } from './shopee-fees'

// 261011AMWVGDFY: vendido a 699, cupom Shopee 50, comissão/serviço cheios
const a = shopeeFees({ commission_fee: 88.07, service_fee: 35.79, net_commission_fee: 49.47, net_service_fee: 24.39,
  voucher_from_shopee: 50, escrow_amount: 575.14 }, 699)
assert.equal(a.rebate, 50); assert.equal(a.serv, 35.79)

// 261011AVQP4RUE: vendido a 599 com desconto bancado pela Shopee, comissão zerada
// extrato: 599 − PIX 43,92 − cupom 50 = 505,08; ajuste ação comercial 88,07 + 26,00;
// incentivos 29,85 + 50,00 → renda 575,14
const b = shopeeFees({ commission_fee: 88.07, service_fee: 35.79, net_service_fee: 9.79,
  voucher_from_shopee: 50, pix_discount: 43.92, escrow_amount: 575.14 }, 599)
assert.equal(b.cupom, 93.92)
assert.equal(b.rebate, 193.92)  // 114,07 de ajuste + 79,85 de incentivos

// bruto − cupons − tarifas + rebate fecha no repasse
assert.equal(Math.round((599 - b.cupom - b.comm - b.serv + b.rebate) * 100) / 100, 575.14)

// resíduo negativo (frete do vendedor) vira custo, não rebate
const c = shopeeFees({ commission_fee: 10, service_fee: 5, escrow_amount: 70 }, 100)
assert.equal(c.rebate, 0); assert.equal(c.serv, 20)

// financeiro não liberado: sem rebate
assert.equal(shopeeFees({ commission_fee: 10, service_fee: 5 }, 100).rebate, 0)
console.log('ok — shopeeFees')
