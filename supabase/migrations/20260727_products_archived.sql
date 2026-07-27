-- Arquivamento de SKUs mortos (sem venda em 6 meses e sem estoque)
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
