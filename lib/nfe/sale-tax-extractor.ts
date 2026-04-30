import { parseNFeXml } from './parser'

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

  function extractTag(tag: string): number {
    const m = xmlContent.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))
    return parseFloat(m?.[1] ?? '0') || 0
  }

  const icmsDifal = extractTag('vICMSUFDest') + extractTag('vICMSUFRemet')
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
