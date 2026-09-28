// O PostgREST devolve no máximo 1000 linhas por consulta — .limit(5000) NÃO
// passa disso e a tela mostra número menor que o real, sem aviso (DRE, margem
// por produto, tributário, auditoria... todos cortavam). Pagina em blocos de
// 1000 e lança o erro em vez de engolir (falha de banco não pode virar R$ 0).
// ORDENE por uma coluna única (id) — ordenar por sale_date repetido pula/duplica.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T = any>(builder: () => any): Promise<T[]> {
  const PAGE = 1000
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await builder().range(offset, offset + PAGE - 1)
    if (error) throw new Error(`Falha ao consultar o banco: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return rows
}

/**
 * Igual ao fetchAll, mas descobre o total na 1ª página (count exato) e busca as
 * demais em PARALELO (concorrência limitada) — o banco responde ~200ms por
 * consulta e 11 páginas em série estouravam o limite de 60s da Vercel.
 * O builder DEVE ordenar por id e selecionar com { count: 'exact' }; qualquer
 * página com erro LANÇA (falha de banco não pode virar número menor na tela).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllParallel<T = any>(builder: () => any, concurrency = 6): Promise<T[]> {
  const PAGE = 1000
  const first = await builder().range(0, PAGE - 1)
  if (first.error) throw new Error(`Falha ao consultar o banco: ${first.error.message}`)
  const total: number | null = first.count ?? null
  const pages: T[][] = [(first.data ?? []) as T[]]
  if (total === null) {
    // sem count: cai no modo sequencial a partir da 2ª página
    if (pages[0].length < PAGE) return pages[0]
    for (let offset = PAGE; ; offset += PAGE) {
      const { data, error } = await builder().range(offset, offset + PAGE - 1)
      if (error) throw new Error(`Falha ao consultar o banco: ${error.message}`)
      if (!data?.length) break
      pages.push(data as T[])
      if (data.length < PAGE) break
    }
    return pages.flat()
  }
  const nPages = Math.ceil(total / PAGE)
  let next = 1
  const worker = async () => {
    while (next < nPages) {
      const p = next++
      const { data, error } = await builder().range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) throw new Error(`Falha ao consultar o banco: ${error.message}`)
      pages[p] = (data ?? []) as T[]
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(nPages - 1, 0)) }, worker))
  return pages.flat()
}
