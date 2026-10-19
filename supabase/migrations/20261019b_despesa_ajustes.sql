-- Ajustes do mês nas despesas da Conta Azul (valor corrigido / excluir / observação),
-- reaplicados a cada reenvio do relatório (19/10/2026)
ALTER TABLE operational_expenses ADD COLUMN IF NOT EXISTS observacao TEXT;
ALTER TABLE operational_expenses ADD COLUMN IF NOT EXISTS valor_original DECIMAL(15,2);

CREATE TABLE IF NOT EXISTS despesa_ajustes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period         DATE NOT NULL,
  categoria      TEXT NOT NULL,           -- categoria da Conta Azul
  descricao      TEXT NOT NULL,           -- descrição original do lançamento
  valor_original DECIMAL(15,2) NOT NULL,  -- valor como veio da Conta Azul
  valor          DECIMAL(15,2),           -- valor que vale no DRE (0 = excluído; NULL = mantém)
  observacao     TEXT,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (period, categoria, descricao, valor_original)
);

-- só o servidor (service role) acessa; a chave pública não lê nem grava
ALTER TABLE despesa_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contaazul_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_expenses ENABLE ROW LEVEL SECURITY;
