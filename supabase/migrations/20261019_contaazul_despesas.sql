-- Importação mensal do relatório "Visão Contas a Pagar" da Conta Azul → DRE (19/10/2026)

-- novas categorias de despesa
ALTER TABLE operational_expenses DROP CONSTRAINT IF EXISTS operational_expenses_dre_category_check;
ALTER TABLE operational_expenses ADD CONSTRAINT operational_expenses_dre_category_check CHECK (dre_category IN (
  'salarios','inss_patronal','fgts','vale_transporte','vale_alimentacao','plano_saude','ferias_13','prolabore','bonificacoes',
  'energia','agua','escritorio','aluguel','frete_operacional','publicidade_marketing','sistemas_software',
  'contabilidade_consultoria','outras_despesas','manutencao','servicos_terceiros','impostos_taxas','certificacoes','cartao_credito',
  'despesas_financeiras'
));

-- origem do lançamento: 'contaazul' é substituído a cada novo envio do mesmo mês
ALTER TABLE operational_expenses ADD COLUMN IF NOT EXISTS source TEXT;
CREATE INDEX IF NOT EXISTS operational_expenses_source_period ON operational_expenses (source, period);

-- categoria da Conta Azul → categoria do DRE (ou 'ignorar'), escolhida uma vez na tela
CREATE TABLE IF NOT EXISTS contaazul_categorias (
  categoria  TEXT PRIMARY KEY,   -- minúsculas
  destino    TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
