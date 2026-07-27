-- Custos por SKU: cadeado por produto (travado = NF de entrada não altera o custo)
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_locked boolean DEFAULT false;
