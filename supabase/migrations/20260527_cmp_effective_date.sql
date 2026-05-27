-- Adiciona effective_date em cmp_costs
-- Representa a data da NF-e de entrada (quando o lote entrou no estoque)
-- não a data em que o cálculo foi executado (calculated_at)
ALTER TABLE cmp_costs ADD COLUMN IF NOT EXISTS effective_date DATE;

-- Para registros existentes, usa a data de calculated_at como fallback
UPDATE cmp_costs SET effective_date = calculated_at::DATE WHERE effective_date IS NULL;

-- Índice para lookup por produto + data (usado em applyCmpToSale histórico)
CREATE INDEX IF NOT EXISTS idx_cmp_costs_product_date
  ON cmp_costs(product_id, effective_date DESC);
