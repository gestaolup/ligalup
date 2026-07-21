-- ============================================================================
-- PLATAFORMA SAAS DE GESTÃO ESTRATÉGICA - ATLÉTICA UNIVERSITÁRIA
-- TRIGGERS E REGRAS DE NEGÓCIO (POSTGRESQL) - MVP v2.0
-- ============================================================================

-- Nota: Para simulação dos triggers de verificação de permissões do usuário,
-- assume-se a existência de uma variável de sessão do Postgres 'app.current_user_id'
-- que identifica o usuário que está executando a transação.

-- ----------------------------------------------------------------------------
-- RN-EV-01: Fluxo de Aprovação de Eventos & Bloqueio de Calendário Editorial
-- ----------------------------------------------------------------------------

-- A. Trigger para bloquear aprovação não autorizada
CREATE OR REPLACE FUNCTION fn_trg_verificar_aprovacao_evento()
RETURNS TRIGGER AS $$
DECLARE
    v_user_cargo tipo_cargo;
    v_user_diretoria TEXT;
    v_user_id UUID;
BEGIN
    -- Recupera o ID do usuário da sessão (configurado pela aplicação antes da query)
    BEGIN
        v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- Se o status está mudando para 'Aprovado' vindo de 'Aguardando Tesouraria'
    IF NEW.status_aprovacao = 'Aprovado' AND OLD.status_aprovacao = 'Aguardando Tesouraria' THEN
        -- Verifica se o usuário de sessão está definido
        IF v_user_id IS NULL THEN
            RAISE EXCEPTION 'Acesso negado: Usuário de sessão não definido para aprovação de eventos.' USING ERRCODE = '42501';
        END IF;

        -- Busca informações do usuário executor e nome da diretoria
        SELECT u.cargo, d.nome INTO v_user_cargo, v_user_diretoria 
        FROM usuarios u
        LEFT JOIN diretorias d ON u.diretoria_id = d.id
        WHERE u.id = v_user_id AND u.status = TRUE;

        -- Regra: Apenas diretoria == 'Tesouraria' ou cargo == 'Presidência' ou 'Vice-Presidência'
        IF NOT (v_user_diretoria = 'Tesouraria' OR v_user_cargo IN ('Master') OR v_user_diretoria IN ('Presidência', 'Vice-Presidência')) THEN
            -- Registrar tentativa de violação de forma autônoma na tabela de logs
            -- Em Postgres normal, transações abortadas desfazem inserts, mas geramos o erro estruturado para log na aplicação.
            INSERT INTO logs_notificacoes (usuario_id, tipo_notificacao, gatilho_regra, destinatario_email, status_entrega, erro_detalhe)
            VALUES (v_user_id, 'Alerta de Segurança', 'TENTATIVA_VIOLACAO', 'presidencia@atleticalup.com.br', 'ENVIADO', 
                    'Tentativa de aprovação de evento ' || NEW.nome || ' (ID: ' || NEW.id || ') por usuário não autorizado.');

            RAISE EXCEPTION 'Erro 403: Apenas a Tesouraria ou a Presidência podem aprovar eventos.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verificar_aprovacao_evento
    BEFORE UPDATE OF status_aprovacao ON eventos
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_verificar_aprovacao_evento();


-- B. Trigger para bloquear postagem de marketing em eventos não aprovados
CREATE OR REPLACE FUNCTION fn_trg_verificar_calendario_evento()
RETURNS TRIGGER AS $$
DECLARE
    v_status_evento status_evento;
BEGIN
    SELECT status_aprovacao INTO v_status_evento 
    FROM eventos 
    WHERE id = NEW.evento_id;

    IF v_status_evento != 'Aprovado' THEN
        RAISE EXCEPTION 'Regra RN-EV-01: Não é permitido criar postagens ou campanhas de marketing para eventos que não estejam aprovados pela Tesouraria.' USING ERRCODE = '45000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verificar_calendario_evento
    BEFORE INSERT OR UPDATE ON calendario_editorial
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_verificar_calendario_evento();

-- ----------------------------------------------------------------------------
-- RN-EV-02: Integração Financeira Automática
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_gerar_lancamento_evento_aprovado()
RETURNS TRIGGER AS $$
BEGIN
    -- Se o evento passou a ser Aprovado, gera automaticamente o débito financeiro
    IF NEW.status_aprovacao = 'Aprovado' AND OLD.status_aprovacao != 'Aprovado' THEN
        INSERT INTO lancamentos_financeiros (tipo, categoria, valor, evento_id, status_conciliacao, data_competencia)
        VALUES (
            'Saída', 
            'Logística Evento', 
            NEW.orcamento_previsto, 
            NEW.id, 
            FALSE, -- Conciliação pendente por padrão
            CURRENT_TIMESTAMP
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gerar_lancamento_evento_aprovado
    AFTER UPDATE OF status_aprovacao ON eventos
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_gerar_lancamento_evento_aprovado();

-- ----------------------------------------------------------------------------
-- RN-FIN-01: Imutabilidade de Caixa (Lançamentos Conciliados)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_proteger_lancamento_conciliado()
RETURNS TRIGGER AS $$
BEGIN
    -- Bloquear alteração ou deleção se o status de conciliação já for verdadeiro
    IF OLD.status_conciliacao = TRUE THEN
        -- Verifica se estão tentando alterar campos críticos
        IF TG_OP = 'UPDATE' THEN
            IF NEW.valor != OLD.valor OR NEW.tipo != OLD.tipo OR NEW.data_competencia != OLD.data_competencia THEN
                RAISE EXCEPTION 'Regra RN-FIN-01: Lançamento já conciliado é IMUTÁVEL. Modificações em valor, tipo ou data são proibidas. Faça um lançamento de estorno.' USING ERRCODE = '45000';
            END IF;
        ELSIF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Regra RN-FIN-01: Lançamento já conciliado não pode ser excluído do caixa.' USING ERRCODE = '45000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_lancamento_conciliado_update
    BEFORE UPDATE ON lancamentos_financeiros
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_proteger_lancamento_conciliado();

CREATE TRIGGER trg_proteger_lancamento_conciliado_delete
    BEFORE DELETE ON lancamentos_financeiros
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_proteger_lancamento_conciliado();

-- ----------------------------------------------------------------------------
-- RN-ESP-01: Elegibilidade Esportiva e Restrição Jurídica de Documentação
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_proteger_documentacao_atleta()
RETURNS TRIGGER AS $$
DECLARE
    v_user_cargo tipo_cargo;
    v_user_diretoria TEXT;
    v_user_id UUID;
BEGIN
    -- Verifica se estão tentando alterar a documentação
    IF OLD.status_documentacao != NEW.status_documentacao THEN
        -- Recupera usuário da sessão
        BEGIN
            v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;

        IF v_user_id IS NULL THEN
            RAISE EXCEPTION 'Acesso negado: Usuário de sessão não definido para alteração de status documental.' USING ERRCODE = '42501';
        END IF;

        -- Busca informações do usuário
        SELECT u.cargo, d.nome INTO v_user_cargo, v_user_diretoria 
        FROM usuarios u
        LEFT JOIN diretorias d ON u.diretoria_id = d.id
        WHERE u.id = v_user_id AND u.status = TRUE;

        -- Regra: Apenas diretoria == 'Jurídico' pode alterar a documentação dos atletas
        IF NOT (v_user_diretoria = 'Jurídico' OR v_user_cargo = 'Master' OR v_user_cargo = 'Presidente' OR v_user_diretoria IN ('Presidência', 'Presidencia', 'Vice-Presidência', 'Vice-Presidencia')) THEN
            RAISE EXCEPTION 'Erro 403: Apenas membros do Jurídico podem validar ou reprovar documentos de atletas.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_documentacao_atleta
    BEFORE UPDATE OF status_documentacao ON atletas
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_proteger_documentacao_atleta();

-- ----------------------------------------------------------------------------
-- RN-JUR-01: Validação de Parceria (Funil de Vendas e Links)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_validar_parceria_ativa()
RETURNS TRIGGER AS $$
DECLARE
    v_contratos_ativos INTEGER;
BEGIN
    -- Se o status está mudando para 'Contrato Ativo'
    IF NEW.status_funil = 'Contrato Ativo' AND OLD.status_funil != 'Contrato Ativo' THEN
        -- Verifica se existe pelo menos um documento associado que tenha URL (link)
        SELECT COUNT(*) INTO v_contratos_ativos 
        FROM documentos_contratos 
        WHERE parceiro_id = NEW.id 
          AND arquivo_url IS NOT NULL 
          AND TRIM(arquivo_url) != '';

        IF v_contratos_ativos = 0 THEN
            RAISE EXCEPTION 'Regra RN-JUR-01: Não é permitido marcar a parceria como ativa sem que exista um contrato anexado (link de arquivo ativo) no GED.' USING ERRCODE = '45000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_parceria_ativa
    BEFORE UPDATE OF status_funil ON parceiros_patrocinadores
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_validar_parceria_ativa();

-- ----------------------------------------------------------------------------
-- RN-LOG-01: Auditoria Absoluta (Logs de Notificação Append-Only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_bloquear_modificacao_logs()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Regra RN-LOG-01: A tabela logs_notificacoes é append-only. Operações de UPDATE ou DELETE são proibidas por auditoria.' USING ERRCODE = '45000';
    RETURN NULL; -- Aborta a transação
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bloquear_modificacao_logs_update
    BEFORE UPDATE ON logs_notificacoes
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_bloquear_modificacao_logs();

CREATE TRIGGER trg_bloquear_modificacao_logs_delete
    BEFORE DELETE ON logs_notificacoes
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_bloquear_modificacao_logs();

-- ----------------------------------------------------------------------------
-- Novidade Fase 2: Recebimento de Pedido de Compra e incremento de estoque
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_receber_pedido_compra()
RETURNS TRIGGER AS $$
BEGIN
    -- Se o status está mudando para 'Recebido'
    IF NEW.status = 'Recebido' AND (OLD.status IS NULL OR OLD.status != 'Recebido') THEN
        -- Incrementar o estoque físico na tabela produto_variantes
        INSERT INTO produto_variantes (produto_id, tamanho, estoque_atual)
        VALUES (NEW.produto_id, NEW.tamanho, NEW.quantidade)
        ON CONFLICT (produto_id, tamanho)
        DO UPDATE SET estoque_atual = produto_variantes.estoque_atual + EXCLUDED.quantidade;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receber_pedido_compra
    AFTER INSERT OR UPDATE OF status ON pedidos_compra
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_receber_pedido_compra();
