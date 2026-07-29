<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Oryma — Regras Canônicas dos Números (NUNCA violar)

Estas regras existem porque cada violação já produziu margem errada em produção.
Qualquer código novo que grave ou leia valores de venda DEVE segui-las.

## 1. Comissão SEMPRE bruta + estorno separado
- `sales.marketplace_commission` = comissão BRUTA (sale_fee.gross do extrato,
  CV* + sale_fee.rebate). NUNCA gravar o valor líquido.
- `sales.rebate` = estornos/bônus SEPARADOS, positivos (BONUS exceto BFONPN +
  sale_fee.rebate). A margem soma o estorno de volta.
- Motivo: gravar líquido e depois somar estorno de novo mascara a conta.
- **Dono único desses campos: `/api/sync/ml/tariffs`** (e o conserto automático
  em `/api/audit/fees`). A rota de billing NÃO grava comissão/estorno (o
  extrato por período só tem o CVVFN líquido).

## 2. Frete do vendedor = fonte oficial do envio
- Fonte: `/shipments/{id}/costs` → `senders[].cost`.
- O lançamento CFFE/CXD do extrato traz o frete CHEIO (vendedor + parte do
  cliente) — usar SÓ como reserva quando a venda está com frete zero.

## 3. Cupom: só a parte do vendedor desconta
- Fonte: `/orders/{id}/discounts` → `details[type=coupon].items[].amounts.seller`.
- Cupom bancado pelo ML NÃO reduz receita nem margem.

## 4. Custo por vigência de NF (sem média ponderada)
- Cada NF de entrada define o custo A PARTIR da sua emissão (`recalculateCmp`).
- CFOP 3xxx = importado: custo = FOB + II + IPI. Nacional: preço + IPI − créditos
  de ICMS/PIS/COFINS.
- `products.cost_locked = true` (kits): NF NÃO altera o custo; só manual vale.

## 5. Margem = todos os custos, sobre o faturamento BRUTO
- margem = (bruto − cancelamento − cupom-vendedor − comissão − tarifa fixa −
  frete − ads − impostos da NF − CMV + estorno + crédito-importação) / bruto.
- Crédito-importação (regra 2026-07-28): cada compra gera crédito de
  PIS+COFINS+ICMS POR PRODUTO. Produto importado: o débito da saída entra
  cheio e a margem devolve o crédito unitário do lote vigente
  (`getImportCreditAtDate`). Nacional: crédito já abatido no CUSTO — não
  devolver de novo (dupla contagem).
- Venda sem `sale_taxes` = margem NULL ("em cálculo") — fora de médias e somas.
- Impostos debitam de TODAS as vendas (Full via NF do ML, galpão via Bling).

## 6. Estoque SEMPRE conciliado
- Estoque = `stock_quantity` (galpão/Bling) + `stock_full` (marketplaces).
- Nunca calcular cobertura/alerta com só uma das partes.

## 7. UF de destino = fonte fiscal
- NF-e (`recipient.address.state`) ou envio (`receiver_address.state.id`).
- NUNCA usar `state_name` do extrato (é o estado de COBRANÇA).

## Infra (restrições que moldam o código)
- Vercel Hobby: rotas morrem em ~60s → TODO backfill é fatiado
  (body `{days, limit, skip}` + loop orquestrado de fora). `/api/sync/bling`
  síncrona dá 504 — usar sempre `start`/`process`.
- Extrato de billing por pedido: rate limit 5/min (pausa ~14s entre lotes).
- Auth interna: cookie `mi_auth` = APP_PASSWORD ou header `x-cron-secret`.
- Cada rota de auditoria só deleta as PRÓPRIAS regras em `audit_findings`
  (auto-cura), preservando `dismissed_at` (venda+regra dispensada não volta).
- DDL: Bruno roda manualmente no SQL Editor do Supabase (arquivo em
  `supabase/migrations/`).
- Validação: `npx tsc --noEmit` + gabarito contra dados reais de produção
  (centavo a centavo contra o painel do ML) antes de dar por pronto.
