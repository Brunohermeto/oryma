/**
 * Checagem da fórmula única de faturamento/margem. Rodar: npx tsx lib/sales/metrics.test.ts
 */
import assert from 'node:assert'
import { liq, marginAgg, aggBy } from './metrics'

assert.equal(liq({ gross_price: '100', cancellation: 10, discounts: 5 }), 85)
assert.equal(liq({ gross_price: 100 }), 100)

// margem ponderada: só vendas com margin_value entram no numerador E na base
const rows = [
  { gross_price: 100, discounts: 0, margin_value: 20, mp: 'a' },
  { gross_price: 300, discounts: 0, margin_value: null, mp: 'a' },   // em cálculo
  { gross_price: 200, discounts: 0, margin_value: -10, mp: 'b' },    // negativa vale
]
const t = marginAgg(rows)
assert.equal(t.mv, 10)
assert.equal(t.base, 300)
assert.ok(Math.abs(t.pct! - 10 / 3) < 1e-9)

// sem base → null, nunca 0
assert.equal(marginAgg([{ gross_price: 100, margin_value: null }]).pct, null)
assert.equal(marginAgg([]).pct, null)

const by = aggBy(rows, r => r.mp)
assert.equal(by.get('a')!.revenue, 400)
assert.equal(by.get('a')!.orders, 2)
assert.equal(by.get('b')!.mv, -10)

console.log('ok — metrics')
