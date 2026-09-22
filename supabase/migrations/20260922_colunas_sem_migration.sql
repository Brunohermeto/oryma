-- 22/09/2026 — colunas que o código grava e que existiam no banco antigo, mas
-- foram criadas à mão no SQL Editor e NUNCA viraram migration. Sumiram na
-- reconstrução (ver 20260922_constraints_canais.sql para o mesmo tipo de armadilha).
-- Achadas comparando as colunas reais do banco (OpenAPI do PostgREST) com as
-- referências no código (.select/.update/.upsert).

-- Estoque nos CDs dos marketplaces (mesmo tipo de stock_full, 20260720_stock_full.sql)
--   stock_fba          → /api/sync/amazon/stock  (FBA disponível)
--   stock_fba_transito → /api/sync/amazon/stock  (FBA em trânsito/recebendo)
--   stock_shopee       → /api/sync/shopee/stock  (CD do Shopee Full)
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_fba          DECIMAL(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_fba_transito DECIMAL(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_shopee       DECIMAL(12,2) DEFAULT 0;

-- Saldo inicial do DIFAL no fluxo de caixa do planejamento (/api/import-planning)
ALTER TABLE import_cash_config ADD COLUMN IF NOT EXISTS difal_saldo_inicial numeric NOT NULL DEFAULT 0;
