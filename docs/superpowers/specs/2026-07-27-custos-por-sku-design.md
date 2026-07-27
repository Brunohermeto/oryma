# Custos por SKU — Design

Data: 2026-07-27 · Aprovado por Bruno.

## Objetivo

Tabela com TODOS os SKUs e o custo vigente de cada um (vindo das NFs de
entrada), com edição manual — obrigatoriamente informando a **data de início
da vigência** — e cadeado por SKU para kits/conjuntos.

## Decisões do Bruno

- Precedência **por SKU**: coluna `products.cost_locked` (boolean).
  - Destravado: NF de entrada nova assume o custo dali em diante (padrão).
  - Travado: recálculo por NF PULA o produto; só o custo manual vale (kits).
- Edição manual sempre pede **valor + data de vigência** ("desde quando").

## Implementação

1. Migração manual (Bruno, SQL Editor):
   `ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_locked boolean DEFAULT false;`
2. `lib/landed-cost/calculator.ts`: função da linha do tempo de CMP retorna
   cedo se o produto está `cost_locked` (NF não mexe em SKU travado).
3. Rota nova `POST /api/products/cost-lock` `{product_id, locked}` (cookie).
4. Página `configuracoes/cmp-manual` vira **Custos por SKU**: tabela de todos
   os produtos com custo vigente, origem (NF/manual — heurística:
   `total_stock_qty === 1` → manual), data de vigência, cadeado clicável,
   lápis para editar (valor + data), busca e filtros (todos / sem custo /
   manual / travado). Grava via `/api/cmp/manual` existente (já dispara o
   recálculo de margens).

## Fora de escopo

- Composição automática de kit (custo do kit = Σ componentes) — travar +
  manual resolve; evoluir depois se valer a pena.
