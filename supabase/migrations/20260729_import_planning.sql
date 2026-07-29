-- Planejamento de Importação (Etapas 1-3)

-- Perfil por produto (SKU raiz): prazos e regra de parcelas padrão
CREATE TABLE IF NOT EXISTS import_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_sku text UNIQUE NOT NULL,
  name text NOT NULL,
  dias_producao int NOT NULL DEFAULT 45,   -- D0 → fim de produção
  dias_embarque int NOT NULL DEFAULT 60,   -- D0 → D1 (embarque China)
  dias_santos   int NOT NULL DEFAULT 100,  -- D0 → D2 (chegada Santos)
  dias_galpao   int NOT NULL DEFAULT 125,  -- D0 → DG (chegada galpão)
  -- [{"pct":0.2,"ancora":"D0","offset":0},{"pct":0.8,"ancora":"D1","offset":90}]
  parcelas jsonb NOT NULL DEFAULT '[]',
  imposto_frete_ancora text NOT NULL DEFAULT 'D2',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Pedido de importação
CREATE TABLE IF NOT EXISTS import_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice text NOT NULL,
  profile_id uuid REFERENCES import_profiles(id),
  containers int NOT NULL DEFAULT 1,
  order_date date NOT NULL,          -- D0
  embarque_real date,                -- substitui D1 projetado quando informado
  santos_real date,                  -- substitui D2
  galpao_real date,                  -- substitui DG
  status_override text,              -- null = status automático pelas datas
  valor_fornecedor numeric NOT NULL DEFAULT 0,
  valor_imposto_frete numeric NOT NULL DEFAULT 0,
  parcelas jsonb,                    -- null = herda do perfil
  notes text,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Itens do pedido: variações (SKUs existentes do Oryma) e quantidades
CREATE TABLE IF NOT EXISTS import_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES import_plans(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  sku text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_import_plan_items_plan ON import_plan_items(plan_id);
