-- ============================================================================
-- SPRINT 4 — MÓDULO DE COMPRAS v1.2 (Supply Chain ERP)
-- LIGA-LUP — Plataforma de Gestão Estratégica de Atléticas Universitárias
-- ============================================================================
--
-- INSTRUÇÃO DE EXECUÇÃO:
--   1. Abra o Supabase Dashboard → SQL Editor → New Query
--   2. Cole este script completo
--   3. Clique em "Run" (ou Ctrl+Enter)
--   4. Verifique as mensagens de sucesso antes de confirmar execução da Fase 2
--
-- IMPACTO NA ESTRUTURA EXISTENTE:
--   • A tabela legada 'pedidos_compra' (8 colunas) será RENOMEADA
--     para 'pedidos_compra_legado' (preservação não-destrutiva).
--   • 3 novas tabelas criadas: pedidos_compra, pedidos_compra_itens,
--     log_recebimentos.
--   • 5 novas funções PL/pgSQL + 5 triggers criados.
--   • 3 RLS habilitadas com 4 políticas cada.
-- ============================================================================

BEGIN;

-- ============================================================================
-- ETAPA 1: MIGRAÇÃO NÃO-DESTRUTIVA DA TABELA LEGADA
-- ============================================================================
-- Renomeia a estrutura monolítica existente preservando os registros históricos.
-- A nova 'pedidos_compra' terá o modelo capa+linhas padrão ERP.

ALTER TABLE IF EXISTS public.pedidos_compra RENAME TO pedidos_compra_legado;

-- ============================================================================
-- ETAPA 2: CRIAÇÃO DAS NOVAS TABELAS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 — Capa do Pedido de Compra
--       Representa o cabeçalho de um pedido completo a um fornecedor.
-- ----------------------------------------------------------------------------
CREATE TABLE public.pedidos_compra (
    id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    fornecedor_id         UUID          NOT NULL REFERENCES public.fornecedores(id) ON DELETE RESTRICT,
    comprador_id          TEXT          NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
    data_emissao          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    data_prevista_entrega DATE,
    valor_total           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status                VARCHAR(50)   NOT NULL DEFAULT 'Rascunho'
        CONSTRAINT chk_status_pedido_compra CHECK (
            status IN (
                'Rascunho',
                'Aguardando Aprovação',
                'Aprovado',
                'Parcialmente Recebido',
                'Concluído',
                'Cancelado'
            )
        ),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pedidos_compra IS
    'Sprint 4 — Capa do Pedido de Compra (Supply Chain ERP). '
    'Rastreia fornecedor, comprador, previsão de entrega e fluxo de status '
    'via State Machine (PL/pgSQL).';

COMMENT ON COLUMN public.pedidos_compra.valor_total IS
    'Calculado automaticamente pela trigger trg_calcula_valor_total a cada '
    'INSERT/UPDATE/DELETE em pedidos_compra_itens.';

-- ----------------------------------------------------------------------------
-- 2.2 — Linhas (Itens) do Pedido de Compra
--       Cada linha representa um produto/variante encomendado na capa.
-- ----------------------------------------------------------------------------
CREATE TABLE public.pedidos_compra_itens (
    id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    pedido_id             UUID          NOT NULL REFERENCES public.pedidos_compra(id) ON DELETE CASCADE,
    produto_id            UUID          NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
    variante_id           UUID          REFERENCES public.produto_variantes(id) ON DELETE SET NULL,
    quantidade_solicitada INTEGER       NOT NULL CHECK (quantidade_solicitada > 0),
    quantidade_recebida   INTEGER       NOT NULL DEFAULT 0 CHECK (quantidade_recebida >= 0),
    preco_unitario        DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (preco_unitario >= 0),
    subtotal              DECIMAL(12,2) GENERATED ALWAYS AS (quantidade_solicitada * preco_unitario) STORED,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_recebida_lte_solicitada
        CHECK (quantidade_recebida <= quantidade_solicitada)
);

COMMENT ON TABLE public.pedidos_compra_itens IS
    'Sprint 4 — Linhas (Grid de Itens) do Pedido de Compra. '
    'Relaciona produtos/variantes ao pedido com quantidades e preços. '
    'Subtotal é uma coluna GENERATED (auto-calculada). '
    'Edição bloqueada por trigger State Machine quando capa ≥ Aprovado.';

COMMENT ON COLUMN public.pedidos_compra_itens.variante_id IS
    'FK opcional para produto_variantes. '
    'Se preenchido, a trigger de recebimento incrementa estoque_atual nessa variante.';

-- ----------------------------------------------------------------------------
-- 2.3 — Log de Recebimentos (Motor de BI — Append-Only)
--       Rastreia CADA baixa fracionada: base para o cálculo de SLA de fornecedores.
-- ----------------------------------------------------------------------------
CREATE TABLE public.log_recebimentos (
    id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id               UUID          NOT NULL REFERENCES public.pedidos_compra_itens(id) ON DELETE CASCADE,
    quantidade_baixada    INTEGER       NOT NULL CHECK (quantidade_baixada > 0),
    data_prevista_original DATE,        -- Copiado da capa no momento da baixa (auto-preenchido pela trigger)
    data_recebimento_real  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    recebedor_id          TEXT          NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.log_recebimentos IS
    'Sprint 4 — Log Append-Only de recebimentos parciais ou totais de itens. '
    'Base para BI de SLA de fornecedores: compara data_prevista_original '
    'com data_recebimento_real. UPDATE e DELETE são bloqueados por RLS.';

-- ============================================================================
-- ETAPA 3: ÍNDICES PARA PERFORMANCE
-- ============================================================================

CREATE INDEX idx_pc_status          ON public.pedidos_compra(status);
CREATE INDEX idx_pc_fornecedor_id   ON public.pedidos_compra(fornecedor_id);
CREATE INDEX idx_pc_comprador_id    ON public.pedidos_compra(comprador_id);
CREATE INDEX idx_pc_data_entrega    ON public.pedidos_compra(data_prevista_entrega);
CREATE INDEX idx_pci_pedido_id      ON public.pedidos_compra_itens(pedido_id);
CREATE INDEX idx_pci_produto_id     ON public.pedidos_compra_itens(produto_id);
CREATE INDEX idx_pci_variante_id    ON public.pedidos_compra_itens(variante_id);
CREATE INDEX idx_lr_item_id         ON public.log_recebimentos(item_id);
CREATE INDEX idx_lr_recebedor_id    ON public.log_recebimentos(recebedor_id);
CREATE INDEX idx_lr_data_real       ON public.log_recebimentos(data_recebimento_real);

-- ============================================================================
-- ETAPA 4: ROW LEVEL SECURITY (RLS) — Políticas Restritivas
--
-- Princípio: Nenhuma política usa (true) WITH CHECK (true).
-- Toda autorização valida auth.uid() contra a tabela public.usuarios.
-- A validação de RBAC granular (aprovar_pedido_compra) é feita nas Triggers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4.1 — pedidos_compra
-- ----------------------------------------------------------------------------
ALTER TABLE public.pedidos_compra ENABLE ROW LEVEL SECURITY;

-- SELECT: Qualquer membro autenticado e ativo pode visualizar pedidos
CREATE POLICY "pc_select_membro_ativo"
    ON public.pedidos_compra FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

-- INSERT: Membro ativo; comprador_id deve ser o próprio usuário autenticado
CREATE POLICY "pc_insert_membro_ativo"
    ON public.pedidos_compra FOR INSERT
    TO authenticated
    WITH CHECK (
        comprador_id = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

-- UPDATE: Membro ativo; validação de State Machine e RBAC de aprovação
-- são feitas pelas triggers BEFORE UPDATE (mais granulares que RLS)
CREATE POLICY "pc_update_membro_ativo"
    ON public.pedidos_compra FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

-- DELETE: Bloqueado para todos (integridade de auditoria e rastreabilidade)
CREATE POLICY "pc_delete_bloqueado"
    ON public.pedidos_compra FOR DELETE
    TO authenticated
    USING (FALSE);

-- ----------------------------------------------------------------------------
-- 4.2 — pedidos_compra_itens
-- ----------------------------------------------------------------------------
ALTER TABLE public.pedidos_compra_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pci_select_membro_ativo"
    ON public.pedidos_compra_itens FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

CREATE POLICY "pci_insert_membro_ativo"
    ON public.pedidos_compra_itens FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

-- UPDATE permitido para membros ativos; a trigger State Machine bloqueia
-- qualquer tentativa de editar itens quando a capa já está Aprovada ou superior.
CREATE POLICY "pci_update_membro_ativo"
    ON public.pedidos_compra_itens FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

-- DELETE: Somente em pedidos que ainda estão em Rascunho
CREATE POLICY "pci_delete_apenas_rascunho"
    ON public.pedidos_compra_itens FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.pedidos_compra pc
            JOIN public.usuarios u ON u.id::text = auth.uid()::text
            WHERE pc.id = pedidos_compra_itens.pedido_id
              AND pc.status = 'Rascunho'
              AND u.status = TRUE
        )
    );

-- ----------------------------------------------------------------------------
-- 4.3 — log_recebimentos (Append-Only — sem UPDATE nem DELETE)
-- ----------------------------------------------------------------------------
ALTER TABLE public.log_recebimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lr_select_membro_ativo"
    ON public.log_recebimentos FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

-- INSERT: recebedor_id deve ser o próprio usuário autenticado
CREATE POLICY "lr_insert_membro_ativo"
    ON public.log_recebimentos FOR INSERT
    TO authenticated
    WITH CHECK (
        recebedor_id = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.usuarios u
            WHERE u.id::text = auth.uid()::text
              AND u.status = TRUE
        )
    );

-- UPDATE: Bloqueado (append-only — não se corrige um recebimento, cancela-se o pedido)
CREATE POLICY "lr_update_bloqueado"
    ON public.log_recebimentos FOR UPDATE
    TO authenticated
    USING (FALSE);

-- DELETE: Bloqueado (auditoria de SLA imutável)
CREATE POLICY "lr_delete_bloqueado"
    ON public.log_recebimentos FOR DELETE
    TO authenticated
    USING (FALSE);

-- ============================================================================
-- ETAPA 5: TRIGGERS PL/pgSQL
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TRIGGER 1 — Recálculo automático de valor_total na capa
-- Dispara AFTER INSERT | UPDATE | DELETE em pedidos_compra_itens.
-- Utiliza a coluna GENERATED 'subtotal' de cada linha para somar o total.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_calcula_valor_total()
RETURNS TRIGGER AS $$
DECLARE
    v_pedido_id UUID;
BEGIN
    -- Determina o ID da capa independente do tipo de operação (DELETE usa OLD)
    v_pedido_id := COALESCE(NEW.pedido_id, OLD.pedido_id);

    UPDATE public.pedidos_compra
    SET valor_total = COALESCE((
        SELECT SUM(pci.subtotal)
        FROM public.pedidos_compra_itens pci
        WHERE pci.pedido_id = v_pedido_id
    ), 0.00)
    WHERE id = v_pedido_id;

    -- Retorna NULL em DELETE (row-level trigger)
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_calcula_valor_total ON public.pedidos_compra_itens;
CREATE TRIGGER trg_calcula_valor_total
    AFTER INSERT OR UPDATE OR DELETE ON public.pedidos_compra_itens
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_calcula_valor_total();

-- ----------------------------------------------------------------------------
-- TRIGGER 2 — State Machine: bloqueia edição de itens em pedidos travados
-- Dispara BEFORE UPDATE em pedidos_compra_itens.
-- Pedidos com status Aprovado, Parcialmente Recebido, Concluído ou Cancelado
-- têm seus itens protegidos contra qualquer UPDATE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_state_machine_itens()
RETURNS TRIGGER AS $$
DECLARE
    v_status_capa VARCHAR(50);
BEGIN
    SELECT status INTO v_status_capa
    FROM public.pedidos_compra
    WHERE id = NEW.pedido_id;

    IF v_status_capa IN ('Aprovado', 'Parcialmente Recebido', 'Concluído', 'Cancelado') THEN
        RAISE EXCEPTION
            'Erro 409: Pedido em status "%" — itens não podem ser editados. '
            'Somente pedidos em Rascunho ou Aguardando Aprovação permitem alteração de itens.',
            v_status_capa
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_state_machine_itens ON public.pedidos_compra_itens;
CREATE TRIGGER trg_state_machine_itens
    BEFORE UPDATE ON public.pedidos_compra_itens
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_state_machine_itens();

-- ----------------------------------------------------------------------------
-- TRIGGER 3 — RBAC: valida autorização ANTES de aprovar um pedido
-- Dispara BEFORE UPDATE OF status em pedidos_compra,
-- apenas quando a transição destino é 'Aprovado'.
--
-- Hierarquia de autorização:
--   1. Bypass Executivo (Master, Presidente, Vice-Presidente)
--   2. Permissão dinâmica 'aprovar_pedido_compra' via tabela permissoes
--      — verifica diretoria primária E diretorias secundárias (usuario_diretorias)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_verifica_aprovacao_compra()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id         TEXT;
    v_user_cargo      VARCHAR(100);
    v_user_diretoria  TEXT;
    v_has_permission  BOOLEAN := FALSE;
BEGIN
    -- Só executa na transição → 'Aprovado' (evita re-execução desnecessária)
    IF NEW.status <> 'Aprovado' OR OLD.status = 'Aprovado' THEN
        RETURN NEW;
    END IF;

    -- Recupera ID do usuário da sessão Supabase ou da variável de sessão
    BEGIN
        v_user_id := COALESCE(
            NULLIF(auth.uid()::text, ''),
            NULLIF(current_setting('app.current_user_id', true), '')
        );
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION
            'Acesso negado: Usuário de sessão não identificado para aprovação de pedidos de compra.'
        USING ERRCODE = '42501';
    END IF;

    -- Busca cargo e diretoria primária do usuário autenticado
    SELECT u.cargo, d.nome
    INTO v_user_cargo, v_user_diretoria
    FROM public.usuarios u
    LEFT JOIN public.diretorias d ON d.id = u.diretoria_id
    WHERE u.id::text = v_user_id
      AND u.status = TRUE;

    -- Regra 1 — Bypass Incondicional do Núcleo Executivo
    IF v_user_cargo IN ('Master', 'Presidente', 'Vice-Presidente')
       OR v_user_diretoria IN (
           'Presidência', 'Presidencia',
           'Vice-Presidência', 'Vice-Presidencia',
           'Tesouraria'
       )
    THEN
        v_has_permission := TRUE;
    ELSE
        -- Regra 2 — Consulta Relacional Dinâmica na Matriz de Permissões
        -- Verifica diretoria primária E todas as diretorias secundárias do usuário
        SELECT EXISTS (
            SELECT 1 FROM public.permissoes p
            WHERE p.concedida = TRUE
              AND p.acao_sistema = 'aprovar_pedido_compra'
              AND p.diretoria_id IN (
                  -- Diretoria primária do usuário
                  SELECT u.diretoria_id
                  FROM public.usuarios u
                  WHERE u.id::text = v_user_id
                    AND u.diretoria_id IS NOT NULL
                  UNION
                  -- Diretorias secundárias (acúmulo de cargos — Sprint 1 RBAC)
                  SELECT ud.diretoria_id
                  FROM public.usuario_diretorias ud
                  WHERE ud.usuario_id::text = v_user_id
              )
        ) INTO v_has_permission;
    END IF;

    -- Se sem permissão: registra tentativa e bloqueia
    IF NOT v_has_permission THEN
        -- Log de auditoria de tentativa de violação
        BEGIN
            INSERT INTO public.logs_notificacoes (
                usuario_id, tipo_notificacao, gatilho_regra,
                destinatario_email, status_entrega, erro_detalhe
            )
            VALUES (
                v_user_id,
                'Alerta de Segurança',
                'TENTATIVA_APROVACAO_COMPRA_SEM_PERMISSAO',
                COALESCE(
                    (SELECT email FROM public.usuarios WHERE id::text = v_user_id),
                    'presidencia@atleticalup.com.br'
                ),
                'ENVIADO',
                'Tentativa de aprovar pedido_compra ID=' || OLD.id::text
                || ' pelo usuário ' || v_user_id
                || ' sem a permissão [aprovar_pedido_compra].'
            );
        EXCEPTION WHEN OTHERS THEN
            -- Não deixa falha no log impedir o RAISE principal
            NULL;
        END;

        RAISE EXCEPTION
            'Erro 403: Usuário sem permissão para aprovar Pedidos de Compra. '
            'Requer a permissão [aprovar_pedido_compra] ou alçada do Núcleo Executivo '
            '(Tesouraria, Presidência ou superior).'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_verifica_aprovacao_compra ON public.pedidos_compra;
CREATE TRIGGER trg_verifica_aprovacao_compra
    BEFORE UPDATE OF status ON public.pedidos_compra
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_verifica_aprovacao_compra();

-- ----------------------------------------------------------------------------
-- TRIGGER 4 — Gera lançamento financeiro automático ao aprovar o pedido
-- Dispara AFTER UPDATE quando status transita para 'Aprovado'.
-- Insere Saída não conciliada em lancamentos_financeiros, conectando
-- Supply Chain → Tesouraria para conciliação posterior com a Nota Fiscal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_aprovar_gera_lancamento()
RETURNS TRIGGER AS $$
DECLARE
    v_fornecedor_nome VARCHAR(255);
BEGIN
    -- Só executa na transição exata → 'Aprovado' (idempotência)
    IF NEW.status <> 'Aprovado' OR OLD.status = 'Aprovado' THEN
        RETURN NEW;
    END IF;

    -- Busca nome do fornecedor para enriquecer a descrição do lançamento
    SELECT nome INTO v_fornecedor_nome
    FROM public.fornecedores
    WHERE id = NEW.fornecedor_id;

    -- Insere Saída projetada (orçada) — não conciliada
    -- A Tesouraria concilia ao receber a Nota Fiscal física do fornecedor
    INSERT INTO public.lancamentos_financeiros (
        tipo,
        categoria,
        valor,
        data_competencia,
        status_conciliacao,
        produto_id,
        evento_id
    )
    VALUES (
        'Saída',
        'Compra de Estoque — ' || COALESCE(v_fornecedor_nome, 'Fornecedor'),
        NEW.valor_total,
        NOW(),
        FALSE,   -- Não conciliado: aguarda NF e conferência pela Tesouraria
        NULL,    -- Não vinculado a produto específico (pedido pode ter vários)
        NULL     -- Não vinculado a evento
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_aprovar_gera_lancamento ON public.pedidos_compra;
CREATE TRIGGER trg_aprovar_gera_lancamento
    AFTER UPDATE OF status ON public.pedidos_compra
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_aprovar_gera_lancamento();

-- ----------------------------------------------------------------------------
-- TRIGGER 5 — Atualiza estoque, quantidade_recebida e status da capa
-- Dispara AFTER INSERT em log_recebimentos.
--
-- Sequência de operações:
--   1. Valida que a capa está em estado receptivo (Aprovado | Parcialmente Recebido)
--   2. Copia data_prevista_entrega da capa para data_prevista_original do log
--   3. Incrementa produto_variantes.estoque_atual (se variante_id informada)
--   4. Atualiza pedidos_compra_itens.quantidade_recebida
--   5. Verifica se todos os itens atingiram 100% recebido
--   6. Atualiza status da capa: 'Parcialmente Recebido' ou 'Concluído'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_recebimento_atualiza_estoque()
RETURNS TRIGGER AS $$
DECLARE
    v_item                RECORD;
    v_nova_qtd_recebida   INTEGER;
    v_todos_concluidos    BOOLEAN;
    v_novo_status_capa    VARCHAR(50);
BEGIN
    -- 1. Carrega dados completos do item e da capa em um único JOIN
    SELECT
        pci.id                    AS item_id,
        pci.pedido_id,
        pci.variante_id,
        pci.quantidade_solicitada,
        pci.quantidade_recebida,
        pc.status                 AS status_capa,
        pc.data_prevista_entrega  AS data_prevista_capa
    INTO v_item
    FROM public.pedidos_compra_itens pci
    JOIN public.pedidos_compra pc ON pc.id = pci.pedido_id
    WHERE pci.id = NEW.item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Erro 404: Item de pedido não encontrado para item_id=%', NEW.item_id;
    END IF;

    -- 2. Valida que a capa aceita recebimentos
    IF v_item.status_capa NOT IN ('Aprovado', 'Parcialmente Recebido') THEN
        RAISE EXCEPTION
            'Erro 409: Pedido em status "%" não pode receber baixas. '
            'O pedido deve estar "Aprovado" ou "Parcialmente Recebido".',
            v_item.status_capa
        USING ERRCODE = '23514';
    END IF;

    -- 3. Preenche data_prevista_original no registro do log (se não fornecida pelo front-end)
    IF NEW.data_prevista_original IS NULL AND v_item.data_prevista_capa IS NOT NULL THEN
        UPDATE public.log_recebimentos
        SET data_prevista_original = v_item.data_prevista_capa
        WHERE id = NEW.id;
    END IF;

    -- 4. Calcula nova quantidade recebida e valida limite
    v_nova_qtd_recebida := v_item.quantidade_recebida + NEW.quantidade_baixada;

    IF v_nova_qtd_recebida > v_item.quantidade_solicitada THEN
        RAISE EXCEPTION
            'Erro 422: Baixa de % unidades excede o saldo disponível de % unidades para este item.',
            NEW.quantidade_baixada,
            (v_item.quantidade_solicitada - v_item.quantidade_recebida)
        USING ERRCODE = '22003';
    END IF;

    -- 5. Atualiza quantidade_recebida no item
    UPDATE public.pedidos_compra_itens
    SET quantidade_recebida = v_nova_qtd_recebida
    WHERE id = NEW.item_id;

    -- 6. Incrementa estoque na variante do produto (se variante vinculada)
    IF v_item.variante_id IS NOT NULL THEN
        UPDATE public.produto_variantes
        SET estoque_atual = estoque_atual + NEW.quantidade_baixada
        WHERE id = v_item.variante_id;
    END IF;

    -- 7. Verifica se TODOS os itens da capa atingiram 100% recebido
    --    Usa BOOL_AND: retorna TRUE somente se todas as linhas satisfazem a condição
    SELECT BOOL_AND(pci.quantidade_recebida >= pci.quantidade_solicitada)
    INTO v_todos_concluidos
    FROM public.pedidos_compra_itens pci
    WHERE pci.pedido_id = v_item.pedido_id;

    v_novo_status_capa := CASE WHEN v_todos_concluidos THEN 'Concluído' ELSE 'Parcialmente Recebido' END;

    -- 8. Atualiza status da capa (guarda UPDATE se status não mudou)
    UPDATE public.pedidos_compra
    SET status = v_novo_status_capa
    WHERE id = v_item.pedido_id
      AND status <> v_novo_status_capa;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recebimento_atualiza_estoque ON public.log_recebimentos;
CREATE TRIGGER trg_recebimento_atualiza_estoque
    AFTER INSERT ON public.log_recebimentos
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_recebimento_atualiza_estoque();

-- ============================================================================
-- ETAPA 6: GRANTS PARA O ROLE AUTHENTICATED (Supabase)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE         ON TABLE public.pedidos_compra          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pedidos_compra_itens    TO authenticated;
GRANT SELECT, INSERT                 ON TABLE public.log_recebimentos         TO authenticated;

-- ============================================================================
-- ETAPA 7: VERIFICAÇÃO FINAL (DIAGNÓSTICO PÓS-EXECUÇÃO)
-- ============================================================================
-- Execute as queries abaixo separadamente após o COMMIT para validar:

-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--       'pedidos_compra', 'pedidos_compra_legado',
--       'pedidos_compra_itens', 'log_recebimentos'
--   )
-- ORDER BY table_name;
-- → Deve retornar as 4 tabelas

-- SELECT trigger_name, event_object_table, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--   AND trigger_name IN (
--       'trg_calcula_valor_total', 'trg_state_machine_itens',
--       'trg_verifica_aprovacao_compra', 'trg_aprovar_gera_lancamento',
--       'trg_recebimento_atualiza_estoque'
--   )
-- ORDER BY event_object_table, trigger_name;
-- → Deve retornar os 5 triggers

COMMIT;

-- ============================================================================
-- FIM DO SCRIPT — Sprint 4 / Fase 1: Banco de Dados
-- ============================================================================
