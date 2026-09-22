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
