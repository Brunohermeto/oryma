import assert from 'node:assert/strict'
import { impostosDaVenda, type MLInvoiceItem } from './ml-invoice-taxes'

const item = (mlb: string, icms: number, dest: number, fcp: number, pis: number, cofins: number): MLInvoiceItem => ({
  external_product_id: mlb,
  fiscal_data: { rules: [
    { name: 'ICMS', attributes: { vicms: icms, vicmsufdest: dest, vfcpufdest: fcp } },
    { name: 'PIS', attributes: { vpis: pis } },
    { name: 'COFINS', attributes: { vcofins: cofins } },
  ] },
})

// 2000019108516658: kit capota + cadeira, os dois com o mesmo MLB
const capota = item('MLB6360396876', 2.12, 7.42, 1.06, 0.72, 3.3)
const cadeira = item('MLB6360396876', 50.29, 176.02, 25.15, 17.01, 78.35)
const kit = impostosDaVenda([capota, cadeira], 'MLB6360396876')!
assert.equal(Math.round(kit.icms * 100) / 100, 52.41)
assert.equal(Math.round(kit.difal * 100) / 100, 209.65)
assert.equal(Math.round(kit.cofins * 100) / 100, 81.65)

// outro anúncio do mesmo pedido não entra na conta
assert.equal(impostosDaVenda([capota, item('MLB1', 10, 0, 0, 1, 1)], 'MLB1')!.icms, 10)
// nota de item único aceita MLB diferente; multi-item sem casar não herda imposto
assert.equal(impostosDaVenda([capota], 'MLB9')!.icms, 2.12)
assert.equal(impostosDaVenda([capota, cadeira], 'MLB9'), null)
console.log('ok — impostosDaVenda')
