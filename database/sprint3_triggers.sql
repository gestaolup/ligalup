-- ============================================================================
-- SPRINT 3: MIGRAÇÃO RBAC - TRIGGERS DE SEGURANÇA RELACIONAIS NO POSTGRESQL
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Trigger de Validação de Aprovação de Eventos & Finanças
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_verificar_aprovacao_evento()
RETURNS TRIGGER AS $$
DECLARE
    v_user_cargo tipo_cargo;
    v_user_diretoria TEXT;
    v_user_id TEXT;
    v_has_permission BOOLEAN := FALSE;
BEGIN
    -- Recupera o ID do usuário da sessão (Supabase auth.uid() ou variável de sessão)
    BEGIN
        v_user_id := COALESCE(
            NULLIF(auth.uid()::text, ''),
            NULLIF(current_setting('app.current_user_id', true), '')
        );
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- Se o status está mudando para 'Aprovado' vindo de 'Aguardando Tesouraria'
    IF NEW.status_aprovacao = 'Aprovado' AND OLD.status_aprovacao = 'Aguardando Tesouraria' THEN
        -- Fail-safe: Bloqueia se usuário de sessão não estiver definido
        IF v_user_id IS NULL THEN
            RAISE EXCEPTION 'Acesso negado: Usuário de sessão não definido para aprovação de eventos.' USING ERRCODE = '42501';
        END IF;

        -- Busca dados do usuário executor na tabela pública
        SELECT u.cargo, d.nome INTO v_user_cargo, v_user_diretoria 
        FROM public.usuarios u
        LEFT JOIN public.diretorias d ON u.diretoria_id = d.id
        WHERE u.id::text = v_user_id AND u.status = TRUE;

        -- Regra 1: Bypass Incondicional do Núcleo Executivo (Master, Presidente, Vice)
        IF (v_user_cargo IN ('Master', 'Presidente') OR v_user_diretoria IN ('Presidência', 'Presidencia', 'Vice-Presidência', 'Vice-Presidencia')) THEN
            v_has_permission := TRUE;
        ELSE
            -- Regra 2: Consulta Relacional Dinâmica na Tabela de Permissões (Sprint 3)
            -- Verifica tanto a diretoria primária quanto diretorias secundárias em usuario_diretorias
            SELECT EXISTS (
                SELECT 1 FROM public.permissoes p
                WHERE p.concedida = TRUE
                  AND p.acao_sistema IN ('aprovar_evento', 'mod-financeiro', 'mod-eventos')
                  AND p.diretoria_id IN (
                      SELECT u.diretoria_id FROM public.usuarios u WHERE u.id::text = v_user_id AND u.diretoria_id IS NOT NULL
                      UNION
                      SELECT ud.diretoria_id FROM public.usuario_diretorias ud WHERE ud.usuario_id::text = v_user_id
                  )
            ) INTO v_has_permission;
        END IF;

        -- Se não tiver permissão nem for executivo, bloqueia e registra tentativa de violação
        IF NOT v_has_permission THEN
            INSERT INTO public.logs_notificacoes (usuario_id, tipo_notificacao, gatilho_regra, destinatario_email, status_entrega, erro_detalhe)
            VALUES (v_user_id, 'Alerta de Segurança', 'TENTATIVA_VIOLACAO', 'presidencia@atleticalup.com.br', 'ENVIADO', 
                    'Tentativa de aprovação não autorizada do evento ' || NEW.nome || ' (ID: ' || NEW.id || ').');

            RAISE EXCEPTION 'Erro 403: Usuário não possui permissão (aprovar_evento ou mod-financeiro) para aprovar orçamentos de eventos.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-cria o trigger em eventos
DROP TRIGGER IF EXISTS trg_verificar_aprovacao_evento ON public.eventos;
CREATE TRIGGER trg_verificar_aprovacao_evento
    BEFORE UPDATE OF status_aprovacao ON public.eventos
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_verificar_aprovacao_evento();


-- ----------------------------------------------------------------------------
-- 2. Trigger de Restrição Jurídica e Validação de Documentação de Atletas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_proteger_documentacao_atleta()
RETURNS TRIGGER AS $$
DECLARE
    v_user_cargo tipo_cargo;
    v_user_diretoria TEXT;
    v_user_id TEXT;
    v_has_permission BOOLEAN := FALSE;
BEGIN
    -- Verifica se o status documental foi alterado
    IF OLD.status_documentacao IS DISTINCT FROM NEW.status_documentacao THEN
        -- Recupera usuário da sessão
        BEGIN
            v_user_id := COALESCE(
                NULLIF(auth.uid()::text, ''),
                NULLIF(current_setting('app.current_user_id', true), '')
            );
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;

        IF v_user_id IS NULL THEN
            RAISE EXCEPTION 'Acesso negado: Usuário de sessão não definido para alteração de status documental.' USING ERRCODE = '42501';
        END IF;

        -- Busca informações do usuário
        SELECT u.cargo, d.nome INTO v_user_cargo, v_user_diretoria 
        FROM public.usuarios u
        LEFT JOIN public.diretorias d ON u.diretoria_id = d.id
        WHERE u.id::text = v_user_id AND u.status = TRUE;

        -- Regra 1: Bypass Incondicional do Núcleo Executivo (Master, Presidente, Vice)
        IF (v_user_cargo IN ('Master', 'Presidente') OR v_user_diretoria IN ('Presidência', 'Presidencia', 'Vice-Presidência', 'Vice-Presidencia')) THEN
            v_has_permission := TRUE;
        ELSE
            -- Regra 2: Consulta Relacional Dinâmica na Tabela de Permissões (Sprint 3)
            SELECT EXISTS (
                SELECT 1 FROM public.permissoes p
                WHERE p.concedida = TRUE
                  AND p.acao_sistema IN ('validar_atleta', 'mod-legal', 'mod-esportes')
                  AND p.diretoria_id IN (
                      SELECT u.diretoria_id FROM public.usuarios u WHERE u.id::text = v_user_id AND u.diretoria_id IS NOT NULL
                      UNION
                      SELECT ud.diretoria_id FROM public.usuario_diretorias ud WHERE ud.usuario_id::text = v_user_id
                  )
            ) INTO v_has_permission;
        END IF;

        IF NOT v_has_permission THEN
            RAISE EXCEPTION 'Erro 403: Apenas membros com permissão (validar_atleta ou mod-legal) podem alterar a documentação de atletas.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-cria o trigger em atletas
DROP TRIGGER IF EXISTS trg_proteger_documentacao_atleta ON public.atletas;
CREATE TRIGGER trg_proteger_documentacao_atleta
    BEFORE UPDATE OF status_documentacao ON public.atletas
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_proteger_documentacao_atleta();
