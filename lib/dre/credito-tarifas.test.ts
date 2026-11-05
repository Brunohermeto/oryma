import assert from 'node:assert/strict'
import { creditoTarifas } from './credito-tarifas'

assert.equal(Math.round(creditoTarifas(100, 0, 0, 0, 0) * 100) / 100, 9.25)
// Ads entra na base
assert.equal(Math.round(creditoTarifas(0, 0, 0, 100, 0) * 100) / 100, 9.25)
// rebate sai da base
assert.equal(Math.round(creditoTarifas(100, 5, 20, 0, 25) * 100) / 100, 9.25)
// rebate maior que as tarifas não vira débito
assert.equal(creditoTarifas(10, 0, 0, 0, 50), 0)
console.log('ok — creditoTarifas')
