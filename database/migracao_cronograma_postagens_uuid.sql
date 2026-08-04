-- Corrige instalações legadas cujo ID do cronograma não possui valor padrão.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.cronograma_postagens
    ALTER COLUMN id SET DEFAULT gen_random_uuid();
