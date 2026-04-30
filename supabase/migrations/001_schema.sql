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
