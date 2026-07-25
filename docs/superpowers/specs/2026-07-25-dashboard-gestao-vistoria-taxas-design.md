# Dashboard de Gestão + Vistoria de Taxas — Design

Data: 2026-07-25 · Aprovado por Bruno em conversa.

## Objetivo

Transformar a Visão Geral no centro de gestão do negócio: margens médias por
produto, taxas pagas aos marketplaces e vistoria automática das taxas cobradas
pelo ML contra as regras oficiais.

## Decisões do Bruno

- Dashboard de gestão e vistoria de taxas juntos, num projeto só.
- Vive na **Visão Geral** (evoluir a página inicial; menu continua com 6 itens).
- Precificação = **visibilidade da margem média por produto** (sem simulador).
- Vistoria compara com **tabela oficial do ML** (comissão % + tarifa fixa) e
  com **padrão histórico** (frete).
- Tabela de margem com **filtro de período e busca por produto**.

## 1. Visão Geral evoluída (`app/dashboard/page.tsx`)

Ordem das seções:

1. **KPIs do período** (mantém) + bloco novo **Taxas pagas**: comissão, frete,
   tarifa fixa, publicidade — em R$ e % do faturamento do período.
2. **Margem por produto** (componente client novo `MarginByProductTable`):
   - Colunas: produto, unidades, faturamento, custo, taxas totais, margem R$,
     margem % média, velocidade/dia, cobertura de estoque.
   - Filtro de período: 7 / 30 / 90 dias / mês atual. Busca por nome/SKU.
   - Ordenável por qualquer coluna. Margem NULL (sem impostos ainda) fica
     "em cálculo" e fora das médias — mesma regra da página de Vendas.
   - Linha expansível por produto: **% de vendas por estado** (UF de
     destino), ranqueado — ex.: SP 38% · MG 21% · RJ 12%. Fonte:
     `sales.uf_destino` no período filtrado; vendas sem UF entram como
     "não informado".
   - Dados vêm por props do server component (uma consulta agregada em
     `sales` + `sale_costs` + `products`); filtro de período refaz via
     query string (`?days=`), busca/ordenação são client-side.
3. **Vistoria de taxas** (evolução do `AuditAlertsPanel` existente): mostra as
   divergências das regras novas com venda, valor cobrado, valor esperado,
   diferença — e o total cobrado a mais no período no cabeçalho.
4. Mantém: gráficos, alertas de NF, vendas ao vivo.

## 2. Motor de vistoria (`app/api/audit/fees/route.ts`, nova rota fatiada)

Reusa a tabela `audit_findings` (UNIQUE(sale_id, rule)) e o mecanismo de
auto-cura já existente. Regras novas:

| Regra | Comparação | Tolerância |
|---|---|---|
| `comissao_acima_tabela` | comissão cobrada (bruta) vs % oficial da categoria × preço | R$ 0,10 |
| `tarifa_fixa_divergente` | `marketplace_fixed_fee` vs regra oficial por faixa de preço | R$ 0,10 |
| `frete_fora_padrao` | frete da venda vs mediana histórica do produto na mesma logística (mín. 5 vendas) | > 25% acima |

Fonte da tabela oficial: API do ML
`/sites/MLB/listing_prices?price=X&listing_type_id=Y&category_id=Z` por
anúncio (cacheada por anúncio+faixa de preço na própria execução; o ciclo é
diário, não precisa de cache persistente).

Formato da rota: mesma família das rotas fatiadas (POST, body
`{days, limit, skip}`, cookie `mi_auth` ou header `x-cron-secret`,
maxDuration 60, retorna `processed/remaining`). Estorno posterior do ML
resolve a divergência → finding é removido na rodada seguinte (auto-cura).

O detalhe da divergência (cobrado, esperado, diferença) vai no campo de
detalhes do finding para o painel exibir sem consulta extra.

## 3. Integração com o ciclo

- Entra no `catchup.py` (etapa após a auditoria atual) e na cadeia de
  `/api/cron/sync`.
- Entra no botão "Sincronização completa" do MarketplaceSyncButton (etapa
  extra após a auditoria).

## Fora de escopo

- Simulador de preço / preço mínimo (Bruno optou por só visibilidade).
- Vistoria para Shopee/Amazon (entram quando forem reconectados).
- Contestação automática junto ao ML (a divergência é insumo para
  reclamação manual).
