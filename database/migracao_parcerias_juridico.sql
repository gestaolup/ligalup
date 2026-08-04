-- Fluxo Parcerias -> Jurídico/GED
-- Execute no SQL Editor do Supabase antes de publicar a interface.

ALTER TABLE parceiros_patrocinadores
    ADD COLUMN IF NOT EXISTS link_proposta_drive VARCHAR(1024);

ALTER TYPE status_funil_parceria ADD VALUE IF NOT EXISTS 'Proposta Gerada';
ALTER TYPE status_funil_parceria ADD VALUE IF NOT EXISTS 'Contrato Anexado / Em Assinatura';

-- Habilita a entrega de mudanças para todos os módulos da interface.
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'usuarios', 'eventos', 'tarefas_logistica', 'modalidades', 'atletas',
        'produtos', 'produto_variantes', 'calendario_editorial', 'cronograma_postagens',
        'escalacoes', 'participantes_evento', 'lancamentos_financeiros',
        'parceiros_patrocinadores', 'documentos_contratos', 'logs_notificacoes',
        'fornecedores', 'pedidos_compra', 'pedidos_compra_itens', 'log_recebimentos',
        'diretorias', 'usuario_diretorias', 'permissoes', 'configuracoes_globais',
        'notificacoes_config'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = v_table
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', v_table);
        END IF;
    END LOOP;
END $$;
