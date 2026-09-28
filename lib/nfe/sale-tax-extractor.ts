import { parseNFeXml } from './parser'
import { nfeTotal } from './xml-total'

export interface SaleTaxBreakdown {
  nfeKey: string
  pis: number
  cofins: number
  icms: number
  icmsDifal: number
  ipi: number
  ufDestino: string | null
}

export function extractSaleTaxes(xmlContent: string): SaleTaxBreakdown {
  const nfe = parseNFeXml(xmlContent)

  // total da NF (ICMSTot) — o 1º match era o do 1º item
  const extractTag = (tag: string) => nfeTotal(xmlContent, tag)

  const icmsDifal = extractTag('vICMSUFDest') + extractTag('vICMSUFRemet') + extractTag('vFCPUFDest')
  const ufMatch = xmlContent.match(/<dest>[\s\S]*?<UF>([^<]+)<\/UF>/)

  return {
    nfeKey: nfe.chave,
    pis: nfe.totais.vPIS,
    cofins: nfe.totais.vCOFINS,
    icms: nfe.totais.vICMS,
    icmsDifal,
    ipi: nfe.totais.vIPI,
    ufDestino: ufMatch?.[1] ?? null,
  }
}
