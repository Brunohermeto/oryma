# Planejamento de Importação — Design

Data: 2026-07-29 · Aprovado por Bruno (baseado na planilha
"Fluxo de Pagamentos - Importação - 23.07.xlsx", que ficou inviável de manter
porque mudar uma data exige recalcular tudo à mão).

## Objetivo

Substituir a planilha por um módulo onde mudar UMA data (pedido, embarque,
chegada) recalcula em cascata: linha do tempo, pagamentos, entrada de estoque
projetada, ruptura e caixa.

## Decisões do Bruno

- **Perfil por produto (SKU raiz)**: cada produto tem seus próprios prazos de
  fabricação/trânsito e sua própria regra de parcelas — cadastrados uma vez e
  reaproveitados em todo pedido. Editáveis a qualquer momento.
- Pedido herda o perfil e pode **sobrescrever** prazos/parcelas caso a
  negociação daquele pedido seja diferente.
- Itens do pedido usam os **SKUs existentes** do Oryma (variações), ligando a
  chegada projetada ao estoque e à velocidade REAIS já calculados.

## Modelo (da planilha → sistema)

- Âncoras: **D0** = data do pedido · **D1** = embarque China ·
  **D2** = chegada Santos · **DG** = chegada galpão.
- Perfil (por SKU raiz): dias até fim de produção, D1, D2 e DG (a partir de
  D0); regra de parcelas = lista `{pct, âncora, offset_dias}`
  (ex: 20% D0+0 · 80% D1+90); imposto+frete pago em D2 (configurável).
- Pedido: invoice, SKU raiz, nº containers, D0, valores (fornecedor,
  imposto+frete, total), status derivado das datas (Em produção → Trânsito
  marítimo → Transporte terrestre → No galpão) com override manual, datas
  REAIS opcionais (embarque_real etc.) que substituem as projetadas e
  recascateiam o restante.
- Itens do pedido: variação (SKU existente) + quantidade.

## Etapas de entrega

1. **Pedidos + linha do tempo viva + ruptura** (página "Planejamento" no
   menu): CRUD de perfis e pedidos; datas projetadas/reais; painel de
   projeção de estoque por variação (estoque atual − velocidade real × dias
   + chegadas) com alerta de ruptura antes de acontecer.
2. **Fluxo de caixa**: parcelas viram lançamentos nas datas resolvidas;
   visão mensal de desencaixe; "a pagar em curso" por pedido.
3. **Caixa completo**: + faturamento projetado (velocidade × preço médio
   real) → caixa líquido mensal e margem futura estimada dos pedidos.

## Tabelas (DDL manual do Bruno)

- `import_profiles`: root_sku (único), nome, dias_producao, dias_embarque,
  dias_santos, dias_galpao, parcelas jsonb, imposto_frete_ancora.
- `import_plans`: invoice, root_sku→profile, containers, order_date,
  embarque_real, santos_real, galpao_real, status_override,
  valor_fornecedor, valor_imposto_frete, valor_total, parcelas jsonb
  (null = herda do perfil), notes.
- `import_plan_items`: plan_id, product_id (FK products), quantity.

## Fora de escopo (por ora)

- Conversão cambial (valores em R$ como na planilha).
- Frete quinzenal como série histórica (vira campo de estimativa no pedido).
- Integração automática com a NF de importação real (quando a NF chega, o
  pedido pode ser marcado como concluído manualmente; ligação automática é
  evolução futura).
