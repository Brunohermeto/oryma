-- Adiciona pack_id na tabela sales
-- pack_id = ID do carrinho do ML quando um pedido tem múltiplos itens
-- Permite agrupar itens do mesmo carrinho para matching com NF-e
-- Execute no Supabase Dashboard → SQL Editor

ALTER TABLE sales ADD COLUMN IF NOT EXISTS pack_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_pack_id ON sales(pack_id) WHERE pack_id IS NOT NULL;
