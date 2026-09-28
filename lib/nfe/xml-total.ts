/**
 * Valor TOTAL da NF-e (bloco <ICMSTot>). O 1º <vPIS>/<vICMS>... do XML é o do
 * 1º ITEM — ler o primeiro match subestimava impostos de NF com vários itens
 * (Shopee jan–fev/2026: PIS+COFINS 5% e DIFAL ~1% em vez de 9,25% / 11%).
 * Tag fora do ICMSTot (ex.: natOp) cai no XML inteiro.
 */
export function nfeTotal(xml: string, tag: string): number {
  const re = new RegExp(`<${tag}>([^<]+)</${tag}>`)
  const tot = xml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/)?.[1]
  const m = (tot && tot.match(re)) || xml.match(re)
  return parseFloat(m?.[1] ?? '0') || 0
}
