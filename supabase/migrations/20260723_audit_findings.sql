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
