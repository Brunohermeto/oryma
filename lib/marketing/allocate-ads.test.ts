// Auto-checagem do rateio de Ads. Rodar: npx tsx lib/marketing/allocate-ads.test.ts
import assert from 'node:assert'
import { rateiaAds, rateiaAdsGrupos } from './allocate-ads'

const vendas = [
  { id: 'a', external_order_id: 'ml_1_MLB1', gross_price: 100 },
  { id: 'b', external_order_id: 'ml_2_MLB1', gross_price: 300 },
  { id: 'c', external_order_id: 'ml_3_MLB2', gross_price: 600 },
]
const chave = (s: { external_order_id: string }) => s.external_order_id.split('_')[2]
// MLB1 gastou 40 (vai só p/ a e b, pelo bruto); MLB9 gastou 100 e não vendeu (rateia em todas)
const { porVenda, semVenda } = rateiaAds(vendas, new Map([['MLB1', 40], ['MLB9', 100]]), chave)
assert.equal(porVenda.get('a'), 10 + 10)
assert.equal(porVenda.get('b'), 30 + 30)
assert.equal(porVenda.get('c'), 0 + 60)
assert.equal([...porVenda.values()].reduce((x, y) => x + y, 0), 140) // total do dia fiel
assert.equal(semVenda, 0)
// dia sem vendas: gasto fica de fora (informado)
assert.equal(rateiaAds([], new Map([['MLB1', 50]]), chave).semVenda, 50)
// por grupo (período): campanha do produto P1 (40) e campanha geral sem produto (100)
const vp = vendas.map((v, i) => ({ ...v, product_id: i < 2 ? 'P1' : 'P2' }))
const r2 = rateiaAdsGrupos(vp, [{ custo: 40, produtos: new Set(['P1']) }, { custo: 100, produtos: new Set() }])
assert.equal(r2.porVenda.get('a'), 10 + 10)
assert.equal(r2.porVenda.get('c'), 0 + 60)
assert.equal([...r2.porVenda.values()].reduce((x, y) => x + y, 0), 140)
console.log('allocate-ads: ok')
