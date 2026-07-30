-- Taxas extras da importação (Siscomex, AFRMM, armazenagem…) com data própria
ALTER TABLE import_plans ADD COLUMN IF NOT EXISTS extras jsonb DEFAULT '[]';
