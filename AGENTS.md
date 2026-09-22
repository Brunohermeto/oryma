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
- **`sales.shipping_received` (frete pago pelo COMPRADOR) NUNCA é receita**:
  no Mercado Envios vai para o ML/transportadora, não chega ao vendedor
  (regra 2026-07-29). Fica gravado só como informação — jamais somar em
  faturamento, margem ou DRE.

## 3. Cupom: só a parte do vendedor desconta
- Fonte: `/orders/{id}/discounts` → `details[type=coupon].items[].amounts.seller`.
- Cupom bancado pelo ML NÃO reduz receita nem margem.

## 4. Custo por vigência de NF (sem média ponderada)
- Cada NF de entrada define o custo A PARTIR da sua emissão (`recalculateCmp`).
- CFOP 3xxx = importado: custo = FOB + II + IPI. Nacional: preço + IPI − créditos
  de ICMS/PIS/COFINS.
- `products.cost_locked = true` (kits): NF NÃO altera o custo; só manual vale.

## 5. Margem = todos os custos, sobre o faturamento LÍQUIDO
- margem R$ = bruto − cancelamento − cupom-vendedor − comissão − tarifa fixa −
  frete − ads − impostos da NF − CMV + estorno.
- margem % = margem R$ / faturamento LÍQUIDO (bruto − devolução − cupom) —
  mesma base do card da venda, pra lucro/faturamento/% baterem na tela.
- **NUNCA somar crédito-importação à margem** (regra 2026-09-15, corrige a
  regra anterior de 2026-07-28): as NF-e de compra que formam o CMV/landed cost
  já entram LÍQUIDAS de crédito. Somar de novo conta em dobro e infla (um
  pedido apareceu 32,7% quando o real era 26,6%). O campo
  `sale_costs.import_credit` fica gravado só como INFORMAÇÃO.
  - Sintoma de recaída: "as margens subiram sem motivo" → alguém reintroduziu
    o `+ importCredit`.
- Margem só conta como apurada quando há imposto **E** comissão do marketplace;
  senão fica NULL ("em cálculo") e sai de médias e somas. Sem comissão ela
  infla (Amazon aparecia 40% em vez de ~23% — a taxa vem com lag de quinzena).
  Venda devolvida também fica NULL.
- Impostos debitam de TODAS as vendas (Full via NF do ML, galpão via Bling).
- **Dono único do cálculo: `/api/landed-cost/relink`.** Qualquer outro caminho
  que grave `sale_costs` DEVE usar a mesma fórmula — já houve divergência entre
  `relink` e `applyCmpToSale` que deixava margem inflada nas vendas tocadas
  pela vistoria de taxas (que roda DEPOIS do relink e sobrescreve).

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
- O ciclo diário inteiro vive em `scripts/catchup.py` (ordem + porquês no
  cabeçalho do arquivo). Fatiamentos que já foram necessários, não desfazer:
  - vendas: 1 dia × 1 canal por chamada (um dia com todos os canais estourava
    60s em dia de pico);
  - Amazon: backfill dia a dia D-2..D-15 (a Orders API faz ~1 página/min e
    publica pedidos com atraso que a janela de 2 dias perdia);
  - relink: incremental (`days: 45`) — o relink completo de ~9.600 vendas dava
    504 e deixava as margens sem recalcular;
  - Shopee full-taxes: o lote de XML é assíncrono, a rota é retomável por
    `request_id` (504 é esperado, não é erro).
- Rotas que ainda estouram 60s de forma intermitente e pedem fatiamento:
  `/api/sync/shopee/stock` (varre 453 anúncios numa chamada só).
- Bling: a API migrou de `www.bling.com.br` → `api.bling.com.br`. Um 403
  "Acesso não permitido" em TODOS os endpoints é isso, NÃO token/escopo/plano.
- Extrato de billing por pedido: rate limit 5/min (pausa ~14s entre lotes).
- Auth interna: cookie `mi_auth` = APP_PASSWORD ou header `x-cron-secret`.
- Cada rota de auditoria só deleta as PRÓPRIAS regras em `audit_findings`
  (auto-cura), preservando `dismissed_at` (venda+regra dispensada não volta).
- DDL: Bruno roda manualmente no SQL Editor do Supabase (arquivo em
  `supabase/migrations/`). Toda mudança de schema DEVE virar arquivo ali —
  foi isso que permitiu recriar o banco inteiro depois do incidente de 22/09.

## Banco: lições do incidente de 2026-09-22 (projeto Supabase excluído)
- **Sempre ter backup fora do Supabase.** O plano Free não guarda cópia
  recuperável e exclusão de projeto é definitiva. O schema estava versionado
  (salvou a estrutura), mas os dados digitados à mão — importações/landed cost,
  despesas, planejamento, precificação — não tinham cópia nenhuma.
- **RLS ligado em todas as tabelas.** O banco antigo rodava sem RLS e a chave
  `anon` vai no JS do site: qualquer visitante podia ler o banco financeiro.
  O app usa `service_role` nas rotas de servidor, que ignora RLS — só o
  cliente de navegador (`createSupabaseBrowserClient`) sofre, e ele não deve
  gravar nada: quem grava é rota de servidor.
- **Região do projeto: São Paulo (sa-east-1).** O banco antigo estava nos EUA
  e pagava latência em cada consulta.
- **Falha de banco NÃO pode virar zero na tela.** As consultas do dashboard
  ignoram o `error` do Supabase e seguem com lista vazia — com o banco fora, a
  Visão Geral mostrou tudo zerado (e 70s de carregamento) em vez de dizer que
  estava sem banco. Consulta que falha deve aparecer como erro, nunca como 0.
- Validação: `npx tsc --noEmit` + gabarito contra dados reais de produção
  (centavo a centavo contra o painel do ML) antes de dar por pronto.
