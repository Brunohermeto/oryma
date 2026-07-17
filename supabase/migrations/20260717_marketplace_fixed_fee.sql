-- Separa frete (Mercado Envios, CXD*) das tarifas fixas/Full do canal
-- (CFFE custo fixo por item, CFONPN tarifa Full etc.)
-- marketplace_shipping_fee passa a conter SÓ frete; o resto vai aqui.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS marketplace_fixed_fee DECIMAL(15,2) DEFAULT 0;
