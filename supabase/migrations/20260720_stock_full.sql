-- Estoque nos centros de distribuição dos marketplaces (Full ML, futuramente FBA/Shopee).
-- stock_quantity continua sendo o estoque do galpão próprio (vem do Bling);
-- estoque total = stock_quantity + stock_full.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_full DECIMAL(12,2) DEFAULT 0;
