-- Corrige bases legadas em que eventos.id foi criado sem valor padrão.
-- O Supabase disponibiliza gen_random_uuid() por meio da extensão pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.eventos
    ALTER COLUMN id SET DEFAULT gen_random_uuid();
