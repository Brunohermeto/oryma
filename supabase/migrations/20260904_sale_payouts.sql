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
