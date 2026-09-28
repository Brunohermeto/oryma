import { runRelink } from './relink'

/**
 * Recalcula margens de dentro do servidor chamando a lógica do relink
 * DIRETAMENTE — sem hop HTTP (o proxy de login barrava a chamada interna e a
 * margem não atualizava) e sem repassar a senha do app em header.
 */
export async function callRelink(body: { productIds?: string[]; from?: string }) {
  return runRelink(body)
}
