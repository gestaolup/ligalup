CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.agenda_geral (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    descricao TEXT,
    data_evento TIMESTAMP WITH TIME ZONE NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'Atividade',
    -- usuarios.id é TEXT na base atualmente em produção; a FK deve usar o
    -- mesmo tipo da chave referenciada.
    criado_por TEXT REFERENCES public.usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'agenda_geral'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.agenda_geral;
    END IF;
END $$;
