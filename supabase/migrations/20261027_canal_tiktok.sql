-- 27/10/2026 — TikTok Shop vira canal de venda (sales e ads)
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_marketplace_check;
ALTER TABLE sales ADD CONSTRAINT sales_marketplace_check
  CHECK (marketplace IN ('mercado_livre','shopee','amazon','magalu','tiktok'));
ALTER TABLE ads_metrics DROP CONSTRAINT IF EXISTS ads_metrics_marketplace_check;
ALTER TABLE ads_metrics ADD CONSTRAINT ads_metrics_marketplace_check
  CHECK (marketplace IN ('mercado_livre','shopee','amazon','magalu','tiktok'));
