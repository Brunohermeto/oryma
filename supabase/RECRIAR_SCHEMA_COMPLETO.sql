-- SCHEMA COMPLETO ORYMA — recriação do banco (22/09/2026) --
-- Cole tudo isto no SQL Editor do novo projeto Supabase e clique Run --

-- ============ 001_schema.sql ============
-- supabase/migrations/001_schema.sql
-- MCL Informática LTDA (RAGALUMA) — Lucro Real — hybrid: ML+Shopee+Amazon+Bling+ContaAzul

-- OAuth credentials per integration
CREATE TABLE credentials (
  id TEXT PRIMARY KEY, -- 'mercado_livre' | 'shopee' | 'amazon' | 'bling' | 'conta_azul'
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  extra JSONB, -- shopee: shop_id, partner_id; amazon: seller_id; ML: seller_id
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products / SKUs (RAGA001–004 + national)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bling_id TEXT UNIQUE,
  sku TEXT NOT NULL UNIQUE, -- RAGA001, RAGA002, RAGA003, RAGA004
  name TEXT NOT NULL,
  category TEXT,
  origin TEXT NOT NULL DEFAULT 'imported' CHECK (origin IN ('imported','national')),
  stock_quantity DECIMAL(12,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- NF-e de entrada: importações (série 0, CFOP 3102) + nacionais
CREATE TABLE import_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nfe_number TEXT NOT NULL,
  nfe_key TEXT UNIQUE,
  supplier TEXT NOT NULL,
  issue_date DATE NOT NULL,
  cfop TEXT,
  total_nfe_value DECIMAL(15,2) NOT NULL,
  total_fob_value DECIMAL(15,2),
  source TEXT NOT NULL CHECK (source IN ('bling', 'manual_upload')),
  xml_storage_path TEXT,
  costs_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Items per import NF-e — taxes per item from XML
CREATE TABLE import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_order_id UUID NOT NULL REFERENCES import_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  sku TEXT,
  description TEXT,
  quantity DECIMAL(12,4) NOT NULL,
  unit_fob_value DECIMAL(15,4) NOT NULL,
  total_fob_value DECIMAL(15,2) NOT NULL,
  unit_ii DECIMAL(15,4) DEFAULT 0,
  unit_ipi DECIMAL(15,4) DEFAULT 0,
  unit_pis_imp DECIMAL(15,4) DEFAULT 0,
  unit_cofins_imp DECIMAL(15,4) DEFAULT 0,
  unit_icms_gnre DECIMAL(15,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Additional landed cost components per import batch (items 9-14 from spec)
CREATE TABLE import_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_order_id UUID NOT NULL REFERENCES import_orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'frete_maritimo',
    'seguro',
    'afrmm',
    'armazenagem',
    'frete_rodoviario',
    'despachante',
    'gru_inmetro',
    'siscomex',
    'outro'
  )),
  description TEXT,
  amount DECIMAL(15,2) NOT NULL,
  distribution_method TEXT NOT NULL DEFAULT 'fob_value',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calculated landed cost per product per import batch
CREATE TABLE unit_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_item_id UUID NOT NULL REFERENCES import_items(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  import_order_id UUID NOT NULL REFERENCES import_orders(id),
  fob_unit_cost DECIMAL(15,4) NOT NULL,
  taxes_unit_cost DECIMAL(15,4) NOT NULL DEFAULT 0,
  additional_unit_cost DECIMAL(15,4) NOT NULL DEFAULT 0,
  total_unit_cost DECIMAL(15,4) NOT NULL,
  quantity_in_batch DECIMAL(12,4) NOT NULL,
  pis_credit_unit DECIMAL(15,4) DEFAULT 0,
  cofins_credit_unit DECIMAL(15,4) DEFAULT 0,
  icms_credit_unit DECIMAL(15,4) DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CMP (Custo Médio Ponderado) per SKU
CREATE TABLE cmp_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  cmp_value DECIMAL(15,4) NOT NULL,
  total_stock_qty DECIMAL(12,4) NOT NULL,
  total_stock_value DECIMAL(15,2) NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sales from marketplace APIs
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_id TEXT UNIQUE NOT NULL,
  marketplace TEXT NOT NULL CHECK (marketplace IN ('mercado_livre','shopee','amazon')),
  fulfillment_type TEXT NOT NULL DEFAULT 'galpao' CHECK (fulfillment_type IN ('galpao','full_ml','fba_amazon')),
  product_id UUID REFERENCES products(id),
  sku TEXT,
  sale_date DATE NOT NULL,
  quantity DECIMAL(12,4) NOT NULL DEFAULT 1,
  gross_price DECIMAL(15,2) NOT NULL,
  shipping_received DECIMAL(15,2) DEFAULT 0,
  marketplace_commission DECIMAL(15,2) NOT NULL DEFAULT 0,
  marketplace_shipping_fee DECIMAL(15,2) DEFAULT 0,
  ads_cost DECIMAL(15,2) DEFAULT 0,
  cancellation DECIMAL(15,2) DEFAULT 0,
  discounts DECIMAL(15,2) DEFAULT 0,
  nfe_saida_key TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Taxes from NF-e saída série 2 (galpão only)
CREATE TABLE sale_taxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  nfe_key TEXT,
  pis DECIMAL(15,2) NOT NULL DEFAULT 0,
  cofins DECIMAL(15,2) NOT NULL DEFAULT 0,
  icms DECIMAL(15,2) NOT NULL DEFAULT 0,
  icms_difal DECIMAL(15,2) NOT NULL DEFAULT 0,
  ipi DECIMAL(15,2) NOT NULL DEFAULT 0,
  uf_destino TEXT,
  total_taxes DECIMAL(15,2) GENERATED ALWAYS AS (pis + cofins + icms + icms_difal + ipi) STORED
);

-- CMP cost applied to each sale
CREATE TABLE sale_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  cmp_cost_id UUID REFERENCES cmp_costs(id),
  unit_cost_applied DECIMAL(15,4) NOT NULL,
  total_cost DECIMAL(15,2) NOT NULL,
  margin_value DECIMAL(15,4),
  margin_pct DECIMAL(6,4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operational expenses from Conta Azul API
CREATE TABLE operational_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period DATE NOT NULL,
  dre_category TEXT NOT NULL CHECK (dre_category IN (
    -- Pessoal
    'salarios',
    'inss_patronal',
    'fgts',
    'vale_transporte',
    'vale_alimentacao',
    'plano_saude',
    'ferias_13',
    'prolabore',
    -- Operacional
    'energia',
    'agua',
    'escritorio',
    'aluguel',
    'frete_operacional',
    'publicidade_marketing',
    'sistemas_software',
    'contabilidade_consultoria',
    'outras_despesas'
  )),
  subcategory TEXT,
  description TEXT,
  supplier TEXT,
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tax apuration per month (Lucro Real)
CREATE TABLE tax_apurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period DATE NOT NULL UNIQUE,
  pis_debito DECIMAL(15,2) DEFAULT 0,
  pis_credito_compras DECIMAL(15,2) DEFAULT 0,
  pis_credito_importacao DECIMAL(15,2) DEFAULT 0,
  pis_saldo DECIMAL(15,2) DEFAULT 0,
  cofins_debito DECIMAL(15,2) DEFAULT 0,
  cofins_credito_compras DECIMAL(15,2) DEFAULT 0,
  cofins_credito_importacao DECIMAL(15,2) DEFAULT 0,
  cofins_saldo DECIMAL(15,2) DEFAULT 0,
  icms_debito DECIMAL(15,2) DEFAULT 0,
  icms_credito_entradas DECIMAL(15,2) DEFAULT 0,
  icms_credito_gnre DECIMAL(15,2) DEFAULT 0,
  icms_difal DECIMAL(15,2) DEFAULT 0,
  icms_saldo DECIMAL(15,2) DEFAULT 0,
  lucro_base DECIMAL(15,2) DEFAULT 0,
  irpj DECIMAL(15,2) DEFAULT 0,
  irpj_adicional DECIMAL(15,2) DEFAULT 0,
  csll DECIMAL(15,2) DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync log per integration
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('mercado_livre','shopee','amazon','bling')),
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','error','running')),
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- ============ 002_indexes.sql ============
-- supabase/migrations/002_indexes.sql

CREATE INDEX idx_sales_marketplace ON sales(marketplace);
CREATE INDEX idx_sales_sale_date ON sales(sale_date);
CREATE INDEX idx_sales_product_id ON sales(product_id);
CREATE INDEX idx_sales_fulfillment ON sales(fulfillment_type);
CREATE INDEX idx_unit_costs_product ON unit_costs(product_id);
CREATE INDEX idx_unit_costs_import_order ON unit_costs(import_order_id);
CREATE INDEX idx_import_items_product ON import_items(product_id);
CREATE INDEX idx_import_items_order ON import_items(import_order_id);
CREATE INDEX idx_cmp_costs_product ON cmp_costs(product_id, calculated_at DESC);
CREATE INDEX idx_operational_expenses_period ON operational_expenses(period);
CREATE INDEX idx_tax_apurations_period ON tax_apurations(period);
CREATE INDEX idx_sync_logs_source ON sync_logs(source, started_at DESC);

-- ============ 20260506_add_pack_id.sql ============
-- Adiciona pack_id na tabela sales
-- pack_id = ID do carrinho do ML quando um pedido tem múltiplos itens
-- Permite agrupar itens do mesmo carrinho para matching com NF-e
-- Execute no Supabase Dashboard → SQL Editor

ALTER TABLE sales ADD COLUMN IF NOT EXISTS pack_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_pack_id ON sales(pack_id) WHERE pack_id IS NOT NULL;

-- ============ 20260506_fix_sale_taxes_unique.sql ============
-- Adiciona UNIQUE constraint em sale_taxes.sale_id
-- Necessário para que o upsert funcione corretamente
-- Execute no Supabase Dashboard → SQL Editor

ALTER TABLE sale_taxes ADD CONSTRAINT sale_taxes_sale_id_unique UNIQUE (sale_id);

-- ============ 20260527_cmp_effective_date.sql ============
-- Adiciona effective_date em cmp_costs
-- Representa a data da NF-e de entrada (quando o lote entrou no estoque)
-- não a data em que o cálculo foi executado (calculated_at)
ALTER TABLE cmp_costs ADD COLUMN IF NOT EXISTS effective_date DATE;

-- Para registros existentes, usa a data de calculated_at como fallback
UPDATE cmp_costs SET effective_date = calculated_at::DATE WHERE effective_date IS NULL;

-- Índice para lookup por produto + data (usado em applyCmpToSale histórico)
CREATE INDEX IF NOT EXISTS idx_cmp_costs_product_date
  ON cmp_costs(product_id, effective_date DESC);

-- ============ 20260527_sales_rebate.sql ============
-- Adiciona campo rebate à tabela sales
-- Rebates incluem: desconto tarifário ML, rebates de fornecedor,
-- créditos promocionais de marketplace, bonificações de volume
ALTER TABLE sales ADD COLUMN IF NOT EXISTS rebate DECIMAL(15,2) DEFAULT 0;

-- pack_id também pode estar faltando em ambientes antigos
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pack_id TEXT;

-- ============ 20260717_marketplace_fixed_fee.sql ============
-- Separa frete (Mercado Envios, CXD*) das tarifas fixas/Full do canal
-- (CFFE custo fixo por item, CFONPN tarifa Full etc.)
-- marketplace_shipping_fee passa a conter SÓ frete; o resto vai aqui.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS marketplace_fixed_fee DECIMAL(15,2) DEFAULT 0;

-- ============ 20260720_stock_full.sql ============
-- Estoque nos centros de distribuição dos marketplaces (Full ML, futuramente FBA/Shopee).
-- stock_quantity continua sendo o estoque do galpão próprio (vem do Bling);
-- estoque total = stock_quantity + stock_full.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_full DECIMAL(12,2) DEFAULT 0;

-- ============ 20260723_audit_findings.sql ============
-- Achados da auditoria automática por venda.
-- A rota /api/audit/sales roda a bateria de regras a cada ciclo do cron;
-- achados que deixam de se reproduzir são removidos automaticamente (auto-cura).
CREATE TABLE IF NOT EXISTS audit_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,              -- ex: icms_difal_duplicado, carga_alta, sem_frete
  severity TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','critical')),
  message TEXT NOT NULL,           -- explicação em português para o painel
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sale_id, rule)
);
CREATE INDEX IF NOT EXISTS idx_audit_findings_rule ON audit_findings(rule);

-- ============ 20260723_uf_destino.sql ============
-- UF de destino da venda (estado do comprador) — vem do extrato do ML
-- (sales_info.state_name) e/ou do enderDest da NF-e. Base para análise de
-- vendas por estado e conferência de DIFAL.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS uf_destino TEXT;

-- ============ 20260725_audit_details.sql ============
-- Vistoria de taxas: detalhe numérico da divergência (cobrado/esperado/diff)
ALTER TABLE audit_findings ADD COLUMN IF NOT EXISTS details jsonb;

-- ============ 20260727_cost_locked.sql ============
-- Custos por SKU: cadeado por produto (travado = NF de entrada não altera o custo)
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_locked boolean DEFAULT false;

-- ============ 20260727_products_archived.sql ============
-- Arquivamento de SKUs mortos (sem venda em 6 meses e sem estoque)
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- ============ 20260728_audit_dismissed.sql ============
-- Dispensa de avisos da auditoria (persistente entre rodadas)
ALTER TABLE audit_findings ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- ============ 20260728_sale_import_credit.sql ============
-- Crédito de importação (PIS+COFINS+ICMS) aplicado na margem de cada venda —
-- guardado para o DRE somar pela mesma régua da margem
ALTER TABLE sale_costs ADD COLUMN IF NOT EXISTS import_credit numeric DEFAULT 0;

-- ============ 20260729_import_planning.sql ============
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

-- ============ 20260730_fluxo_geral.sql ============
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

-- ============ 20260730_plan_compromissado.sql ============
-- Pedido previsto (em estudo) vs compromissado (fechado com fornecedor)
ALTER TABLE import_plans ADD COLUMN IF NOT EXISTS compromissado boolean DEFAULT true;

-- ============ 20260730_plan_extras.sql ============
-- Taxas extras da importação (Siscomex, AFRMM, armazenagem…) com data própria
ALTER TABLE import_plans ADD COLUMN IF NOT EXISTS extras jsonb DEFAULT '[]';

-- ============ 20260904_sale_payouts.sql ============
-- Auditoria de repasse: guarda o valor REALMENTE repassado pelo marketplace
-- (líquido depositado), pra conciliar contra o esperado que o Oryma calcula.
-- O "esperado" é calculado na hora a partir das colunas de tarifa/comissão que
-- já existem — não precisa guardar. Rateado por item, como as tarifas.
--   payout_actual        = quanto o marketplace repassou (rateado por item)
--   payout_release_date  = quando foi/será liberado o repasse
--   payout_status        = estado do repasse no marketplace (texto livre do canal)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_actual DECIMAL(15,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_release_date DATE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_status TEXT;

