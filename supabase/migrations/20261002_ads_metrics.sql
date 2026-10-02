-- 02/10/2026 — Painel de investimento em Ads (pedido do Bruno).
-- ads_metrics: uma linha por anúncio/campanha por período.
--   ML vem da API todo dia (date_from = date_to = o dia; source='api').
--   Shopee/Amazon vêm do upload quinzenal (período do relatório; source='upload').
-- ads_campaign_products: vínculo campanha → produtos escolhido UMA vez pelo Bruno
--   (campanha Amazon sem ASIN no nome, ex.: [FBA][BERÇO PORTATIL][4X]).
-- O ML apaga métricas com mais de 90 dias: guardar aqui é o que preserva o histórico.

CREATE TABLE IF NOT EXISTS ads_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace   text NOT NULL CHECK (marketplace IN ('mercado_livre','shopee','amazon','magalu')),
  date_from     date NOT NULL,
  date_to       date NOT NULL,
  campaign_id   text NOT NULL DEFAULT '',
  campaign_name text,
  ad_ref        text NOT NULL DEFAULT '',   -- MLB (ML) · ID do produto (Shopee) · ASIN (Amazon)
  ad_title      text,
  product_skus  text[] NOT NULL DEFAULT '{}', -- SKUs do NOSSO cadastro ligados ao anúncio
  impressions   bigint  NOT NULL DEFAULT 0,
  clicks        bigint  NOT NULL DEFAULT 0,
  cost          numeric(12,2) NOT NULL DEFAULT 0,
  ad_sales      numeric(12,2) NOT NULL DEFAULT 0,  -- receita atribuída pelo marketplace
  ad_orders     numeric(10,2) NOT NULL DEFAULT 0,  -- pedidos/itens atribuídos
  source        text NOT NULL DEFAULT 'upload' CHECK (source IN ('api','upload')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marketplace, date_from, date_to, campaign_id, ad_ref)
);
CREATE INDEX IF NOT EXISTS ads_metrics_periodo ON ads_metrics (marketplace, date_from, date_to);

CREATE TABLE IF NOT EXISTS ads_campaign_products (
  marketplace   text NOT NULL,
  campaign_id   text NOT NULL,
  campaign_name text,
  product_skus  text[] NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (marketplace, campaign_id)
);

ALTER TABLE ads_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_campaign_products ENABLE ROW LEVEL SECURITY;
