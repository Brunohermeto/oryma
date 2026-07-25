-- Vistoria de taxas: detalhe numérico da divergência (cobrado/esperado/diff)
ALTER TABLE audit_findings ADD COLUMN IF NOT EXISTS details jsonb;
