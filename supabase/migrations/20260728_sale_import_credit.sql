-- Crédito de importação (PIS+COFINS+ICMS) aplicado na margem de cada venda —
-- guardado para o DRE somar pela mesma régua da margem
ALTER TABLE sale_costs ADD COLUMN IF NOT EXISTS import_credit numeric DEFAULT 0;
