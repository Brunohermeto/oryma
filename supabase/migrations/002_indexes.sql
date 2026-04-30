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
