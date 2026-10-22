-- Cupom usado em cada venda (painel Marketing & Ads -> Cupons) — 22/10/2026
-- cupom_codigo: '' = conferido sem cupom; NULL = ainda nao conferido
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cupom_codigo TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cupom_vendedor DECIMAL(15,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cupom_marketplace DECIMAL(15,2);
