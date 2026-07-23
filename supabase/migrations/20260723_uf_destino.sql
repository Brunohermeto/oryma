-- UF de destino da venda (estado do comprador) — vem do extrato do ML
-- (sales_info.state_name) e/ou do enderDest da NF-e. Base para análise de
-- vendas por estado e conferência de DIFAL.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS uf_destino TEXT;
