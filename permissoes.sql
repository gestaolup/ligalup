CREATE TABLE IF NOT EXISTS public.permissoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    acao_sistema TEXT NOT NULL,
    cargo_id TEXT,
    diretoria_id TEXT,
    concedida BOOLEAN DEFAULT false
);

ALTER TABLE public.permissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso as permissoes"
ON public.permissoes
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);
