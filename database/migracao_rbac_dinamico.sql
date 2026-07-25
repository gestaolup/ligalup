-- ============================================================================
-- SPRINT 1: MIGRAÇÃO RBAC - TABELA RELACIONAL DE MULTIPLAS DIRETORIAS
-- ============================================================================

-- Extensão UUID (caso não esteja ativa)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Criação da Tabela Relacional (Junction Table)
CREATE TABLE IF NOT EXISTS public.usuario_diretorias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id TEXT NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    diretoria_id UUID NOT NULL REFERENCES public.diretorias(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_usuario_diretoria UNIQUE(usuario_id, diretoria_id)
);

-- 2. Migração/População inicial com base nas diretorias primárias existentes em usuarios
INSERT INTO public.usuario_diretorias (usuario_id, diretoria_id)
SELECT id, diretoria_id 
FROM public.usuarios 
WHERE diretoria_id IS NOT NULL
ON CONFLICT (usuario_id, diretoria_id) DO NOTHING;

-- 3. Habilitação de RLS e Políticas de Acesso no Supabase
ALTER TABLE public.usuario_diretorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura publica de usuario_diretorias" ON public.usuario_diretorias;
CREATE POLICY "Permitir leitura publica de usuario_diretorias" 
ON public.usuario_diretorias FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir gestao publica de usuario_diretorias" ON public.usuario_diretorias;
CREATE POLICY "Permitir gestao publica de usuario_diretorias" 
ON public.usuario_diretorias FOR ALL USING (true);
