import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: true,
})

export interface ParsedNFeItem {
  cProd: string
  xProd: string
  qCom: number
  vUnCom: number
  vProd: number
  unitII: number
  unitIPI: number
  unitPisImp: number
  unitCofinsImp: number
  unitIcmsGnre: number
  totalII: number
  totalIPI: number
  totalPisImp: number
  totalCofinsImp: number
  totalIcmsGnre: number
}

export interface ParsedNFe {
  chave: string
  numero: string
  serie: string
  dataEmissao: string
  naturezaOperacao: string
  cfop: string
  emitente: string
  cnpjEmitente: string
  items: ParsedNFeItem[]
  totais: {
    vNF: number
    vII: number
    vIPI: number
    vICMS: number
    vPIS: number
    vCOFINS: number
    vProd: number
  }
}

function num(v: unknown): number {
  if (v === undefined || v === null) return 0
  return parseFloat(String(v)) || 0
}

function str(v: unknown): string {
  return String(v ?? '')
}

export function parseNFeXml(xmlContent: string): ParsedNFe {
  const parsed = xmlParser.parse(xmlContent)
  const root = parsed.nfeProc ?? parsed
  const nfe = root.NFe ?? root
  const infNFe = nfe.infNFe

  const ide = infNFe.ide
  const emit = infNFe.emit
  const total = infNFe.total?.ICMSTot ?? {}
  const prot = (parsed.nfeProc)?.protNFe?.infProt

  const chave = str(prot?.chNFe ?? infNFe['@_Id']?.replace('NFe', ''))
  const dets = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det].filter(Boolean)

  const items: ParsedNFeItem[] = dets.map((det: any) => {
    const prod = det.prod ?? {}
    const imp = det.imposto ?? {}
    const qCom = num(prod.qCom)
    const safeQ = qCom || 1

    const totalII = num(imp.II?.vII)
    const totalIPI = num(imp.IPI?.IPITrib?.vIPI ?? imp.IPI?.IPINTrib?.vIPI)
    const totalPisImp = num(imp.PIS?.PISAliq?.vPIS ?? imp.PIS?.PISQtde?.vPIS ?? imp.PIS?.PISNT?.vPIS)
    const totalCofinsImp = num(imp.COFINS?.COFINSAliq?.vCOFINS ?? imp.COFINS?.COFINSQtde?.vCOFINS ?? imp.COFINS?.COFINSNT?.vCOFINS)
    const icmsVariant = Object.values(imp.ICMS ?? {})[0] as any ?? {}
    const totalIcmsGnre = num(icmsVariant.vICMS)

    return {
      cProd: str(prod.cProd),
      xProd: str(prod.xProd),
      qCom,
      vUnCom: num(prod.vUnCom),
      vProd: num(prod.vProd),
      totalII, totalIPI, totalPisImp, totalCofinsImp, totalIcmsGnre,
      unitII: totalII / safeQ,
      unitIPI: totalIPI / safeQ,
      unitPisImp: totalPisImp / safeQ,
      unitCofinsImp: totalCofinsImp / safeQ,
      unitIcmsGnre: totalIcmsGnre / safeQ,
    }
  })

  const firstDet = dets[0]?.prod
  const cfop = str(firstDet?.CFOP ?? ide.CFOP ?? '')

  return {
    chave,
    numero: str(ide.nNF),
    serie: str(ide.serie),
    dataEmissao: str(ide.dhEmi ?? ide.dEmi ?? '').slice(0, 10),
    naturezaOperacao: str(ide.natOp),
    cfop,
    emitente: str(emit.xNome ?? emit.xFant),
    cnpjEmitente: str(emit.CNPJ),
    items,
    totais: {
      vNF: num(total.vNF),
      vII: num(total.vII),
      vIPI: num(total.vIPI),
      vICMS: num(total.vICMS),
      vPIS: num(total.vPIS),
      vCOFINS: num(total.vCOFINS),
      vProd: num(total.vProd),
    },
  }
}
