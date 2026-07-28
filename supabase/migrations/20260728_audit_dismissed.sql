-- Dispensa de avisos da auditoria (persistente entre rodadas)
ALTER TABLE audit_findings ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
