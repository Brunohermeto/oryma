import { expectedPayout, payoutDiff, isPayoutDivergent } from './payout'

// Rodar: npx tsx lib/sales/payout.test.ts
function eq(a: number, b: number, msg: string) {
  if (Math.abs(a - b) > 0.001) throw new Error(`FALHOU ${msg}: ${a} !== ${b}`)
}

// esperado = bruto - devolução - comissão - fixa - frete vendedor - ads - cupom + rebate
eq(expectedPayout({ gross_price: 100, marketplace_commission: 12, marketplace_fixed_fee: 4, discounts: 2 }), 82, 'basico')
eq(expectedPayout({ gross_price: 100, cancellation: 100 }), 0, 'devolvido integral')
eq(expectedPayout({ gross_price: 100, marketplace_shipping_fee: 10, ads_cost: 5, rebate: 3 }), 88, 'frete+ads+rebate')

// diferença = real - esperado
eq(payoutDiff({ gross_price: 100, marketplace_commission: 12, payout_actual: 88 }), 0, 'bate certinho')
eq(payoutDiff({ gross_price: 100, marketplace_commission: 12, payout_actual: 80 }), -8, 'pagou 8 a menos')

// divergência relevante: > R$1 E > 2%
if (isPayoutDivergent({ gross_price: 100, marketplace_commission: 12, payout_actual: 87.5 })) throw new Error('0,50 nao deveria alertar')
if (!isPayoutDivergent({ gross_price: 100, marketplace_commission: 12, payout_actual: 80 })) throw new Error('8 deveria alertar')
if (isPayoutDivergent({ gross_price: 100, marketplace_commission: 12 })) throw new Error('sem payout_actual nao concilia')

console.log('payout: todos os checks passaram ✓')
