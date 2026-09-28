// Auto-checagem do total da NF. Rodar: npx tsx lib/nfe/xml-total.test.ts
import assert from 'node:assert'
import { nfeTotal } from './xml-total'

const xml = `<NFe><natOp>Venda</natOp><det><imposto><PIS><vPIS>5.04</vPIS></PIS><ICMSUFDest><vICMSUFDest>19.94</vICMSUFDest></ICMSUFDest></imposto></det>
<det><imposto><PIS><vPIS>28.56</vPIS></PIS></imposto></det>
<total><ICMSTot><vICMS>366.53</vICMS><vICMSUFDest>199.40</vICMSUFDest><vPIS>33.60</vPIS></ICMSTot></total></NFe>`

assert.equal(nfeTotal(xml, 'vPIS'), 33.6)          // total, não o 1º item (5.04)
assert.equal(nfeTotal(xml, 'vICMSUFDest'), 199.4)
assert.equal(nfeTotal(xml, 'vIPI'), 0)
assert.equal(nfeTotal('<vPIS>1.5</vPIS>', 'vPIS'), 1.5) // sem ICMSTot
console.log('xml-total: ok')
