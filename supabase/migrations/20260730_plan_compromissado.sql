-- Pedido previsto (em estudo) vs compromissado (fechado com fornecedor)
ALTER TABLE import_plans ADD COLUMN IF NOT EXISTS compromissado boolean DEFAULT true;
