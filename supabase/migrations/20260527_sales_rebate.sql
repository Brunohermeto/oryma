-- Adiciona campo rebate à tabela sales
-- Rebates incluem: desconto tarifário ML, rebates de fornecedor,
-- créditos promocionais de marketplace, bonificações de volume
ALTER TABLE sales ADD COLUMN IF NOT EXISTS rebate DECIMAL(15,2) DEFAULT 0;

-- pack_id também pode estar faltando em ambientes antigos
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pack_id TEXT;
