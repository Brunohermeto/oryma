-- Adiciona UNIQUE constraint em sale_taxes.sale_id
-- Necessário para que o upsert funcione corretamente
-- Execute no Supabase Dashboard → SQL Editor

ALTER TABLE sale_taxes ADD CONSTRAINT sale_taxes_sale_id_unique UNIQUE (sale_id);
