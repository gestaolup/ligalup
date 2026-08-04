-- Fase 1: dados de contato dos atletas.
-- Execute este script uma vez no SQL Editor do projeto Supabase.
ALTER TABLE public.atletas
    ADD COLUMN IF NOT EXISTS contato VARCHAR(50),
    ADD COLUMN IF NOT EXISTS email VARCHAR(255);
