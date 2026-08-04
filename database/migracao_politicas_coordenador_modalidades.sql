-- Segurança da visão restrita de Coordenadores/Apoios.
-- Pressupõe que usuarios.id corresponde a auth.uid().

ALTER TABLE public.coordenador_modalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atletas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coordenador_le_seus_vinculos" ON public.coordenador_modalidades;
CREATE POLICY "coordenador_le_seus_vinculos"
ON public.coordenador_modalidades FOR SELECT TO authenticated
USING (
    usuario_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.cargo NOT IN ('Coordenador', 'Apoio')
    )
);

DROP POLICY IF EXISTS "diretoria_gerencia_vinculos_coordenador" ON public.coordenador_modalidades;
CREATE POLICY "diretoria_gerencia_vinculos_coordenador"
ON public.coordenador_modalidades FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.cargo NOT IN ('Coordenador', 'Apoio')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.cargo NOT IN ('Coordenador', 'Apoio')
    )
);

DROP POLICY IF EXISTS "atletas_por_modalidade_do_coordenador" ON public.atletas;
CREATE POLICY "atletas_por_modalidade_do_coordenador"
ON public.atletas FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.cargo NOT IN ('Coordenador', 'Apoio')
    )
    OR EXISTS (
        SELECT 1 FROM public.coordenador_modalidades cm
        WHERE cm.usuario_id = auth.uid()
          AND cm.modalidade_id = atletas.modalidade_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.cargo NOT IN ('Coordenador', 'Apoio')
    )
    OR EXISTS (
        SELECT 1 FROM public.coordenador_modalidades cm
        WHERE cm.usuario_id = auth.uid()
          AND cm.modalidade_id = atletas.modalidade_id
    )
);
