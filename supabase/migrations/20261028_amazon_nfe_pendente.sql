-- NF de venda da Amazon (Faturador) cujo pedido ainda não estava no Oryma
-- (pedido "Pending" na emissão). O ciclo diário tenta ligar de novo (28/10/2026).
CREATE TABLE IF NOT EXISTS amazon_nfe_pendente (
  chave     TEXT PRIMARY KEY,
  pedido    TEXT NOT NULL,
  xml       TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE amazon_nfe_pendente ENABLE ROW LEVEL SECURITY;
