-- Fluxo Geral de Importação (formato da planilha): plano de vendas mensal,
-- preço planejado por produto e caixa da empresa (saldo, dívida, retirada, DIFAL)
CREATE TABLE IF NOT EXISTS import_sales_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  mes text NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  UNIQUE(product_id, mes)
);
CREATE TABLE IF NOT EXISTS import_product_params (
  product_id uuid PRIMARY KEY REFERENCES products(id),
  preco_venda numeric
);
CREATE TABLE IF NOT EXISTS import_cash_config (
  id int PRIMARY KEY DEFAULT 1,
  saldo_inicial numeric NOT NULL DEFAULT 0,
  difal_pct numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_cash_months (
  mes text PRIMARY KEY,
  divida numeric NOT NULL DEFAULT 0,
  retirada numeric NOT NULL DEFAULT 0
);
