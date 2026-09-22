-- 22/09/2026 — alinha as restrições CHECK com o que o código realmente grava.
-- Essas mudanças existiam no banco antigo, feitas à mão no SQL Editor, e NUNCA
-- viraram migration. Quando o banco foi recriado a partir de supabase/migrations,
-- o schema voltou à versão velha e TODA sincronização de vendas passou a falhar
-- com "violates check constraint sync_logs_source_check".
-- Lição (ver AGENTS.md): DDL feito à mão sem virar arquivo aqui é uma bomba-relógio.

-- 1. sales.marketplace — faltava a MAGALU, que virou canal depois do schema original
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_marketplace_check;
ALTER TABLE sales ADD CONSTRAINT sales_marketplace_check
  CHECK (marketplace IN ('mercado_livre','shopee','amazon','magalu'));

-- 2. sales.fulfillment_type — faltavam o Full da Shopee (FBS) e o da Magalu
--    galpao      = estoque nosso, NF pelo Bling
--    full_ml     = Full do Mercado Livre
--    fba_amazon  = FBA da Amazon
--    full_shopee = FBS da Shopee (NF série 005, emitida pela Shopee)
--    full_magalu = CD da Magalu (NF série 6, emitida pela Magalu)
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_fulfillment_type_check;
ALTER TABLE sales ADD CONSTRAINT sales_fulfillment_type_check
  CHECK (fulfillment_type IN ('galpao','full_ml','fba_amazon','full_shopee','full_magalu'));

-- 3. sync_logs — tabela de LOG: a lista de origens/status muda a cada rota nova
--    e já derrubou a sincronização inteira uma vez. O valor da restrição aqui
--    não compensa o risco, então sai. (Em `sales` ela fica: lá um valor errado
--    corromperia agrupamento financeiro.)
ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_source_check;
ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_status_check;
