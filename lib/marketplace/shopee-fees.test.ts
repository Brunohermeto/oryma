// npx tsx lib/marketplace/shopee-fees.test.ts
import assert from 'node:assert/strict'
import { shopeeFees } from './shopee-fees'

// 261011AMWVGDFY: vendido a 699, cupom Shopee 50, comissão/serviço cheios
const a = shopeeFees({ commission_fee: 88.07, service_fee: 35.79, net_commission_fee: 49.47, net_service_fee: 24.39,
  voucher_from_shopee: 50, escrow_amount: 575.14 }, 699)
assert.equal(a.rebate, 50); assert.equal(a.serv, 35.79)

// 261011AVQP4RUE: vendido a 599 com desconto bancado pela Shopee, comissão zerada
const b = shopeeFees({ commission_fee: 88.07, service_fee: 35.79, net_service_fee: 9.79,
  voucher_from_shopee: 50, escrow_amount: 575.14 }, 599)
assert.equal(b.rebate, 150)  // 100 do preço + 50 do cupom Shopee

// bruto − cupons − tarifas + rebate fecha no repasse
assert.equal(Math.round((599 - b.cupom - b.comm - b.serv + b.rebate) * 100) / 100, 575.14)

// resíduo negativo (frete do vendedor) vira custo, não rebate
const c = shopeeFees({ commission_fee: 10, service_fee: 5, escrow_amount: 70 }, 100)
assert.equal(c.rebate, 0); assert.equal(c.serv, 20)

// financeiro não liberado: sem rebate
assert.equal(shopeeFees({ commission_fee: 10, service_fee: 5 }, 100).rebate, 0)
console.log('ok — shopeeFees')
