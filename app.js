    // ============================================================================
// PLATAFORMA SAAS DE GESTÃO ESTRATÉGICA - ATLÉTICA UNIVERSITÁRIA
// IN-MEMORY DATABASE & ENGINE SIMULATOR (app.js) - MVP v2.0
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // SUPABASE CONFIGURATION
    // ========================================================================
    const SUPABASE_URL = window.ENV.SUPABASE_URL;
    const SUPABASE_KEY = window.ENV.SUPABASE_KEY;
    
    // Inicializa o cliente do Supabase
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
    // Expõe o cliente instanciado globalmente para uso pelos módulos externos (chat.js, etc.)
    window.supabaseClient = supabase;
    // ------------------------------------------------------------------------
    // 1. ESTADO DO BANCO DE DADOS (IN-MEMORY DB)
    // ------------------------------------------------------------------------
    const DB = {
        usuarios: [], eventos: [], tarefas_logistica: [], modalidades: [],
        atletas: [], produtos: [], produto_variantes: [], calendario_editorial: [],
        cronograma_postagens: [], escalacoes: [], participantes_evento: [],
        lancamentos_financeiros: [], parceiros_patrocinadores: [], documentos_contratos: [],
        logs_notificacoes: [], fornecedores: [], pedidos_compra: [], coordenador_modalidades: [], permissoes: [], notificacoes_config: [], chat_conversations: [
            { id: 'conv-1', name: 'Geral LUP', type: 'Grupo', created_at: new Date().toISOString() }
        ],
        chat_participants: [], chat_messages: [], chat_attachments: []
    };

    window.DB = DB;
    
    // Usuário logado — preenchido após autenticação
    let currentUser = null;
    window.currentUser = currentUser;

    // Estado de seleção para marketing, esportes e financeiro (Fase 4)
    let selectedMarketingEventId = '';
    let selectedSportsEventId = '';
    let selectedSportsModalityId = '';
    let pendingRoster = []; // Lista de objetos { atletaId, funcao, observacao } na escalação pendente

    // Estado do calendário do dashboard (Fase 5)
    let calendarCurrentDate = new Date();
    let calendarSelectedDate = new Date();

    // ------------------------------------------------------------------------
    // FUNÇÃO GLOBAL DE NOTIFICAÇÕES (Gatilhos)
    // ------------------------------------------------------------------------
    window.getNotificationEmail = function(gatilho) {
        // Fallback de segurança primário (Master logado)
        let fallbackEmail = window.currentUser && window.isExecutiveAdmin(window.currentUser)
            ? window.currentUser.email 
            : 'presidencia@atleticalup.com.br';
            
        if (!window.DB || !window.DB.notificacoes_config) return fallbackEmail;
        
        const config = window.DB.notificacoes_config.find(n => n.gatilho === gatilho);
        return (config && config.email_destino) ? config.email_destino : fallbackEmail;
    };



    // ------------------------------------------------------------------------
    // 2. SISTEMA DE SIMULAÇÃO DE BANCO DE DADOS POSTGRESQL (TRIGGER ENGINE)
    // ------------------------------------------------------------------------
    
    function logSQL(message, type = 'success') {
        const timestamp = new Date().toLocaleTimeString();
        if (type === 'trigger') {
            console.log(`⚙️ [${timestamp}] [PL/pgSQL Trigger] ${message}`);
        } else if (type === 'error') {
            console.error(`❌ [${timestamp}] [DB ERROR] ${message}`);
        } else {
            console.log(`💾 [${timestamp}] [Query Success] ${message}`);
        }
    }

    // Mapeamento de erros técnicos → mensagens amigáveis para o usuário final
    const ERROR_FRIENDLY_MAP = [
        {
            match: ['42501', 'Permission Denied'],
            icon: 'fas fa-lock',
            title: 'Acesso não autorizado',
            msg: 'Você não tem permissão para realizar esta ação. Se precisar, entre em contato com a Presidência para solicitar o acesso.'
        },
        {
            match: ['Unique Violation', '23505'],
            icon: 'fas fa-clone',
            title: 'Registro duplicado',
            msg: 'Já existe um cadastro com esses dados no sistema. Por favor, verifique as informações e tente novamente.'
        },
        {
            match: ['Not Null', '23502'],
            icon: 'fas fa-exclamation-circle',
            title: 'Campos obrigatórios',
            msg: 'Preencha todos os campos obrigatórios antes de salvar.'
        },
        {
            match: ['chk_estoque', 'Estoque', 'CHECK Constraint'],
            icon: 'fas fa-box',
            title: 'Estoque insuficiente',
            msg: 'Não é possível realizar esta operação pois o estoque ficaria negativo. Verifique a quantidade disponível e tente novamente.'
        },
        {
            match: ['RN-LOG-01', 'Audit', 'Append-Only'],
            icon: 'fas fa-shield-alt',
            title: 'Registro protegido',
            msg: 'Este histórico de auditoria é protegido e não pode ser alterado ou excluído. Isso garante a integridade das informações da diretoria.'
        },
        {
            match: ['RN-FIN-01', 'Caixa', 'Imutável'],
            icon: 'fas fa-wallet',
            title: 'Lançamento bloqueado',
            msg: 'Este lançamento financeiro já foi conciliado e não pode ser modificado. Para correções, registre um novo lançamento de ajuste.'
        },
        {
            match: ['RN-EV-01', 'Aprovação', 'Fluxo'],
            icon: 'fas fa-calendar-times',
            title: 'Aprovação não permitida',
            msg: 'Apenas a Tesouraria ou a Presidência pode aprovar o orçamento deste evento. Solicite a aprovação ao responsável.'
        },
        {
            match: ['Calendário', 'Editorial'],
            icon: 'fas fa-calendar-exclamation',
            title: 'Conflito de datas',
            msg: 'Já existe outro evento agendado neste período. Escolha uma data diferente e tente novamente.'
        },
        {
            match: ['RN-JUR-01', 'Parceria', 'Validação'],
            icon: 'fas fa-file-contract',
            title: 'Documento inválido',
            msg: 'Esta parceria não pode ser ativada sem um contrato anexado e aprovado. Faça o upload do documento e tente novamente.'
        },
        {
            match: ['RN-ESP-01', 'Elegibilidade'],
            icon: 'fas fa-user-times',
            title: 'Atleta inelegível',
            msg: 'Este atleta não atende aos requisitos para participar da modalidade selecionada. Verifique as condições de elegibilidade.'
        },
        {
            match: ['trg_receber_pedido', 'Recebido'],
            icon: 'fas fa-box-check',
            title: 'Pedido já recebido',
            msg: 'Este pedido de compra já foi marcado como recebido e não pode ser processado novamente.'
        },
    ];

    function showDBErrorDialog(errCode, constraintName, description) {
        // Registra o erro técnico silenciosamente no console (apenas para devs)
        console.debug(`[DB_ENGINE] ${errCode} | ${constraintName} | ${description}`);

        // Encontra a mensagem amigável correspondente
        const combined = `${errCode} ${constraintName} ${description}`;
        let friendly = ERROR_FRIENDLY_MAP.find(rule =>
            rule.match.some(keyword => combined.includes(keyword))
        );

        // Fallback genérico se nenhuma regra bater
        if (!friendly) {
            friendly = {
                icon: 'fas fa-exclamation-circle',
                title: 'Não foi possível concluir',
                msg: 'Esta ação não pôde ser realizada. Verifique as informações e tente novamente. Caso o problema persista, entre em contato com o suporte.'
            };
        }

        // Atualiza o modal com conteúdo amigável
        const iconEl = document.getElementById('error-modal-icon');
        const titleEl = document.getElementById('error-title');
        const msgEl = document.getElementById('error-message');
        if (iconEl) iconEl.className = friendly.icon;
        if (titleEl) titleEl.textContent = friendly.title;
        if (msgEl) msgEl.textContent = friendly.msg;

        document.getElementById('error-overlay').classList.add('active');
    }

    // Central de Interceptação de Escrita (Falso SGBD Engine)
    const DB_Engine = {
        // Simula UPDATE em Eventos (RN-EV-01 & RN-EV-02)
        updateEventStatus: async function(eventId, newStatus) {
            const event = DB.eventos.find(e => e.id === eventId);
            if (!event) return false;

            const oldStatus = event.status_aprovacao;
            if (oldStatus === newStatus) return true;

            logSQL(`UPDATE eventos SET status_aprovacao = '${newStatus}' WHERE id = '${eventId}';`, 'query');

            // --- TRIGGER: fn_trg_verificar_aprovacao_evento (RN-EV-01) ---
            logSQL(`Evaluating trg_verificar_aprovacao_evento BEFORE UPDATE...`, 'trigger');
            if (newStatus === 'Aprovado' && oldStatus === 'Aguardando Tesouraria') {
                const user = currentUser;
                // Apenas diretoria == 'Tesouraria' ou cargo == 'Presidência' ou 'Vice-Presidência' ou Master
                const isAuthorized = user.diretoria === 'Tesouraria' || window.isExecutiveAdmin(user);
                
                if (!isAuthorized) {
                    // Simula escrita autônoma na tabela de logs (append-only bypass na transação)
                    const logId = 'log_auton_' + Date.now();
                    const logEntry = {
                        id: logId,
                        usuario_id: user.id,
                        tipo_notificacao: 'Alerta de Segurança',
                        gatilho_regra: 'TENTATIVA_VIOLACAO',
                        destinatario_email: 'presidencia@atleticalup.com.br',
                        status_entrega: 'ENVIADO',
                        data_envio: new Date().toISOString().replace('T', ' ').substring(0, 16),
                        erro_detalhe: `Tentativa de aprovação de evento '${event.nome}' por usuário não autorizado: ${user.nome} (${user.cargo} - ${user.diretoria})`,
                        lida: false
                    };
                    DB.logs_notificacoes.push(logEntry);
                    logSQL(`Inserted security violation log autonomously (ID: ${logId})`, 'trigger');
                    
                    const msg = `Erro 403 (Permissão Negada): O usuário ${user.nome} (${user.cargo}/${user.diretoria}) não possui credenciais suficientes da Tesouraria para aprovar orçamentos.`;
                    logSQL(msg, 'error');
                    showDBErrorDialog('42501 (Permission Denied)', 'RN-EV-01 (Fluxo de Aprovação)', msg);
                    refreshAllUI();
                    return false;
                }
            }

            // Realiza a alteração do evento (Commit Parcial)
            const { data: updatedEvent, error: updateError } = await supabase
                .from('eventos')
                .update({ status_aprovacao: newStatus })
                .eq('id', eventId)
                .select()
                .single();

            if (updateError) {
                console.error('[Eventos] Erro ao atualizar status:', updateError);
                logSQL(`Erro ao atualizar status do evento: ${updateError.message}`, 'error');
                alert(`Não foi possível atualizar o status do evento: ${updateError.message}`);
                return false;
            }

            Object.assign(event, updatedEvent);
            logSQL(`Event status committed: '${oldStatus}' -> '${newStatus}'`, 'success');

            // --- TRIGGER NOTIFICAÇÃO: Solicitação de Verba (SOLICITACAO_VERBA) ---
            if (newStatus === 'Aguardando Tesouraria') {
                const alertEmail = window.getNotificationEmail('SOLICITACAO_VERBA');
                supabase.from('logs_notificacoes').insert([{
                    usuario_id: currentUser ? currentUser.id : 'u1',
                    tipo_notificacao: 'Email',
                    gatilho_regra: 'SOLICITACAO_VERBA',
                    destinatario_email: alertEmail,
                    status_entrega: 'ENVIADO',
                    data_envio: new Date().toISOString().replace('T', ' ').substring(0, 16),
                    lida: false
                }]).then();
                logSQL(`INSERT INTO logs_notificacoes (usuario_id, tipo_notificacao, gatilho_regra, destinatario_email, status_entrega) VALUES ('${currentUser ? currentUser.id : 'u1'}', 'Email', 'SOLICITACAO_VERBA', '${alertEmail}', 'ENVIADO');`, 'query');
                logSQL(`Notificação de SOLICITACAO_VERBA disparada automaticamente para Tesouraria sobre o evento '${event.nome}'.`, 'success');
            }

            // --- TRIGGER: fn_trg_gerar_lancamento_evento_aprovado (RN-EV-02) ---
            if (newStatus === 'Aprovado' && oldStatus !== 'Aprovado') {
                logSQL(`Evaluating trg_gerar_lancamento_evento_aprovado AFTER UPDATE...`, 'trigger');
                
                // Criação automática do lançamento financeiro (Débito/Saída) — persistido de verdade no Supabase
                const financeEntry = {
                    id: crypto.randomUUID(),
                    tipo: 'Saída',
                    categoria: 'Logística Evento',
                    valor: event.orcamento_previsto,
                    data_competencia: new Date().toISOString().split('T')[0],
                    status_conciliacao: false,
                    evento_id: event.id,
                    produto_id: null
                };
                supabase.from('lancamentos_financeiros').insert([financeEntry]).then(({ error }) => {
                    if (error) { console.error('[Lançamentos] Erro ao gerar lançamento de evento aprovado:', error); return; }
                });
                DB.lancamentos_financeiros.push(financeEntry);
                logSQL(`Trigger RN-EV-02: Lançamento financeiro de Saída criado automaticamente para '${event.name}' (Valor: R$ ${event.orcamento_previsto.toFixed(2)})`, 'trigger');
            }

            refreshAllUI();
            return true;
        },

        // Simula INSERT no Calendário Editorial (Marketing - RN-EV-01)
        insertCalendarioEditorial: function(eventoId, plataforma, data, descricao) {
            logSQL(`INSERT INTO calendario_editorial (evento_id, plataforma, data, descricao) VALUES (...);`, 'query');
            logSQL(`Evaluating trg_verificar_calendario_evento BEFORE INSERT...`, 'trigger');

            const event = DB.eventos.find(e => e.id === eventoId);
            if (!event) {
                logSQL('Evento não encontrado', 'error');
                return false;
            }

            // RN-EV-01: Não permite campanhas de marketing para eventos não aprovados
            if (event.status_aprovacao !== 'Aprovado') {
                const msg = `Regra RN-EV-01: Não é permitido criar agendamentos no Calendário Editorial para eventos no estado '${event.status_aprovacao}'. O evento deve estar 'Aprovado' pela Tesouraria.`;
                logSQL(msg, 'error');
                showDBErrorDialog('45000 (Trigger Violation)', 'RN-EV-01 (Calendário Editorial)', msg);
                return false;
            }

            const newId = 'ce_' + Date.now();
            DB.calendario_editorial.push({
                id: newId,
                evento_id: eventoId,
                plataforma: plataforma,
                data_publicacao: data,
                descricao: descricao,
                responsavel_id: currentUser.id
            });

            logSQL(`Calendário Editorial inserido com sucesso (ID: ${newId})`, 'success');
            refreshAllUI();
            return true;
        },

        // Simula UPDATE/DELETE nos Lançamentos Financeiros (Caixa - RN-FIN-01)
        mutateFinanceRecord: function(id, action, updatedFields = null) {
            const index = DB.lancamentos_financeiros.findIndex(lf => lf.id === id);
            if (index === -1) return false;

            const record = DB.lancamentos_financeiros[index];
            logSQL(`${action.toUpperCase()} ON lancamentos_financeiros WHERE id = '${id}';`, 'query');
            logSQL(`Evaluating trg_proteger_lancamento_conciliado BEFORE ${action.toUpperCase()}...`, 'trigger');

            // RN-FIN-01: Lançamentos já conciliados são IMUTÁVEIS
            if (record.status_conciliacao === true) {
                let isViolated = false;
                if (action === 'delete') {
                    isViolated = true;
                } else if (action === 'update' && updatedFields) {
                    // Verifica se alterou campos protegidos
                    if (updatedFields.valor !== record.valor || updatedFields.tipo !== record.tipo || updatedFields.data_competencia !== record.data_competencia) {
                        isViolated = true;
                    }
                }

                if (isViolated) {
                    const msg = `Regra RN-FIN-01 (Imutabilidade de Caixa): Lançamentos financeiros com conciliação realizada não podem ser alterados ou deletados. Para fazer correções, utilize a ferramenta de Lançamento de Estorno.`;
                    logSQL(msg, 'error');
                    showDBErrorDialog('45000 (Integrity Constraint)', 'RN-FIN-01 (Caixa Imutável)', msg);
                    return false;
                }
            }

            if (action === 'delete') {
                DB.lancamentos_financeiros.splice(index, 1);
                logSQL(`Lançamento excluído com sucesso (ID: ${id})`, 'success');
            } else if (action === 'update' && updatedFields) {
                Object.assign(record, updatedFields);
                logSQL(`Lançamento atualizado com sucesso (ID: ${id})`, 'success');
            }

            refreshAllUI();
            return true;
        },

        // Simula UPDATE de Estoque de Produtos / Vendas (RN-PROD-01)
        mutateProductStock: function(variantId, quantityDelta) {
            const variant = DB.produto_variantes.find(pv => pv.id === variantId);
            if (!variant) return false;

            const oldStock = variant.estoque_atual;
            const newStock = oldStock + quantityDelta;

            logSQL(`UPDATE produto_variantes SET estoque_atual = ${newStock} WHERE id = '${variantId}';`, 'query');
            logSQL(`Evaluating CHECK chk_estoque_positivo (estoque_atual >= 0)...`, 'trigger');

            // RN-PROD-01: Estoque Blindado chk_estoque_positivo
            if (newStock < 0) {
                const msg = `Regra RN-PROD-01 (Estoque Blindado): A operação causaria violação de estoque negativo na variante de tamanho '${variant.tamanho}'. Estoque atual: ${oldStock}, Requisitado: ${Math.abs(quantityDelta)}.`;
                logSQL(msg, 'error');
                showDBErrorDialog('23514 (CHECK Constraint Violation)', 'chk_estoque_positivo (Estoque >= 0)', msg);
                return false;
            }

            variant.estoque_atual = newStock;
            logSQL(`Estoque de variante atualizado: ${oldStock} -> ${newStock}`, 'success');
            refreshAllUI();
            return true;
        },

        // Simula UPDATE em Atletas (RN-ESP-01)
        updateAthleteDocStatus: async function(athleteId, newStatus) {
            const athlete = DB.atletas.find(a => a.id === athleteId);
            if (!athlete) return false;

            const oldStatus = athlete.status_documentacao;
            if (oldStatus === newStatus) return true;

            logSQL(`UPDATE atletas SET status_documentacao = '${newStatus}' WHERE id = '${athleteId}';`, 'query');
            logSQL(`Evaluating trg_proteger_documentacao_atleta BEFORE UPDATE...`, 'trigger');

            // RN-ESP-01: Apenas diretoria == 'Jurídico', Master ou Presidência pode alterar documentação
            const user = currentUser;
            const isAuthorized = user.diretoria === 'Jurídico' || window.isExecutiveAdmin(user);

            if (!isAuthorized) {
                const msg = `Erro 403 (Permissão Negada): O usuário ${user.nome} (${user.cargo}/${user.diretoria}) tentou alterar a documentação de um atleta, mas esta ação é restrita exclusivamente ao departamento JURÍDICO da Atlética.`;
                logSQL(msg, 'error');
                showDBErrorDialog('42501 (Permission Denied)', 'RN-ESP-01 (Elegibilidade Esportiva)', msg);
                return false;
            }

            const { data, error } = await supabase
                .from('atletas')
                .update({ status_documentacao: newStatus })
                .eq('id', athleteId)
                .select()
                .single();

            if (error) {
                console.error('[Atletas] Erro ao atualizar status documental:', error);
                logSQL(`Erro ao atualizar status documental: ${error.message}`, 'error');
                alert(`Não foi possível atualizar a documentação do atleta: ${error.message}`);
                return false;
            }

            Object.assign(athlete, data);
            logSQL(`Athlete document status updated: '${oldStatus}' -> '${newStatus}'`, 'success');

            // --- TRIGGER NOTIFICAÇÃO: Atleta Irregular (ATLETA_BARRADO) ---
            if (newStatus === 'Rejeitado') {
                const alertEmail = window.getNotificationEmail('ATLETA_BARRADO');
                supabase.from('logs_notificacoes').insert([{
                    usuario_id: currentUser ? currentUser.id : 'u1',
                    tipo_notificacao: 'Email',
                    gatilho_regra: 'ATLETA_BARRADO',
                    destinatario_email: alertEmail,
                    status_entrega: 'ENVIADO',
                    data_envio: new Date().toISOString().replace('T', ' ').substring(0, 16),
                    lida: false
                }]).then();
                logSQL(`INSERT INTO logs_notificacoes (usuario_id, tipo_notificacao, gatilho_regra, destinatario_email, status_entrega) VALUES ('${currentUser ? currentUser.id : 'u1'}', 'Email', 'ATLETA_BARRADO', '${alertEmail}', 'ENVIADO');`, 'query');
                logSQL(`Notificação de ATLETA_BARRADO disparada para Esportes e Coordenador sobre atleta '${athlete.nome}'.`, 'success');
            }

            refreshAllUI();
            return true;
        },

        // Simula UPDATE em Parcerias CRM (RN-JUR-01)
        updatePartnerStatus: function(partnerId, newStatus) {
            const partner = DB.parceiros_patrocinadores.find(p => p.id === partnerId);
            if (!partner) return false;

            const oldStatus = partner.status_funil;
            if (oldStatus === newStatus) return true;

            logSQL(`UPDATE parceiros_patrocinadores SET status_funil = '${newStatus}' WHERE id = '${partnerId}';`, 'query');
            logSQL(`Evaluating trg_validar_parceria_ativa BEFORE UPDATE...`, 'trigger');

            // RN-JUR-01: Não permite ativar parceria se não houver arquivo contrato de link preenchido no GED
            if (newStatus === 'Contrato Ativo') {
                const contracts = DB.documentos_contratos.filter(dc => dc.parceiro_id === partnerId && dc.arquivo_url && dc.arquivo_url.trim() !== '');
                
                if (contracts.length === 0) {
                    const msg = `Regra RN-JUR-01: Não é permitido mover o parceiro comercial '${partner.nome_empresa}' para o estágio 'Contrato Ativo' sem antes anexar um contrato com link ativo (GED Drive) para arquivamento no repositório.`;
                    logSQL(msg, 'error');
                    showDBErrorDialog('45000 (Trigger Exception)', 'RN-JUR-01 (Validação de Parceria)', msg);
                    return false;
                }
            }

            partner.status_funil = newStatus;
            logSQL(`Partner status updated in CRM: '${oldStatus}' -> '${newStatus}'`, 'success');
            refreshAllUI();
            return true;
        },

        // Simula UPDATE/DELETE nos Logs de Auditoria (RN-LOG-01)
        mutateAuditLog: function(id, action) {
            logSQL(`${action.toUpperCase()} ON logs_notificacoes WHERE id = '${id}';`, 'query');
            logSQL(`Evaluating trg_bloquear_modificacao_logs BEFORE ${action.toUpperCase()}...`, 'trigger');

            // RN-LOG-01: Tabela é rigorosamente APPEND-ONLY
            const msg = `Regra RN-LOG-01 (Auditoria Absoluta): A tabela 'logs_notificacoes' possui segurança nível banco. Operações de UPDATE ou DELETE são proibidas para garantir auditoria inviolável à diretoria.`;
            logSQL(msg, 'error');
            showDBErrorDialog('45000 (Trigger Audit Rejection)', 'RN-LOG-01 (Auditoria Append-Only)', msg);
            return false;
        },

        // INSERT real em Fornecedores (Supabase) — corrigido: antes só simulava em memória
        // (id fake 'f_<timestamp>' que nunca existia na tabela real, causando violação de
        // foreign key ao criar Pedidos de Compra com esse fornecedor).
        insertFornecedor: async function(nome, contato, telefone, email, tipo_produto, categoria_servico, obs) {
            if (!nome || !tipo_produto || !categoria_servico) {
                showDBErrorDialog('23502 (Not Null Violation)', 'fornecedores.nome', 'Nome, tipo de produto e categoria são campos obrigatórios.');
                return false;
            }

            logSQL(`INSERT INTO fornecedores (nome, contato, telefone, email, tipo_produto, categoria_servico, obs) VALUES (...);`, 'query');

            const { data, error } = await supabase
                .from('fornecedores')
                .insert([{ nome, contato, telefone, email, tipo_produto, categoria_servico, obs }])
                .select()
                .single();

            if (error) {
                console.error('[Fornecedores] Erro ao cadastrar:', error);
                logSQL(`Erro ao cadastrar fornecedor: ${error.message}`, 'error');
                showDBErrorDialog(error.code || 'ERROR', 'fornecedores', error.message);
                return false;
            }

            DB.fornecedores.push(data);
            logSQL(`Fornecedor '${nome}' cadastrado com sucesso (ID: ${data.id}).`, 'success');
            refreshAllUI();
            return data.id;
        },

        // Simula INSERT em Pedidos de Compra
        insertPedidoCompra: function(fornecedor_id, produto_id, tamanho, quantidade, data_previsao) {
            logSQL(`INSERT INTO pedidos_compra (fornecedor_id, produto_id, tamanho, quantidade, data_previsao, status) VALUES (..., 'Pendente');`, 'query');
            if (!fornecedor_id || !produto_id || !tamanho || quantidade <= 0) {
                alert('Preencha todos os campos do pedido de compra corretamente!');
                return false;
            }
            const newId = 'pc_' + Date.now();
            DB.pedidos_compra.push({ id: newId, fornecedor_id, produto_id, tamanho, quantidade, data_previsao: data_previsao || null, status: 'Pendente' });
            logSQL(`Pedido de Compra registrado com sucesso (ID: ${newId}).`, 'success');
            refreshAllUI();
            return newId;
        },

        // Simula trigger trg_receber_pedido_compra: atualiza estoque ao marcar como Recebido
        receberPedidoCompra: function(pedidoId) {
            const pedido = DB.pedidos_compra.find(pc => pc.id === pedidoId);
            if (!pedido) return false;

            if (pedido.status === 'Recebido') {
                showDBErrorDialog('45000 (Trigger Exception)', 'trg_receber_pedido_compra', `Pedido '${pedidoId}' já foi marcado como Recebido e não pode ser processado novamente.`);
                return false;
            }

            logSQL(`UPDATE pedidos_compra SET status = 'Recebido' WHERE id = '${pedidoId}';`, 'query');
            logSQL(`Evaluating trg_receber_pedido_compra AFTER UPDATE...`, 'trigger');

            // Localiza a variante de estoque correspondente ao produto + tamanho do pedido
            const variant = DB.produto_variantes.find(pv => pv.produto_id === pedido.produto_id && pv.tamanho === pedido.tamanho);

            if (variant) {
                const oldStock = variant.estoque_atual;
                variant.estoque_atual += pedido.quantidade;
                logSQL(`Trigger trg_receber_pedido_compra: Estoque da variante '${pedido.tamanho}' do produto atualizado automaticamente: ${oldStock} → ${variant.estoque_atual} (+${pedido.quantidade}).`, 'trigger');
            } else {
                // Cria nova variante se não existir
                const newVarId = 'pv_' + Date.now();
                DB.produto_variantes.push({ id: newVarId, produto_id: pedido.produto_id, tamanho: pedido.tamanho, estoque_atual: pedido.quantidade });
                logSQL(`Trigger trg_receber_pedido_compra: Nova variante '${pedido.tamanho}' criada e estoque inicializado em ${pedido.quantidade} unidades.`, 'trigger');
            }

            pedido.status = 'Recebido';
            logSQL(`Pedido '${pedidoId}' marcado como Recebido. Estoque atualizado com sucesso.`, 'success');
            refreshAllUI();
            return true;
        },

        // INSERT de Usuário / UPDATE de Usuário
        saveUsuario: function(data) {
            const { id, nome, email, password, cargo, diretoria, status } = data;
            
            // Mapeamento transitório: busca o ID correspondente ao nome para salvar no banco
            const dirObj = DB.diretorias.find(d => d.nome === diretoria);
            const diretoria_id = dirObj ? dirObj.id : null;

            if (id) {
                // ── EDITAR usuário existente ──────────────────────────────
                const user = DB.usuarios.find(u => u.id === id);
                if (!user) { alert('Usuário não encontrado!'); return false; }

                logSQL(`UPDATE usuarios SET nome='${nome}', cargo='${cargo}', diretoria='${diretoria}', status=${status} WHERE id='${id}';`, 'query');
                user.nome = nome; user.email = email;
                user.cargo = cargo; user.diretoria = diretoria; user.status = status;
                if (password) { user.senha = password; }
                logSQL(`Usuário '${nome}' atualizado com sucesso (ID: ${id}).`, 'success');

                // Sincroniza edição com Supabase
                supabase.from('usuarios').update({
                    nome, email, cargo, diretoria, diretoria_id, status
                }).eq('id', id).then(({ error }) => {
                    if (error) console.error('Erro ao atualizar usuário no Supabase:', error);
                });

                refreshAllUI();
                return true;

            } else {
                // ── CRIAR novo usuário ────────────────────────────────────
                const emailExists = DB.usuarios.find(u => u.email === email);
                if (emailExists) {
                    showDBErrorDialog('23505 (Unique Violation)', 'usuarios.email', `O e-mail '${email}' já está em uso por outro membro da diretoria.`);
                    return false;
                }
                if (!password) {
                    alert('É obrigatório definir uma senha para novos usuários!');
                    return false;
                }

                // 1. Insere no banco local imediatamente (com ID temporário)
                const tempId = 'u_' + Date.now();
                const localRecord = { id: tempId, nome, email, cargo, diretoria, diretoria_id, status: true, senha: password, avatar: null };
                DB.usuarios.push(localRecord);
                logSQL(`INSERT INTO usuarios (nome, email, cargo, diretoria, diretoria_id) VALUES ('${nome}', '${email}', '${cargo}', '${diretoria}', '${diretoria_id}');`, 'query');

                // Atualiza a UI imediatamente
                refreshAllUI();
                const rbacSelect = document.getElementById('user-rbac-select');
                if (rbacSelect) {
                    const opt = document.createElement('option');
                    opt.value = tempId;
                    opt.innerText = `${nome} (${cargo} / ${diretoria})`;
                    rbacSelect.appendChild(opt);
                }

                // 2. Cria no Supabase Auth (background) → depois grava na tabela
                const tempSB = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                    auth: { persistSession: false, autoRefreshToken: false }
                });
                tempSB.auth.signUp({ email, password }).then(({ data: authData, error: authError }) => {
                    if (authError) {
                        console.error('Erro no Supabase Auth.signUp:', authError);
                        return;
                    }
                    const realUID = authData?.user?.id || tempId;
                    const createdUser = { id: realUID, nome, email, cargo, diretoria, diretoria_id };
                    
                    // Atualiza ID local para o UUID real
                    const localUser = DB.usuarios.find(u => u.email === email);
                    if (localUser) localUser.id = realUID;

                    // Grava na tabela usuarios com o UUID real
                    supabase.from('usuarios').upsert(createdUser).then(({ error: dbError }) => {
                        if (dbError) console.error('Erro ao gravar usuário na tabela:', dbError);
                        else {
                            logSQL(`Usuário '${nome}' sincronizado no Supabase (UUID: ${realUID}).`, 'success');
                            
                            // Notifica a presidência
                            const alertEmail = window.getNotificationEmail('NOVO_USUARIO');
                            supabase.from('logs_notificacoes').insert([{
                                usuario_id: realUID,
                                tipo_notificacao: 'Email',
                                gatilho_regra: 'NOVO_USUARIO',
                                destinatario_email: alertEmail,
                                status_entrega: 'ENVIADO',
                                data_envio: new Date().toISOString().replace('T', ' ').substring(0, 16),
                                lida: false
                            }]).then(() => {
                                logSQL(`INSERT INTO logs_notificacoes (usuario_id, tipo_notificacao, gatilho_regra, destinatario_email) VALUES ('${realUID}', 'Email', 'NOVO_USUARIO', '${alertEmail}');`, 'query');
                            });
                        }
                    });
                });

                alert(`✅ Usuário ${nome} criado com sucesso!\n\nEle já aparece na tabela abaixo.\n\nAguarde 1 minuto para realizar o login com este novo acesso.`);
                return true;
            }
        },

        // --- MÉTODOS DE MARKETING (Fase 4) ---
        insertCronogramaPostagem: async function(eventoId, plataforma, tipo_conteudo, data_publicacao, descricao) {
            logSQL(`INSERT INTO cronograma_postagens (evento_id, plataforma, tipo_conteudo, data_publicacao, descricao, status) VALUES ('${eventoId}', '${plataforma}', '${tipo_conteudo}', '${data_publicacao}', '${descricao}', 'Agendado');`, 'query');
            const { data, error } = await supabase.from('cronograma_postagens').insert([{
                evento_id: eventoId,
                plataforma,
                tipo_conteudo,
                data_publicacao,
                descricao,
                status: 'Agendado'
            }]).select().single();
            if (error) {
                console.error('[Marketing] Erro ao agendar postagem:', error);
                alert(`Não foi possível agendar a postagem: ${error.message}`);
                return false;
            }
            DB.cronograma_postagens.push(data);
            logSQL(`Postagem agendada com sucesso (ID: ${data.id}).`, 'success');
            refreshAllUI();
            return data.id;
        },
        updateCronogramaPostagemStatus: async function(postId, status) {
            const post = DB.cronograma_postagens.find(p => p.id === postId);
            if (!post) return false;
            logSQL(`UPDATE cronograma_postagens SET status = '${status}' WHERE id = '${postId}';`, 'query');
            const { data, error } = await supabase.from('cronograma_postagens')
                .update({ status }).eq('id', postId).select().single();
            if (error) {
                console.error('[Marketing] Erro ao atualizar postagem:', error);
                alert(`Não foi possível atualizar a postagem: ${error.message}`);
                return false;
            }
            Object.assign(post, data);
            logSQL(`Status da postagem '${postId}' atualizado para '${status}'.`, 'success');
            refreshAllUI();
            return true;
        },
        deleteCronogramaPostagem: async function(postId) {
            const idx = DB.cronograma_postagens.findIndex(p => p.id === postId);
            if (idx === -1) return false;
            logSQL(`DELETE FROM cronograma_postagens WHERE id = '${postId}';`, 'query');
            const { error } = await supabase.from('cronograma_postagens').delete().eq('id', postId);
            if (error) {
                console.error('[Marketing] Erro ao excluir postagem:', error);
                alert(`Não foi possível excluir a postagem: ${error.message}`);
                return false;
            }
            DB.cronograma_postagens.splice(idx, 1);
            logSQL(`Postagem '${postId}' removida com sucesso.`, 'success');
            refreshAllUI();
            return true;
        },

        // --- MÉTODOS DE ESPORTES (Fase 4) ---
        insertModalidade: function(nome, coordenadorId) {
            logSQL(`INSERT INTO modalidades (nome, coordenador_id) VALUES ('${nome}', '${coordenadorId}');`, 'query');
            if (!nome) {
                alert('Nome da modalidade é obrigatório!');
                return false;
            }
            const newId = 'm_' + Date.now();
            DB.modalidades.push({ id: newId, nome: nome, coordenador_id: coordenadorId || null });
            logSQL(`Modalidade '${nome}' cadastrada com sucesso (ID: ${newId}).`, 'success');
            refreshAllUI();
            return newId;
        },
        deleteModalidade: function(modId) {
            const idx = DB.modalidades.findIndex(m => m.id === modId);
            if (idx === -1) return false;
            const mod = DB.modalidades[idx];
            logSQL(`DELETE FROM modalidades WHERE id = '${modId}';`, 'query');
            // Remove atletas associados
            DB.atletas = DB.atletas.filter(a => a.modalidade_id !== modId);
            DB.modalidades.splice(idx, 1);
            logSQL(`Modalidade '${mod.nome}' e seus atletas associados foram excluídos com sucesso.`, 'success');
            refreshAllUI();
            return true;
        },
        deleteAtleta: function(atletaId) {
            const idx = DB.atletas.findIndex(a => a.id === atletaId);
            if (idx === -1) return false;
            const athlete = DB.atletas[idx];
            logSQL(`DELETE FROM atletas WHERE id = '${atletaId}';`, 'query');
            DB.atletas.splice(idx, 1);
            logSQL(`Atleta '${athlete.nome}' excluído com sucesso.`, 'success');
            refreshAllUI();
            return true;
        },
        saveEscalacao: function(eventoId, modalidadeId, athleteRoles) {
            logSQL(`DELETE FROM escalacoes WHERE evento_id = '${eventoId}' AND modalidade_id = '${modalidadeId}';`, 'query');
            logSQL(`INSERT INTO escalacoes (evento_id, modalidade_id, atleta_id, funcao, observacao) VALUES (...);`, 'query');
            
            // Delete previous roster for this event & modality
            DB.escalacoes = DB.escalacoes.filter(esc => !(esc.evento_id === eventoId && esc.modalidade_id === modalidadeId));
            
            // Insert new roster
            athleteRoles.forEach(ar => {
                const newId = 'esc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                DB.escalacoes.push({
                    id: newId,
                    evento_id: eventoId,
                    modalidade_id: modalidadeId,
                    atleta_id: ar.atleta_id,
                    funcao: ar.funcao || 'Titular',
                    observacao: ar.observacao || ''
                });
            });
            
            logSQL(`Escalação com ${athleteRoles.length} atletas salva com sucesso para o evento '${eventoId}' na modalidade '${modalidadeId}'.`, 'success');
            refreshAllUI();
            return true;
        },

        // --- MÉTODOS FINANCEIRO/PARTICIPANTES (Fase 4) ---
        insertParticipanteEvento: function(eventoId, nome, ra, valorCobrado, statusPagamento, formaPagamento, obs) {
            logSQL(`INSERT INTO participantes_evento (evento_id, nome, ra_matricula, valor_cobrado, status_pagamento, forma_pagamento, obs) VALUES (...);`, 'query');
            if (!nome) {
                alert('Nome do participante é obrigatório!');
                return false;
            }
            
            const newId = 'pe_' + Date.now();
            DB.participantes_evento.push({
                id: newId,
                evento_id: eventoId,
                nome: nome,
                ra_matricula: ra || '',
                valor_cobrado: parseFloat(valorCobrado) || 0.00,
                status_pagamento: statusPagamento || 'Pendente',
                forma_pagamento: formaPagamento || 'Pix',
                data_pagamento: statusPagamento === 'Pago' ? new Date().toISOString().split('T')[0] : null,
                obs: obs || ''
            });
            logSQL(`Participante '${nome}' cadastrado para o evento com taxa de R$ ${parseFloat(valorCobrado).toFixed(2)}.`, 'success');
            
            if (statusPagamento === 'Pago') {
                const event = DB.eventos.find(e => e.id === eventoId);
                const financeEntry = {
                    id: crypto.randomUUID(),
                    tipo: 'Entrada',
                    categoria: `Ingresso: ${event ? event.nome : 'Evento'}`,
                    valor: parseFloat(valorCobrado),
                    data_competencia: new Date().toISOString().split('T')[0],
                    status_conciliacao: false,
                    evento_id: eventoId,
                    produto_id: null
                };
                supabase.from('lancamentos_financeiros').insert([financeEntry]).then(({ error }) => {
                    if (error) console.error('[Lançamentos] Erro ao gerar lançamento de ingresso:', error);
                });
                DB.lancamentos_financeiros.push(financeEntry);
                logSQL(`Trigger Automático: Lançamento de Entrada de R$ ${parseFloat(valorCobrado).toFixed(2)} criado no caixa referente ao ingresso de ${nome}.`, 'trigger');
            }
            
            refreshAllUI();
            return newId;
        },
        updateParticipanteEventoValor: function(partId, novoValor, obs) {
            const part = DB.participantes_evento.find(p => p.id === partId);
            if (!part) return false;
            
            logSQL(`UPDATE participantes_evento SET valor_cobrado = ${novoValor}, obs = '${obs}' WHERE id = '${partId}';`, 'query');
            part.valor_cobrado = parseFloat(novoValor);
            part.obs = obs;
            logSQL(`Valor cobrado do participante '${part.nome}' atualizado para R$ ${parseFloat(novoValor).toFixed(2)}.`, 'success');
            refreshAllUI();
            return true;
        },
        updateParticipanteEventoStatus: function(partId, status, formaPgto) {
            const part = DB.participantes_evento.find(p => p.id === partId);
            if (!part) return false;
            
            const oldStatus = part.status_pagamento;
            if (oldStatus === status) return true;
            
            logSQL(`UPDATE participantes_evento SET status_pagamento = '${status}', forma_pagamento = '${formaPgto}' WHERE id = '${partId}';`, 'query');
            part.status_pagamento = status;
            part.forma_pagamento = formaPgto;
            if (status === 'Pago') {
                part.data_pagamento = new Date().toISOString().split('T')[0];
                
                const event = DB.eventos.find(e => e.id === part.evento_id);
                const financeEntry = {
                    id: crypto.randomUUID(),
                    tipo: 'Entrada',
                    categoria: `Ingresso: ${event ? event.nome : 'Evento'}`,
                    valor: part.valor_cobrado,
                    data_competencia: new Date().toISOString().split('T')[0],
                    status_conciliacao: false,
                    evento_id: part.evento_id,
                    produto_id: null
                };
                supabase.from('lancamentos_financeiros').insert([financeEntry]).then(({ error }) => {
                    if (error) console.error('[Lançamentos] Erro ao gerar lançamento de pagamento:', error);
                });
                DB.lancamentos_financeiros.push(financeEntry);
                logSQL(`Trigger Automático: Lançamento de Entrada de R$ ${part.valor_cobrado.toFixed(2)} criado no caixa referente ao pagamento de ${part.nome}.`, 'trigger');
            } else {
                part.data_pagamento = null;
            }
            
            logSQL(`Status de pagamento do participante '${part.nome}' alterado para '${status}'.`, 'success');
            refreshAllUI();
            return true;
        },
        deleteParticipanteEvento: function(partId) {
            const idx = DB.participantes_evento.findIndex(p => p.id === partId);
            if (idx === -1) return false;
            
            const part = DB.participantes_evento[idx];
            logSQL(`DELETE FROM participantes_evento WHERE id = '${partId}';`, 'query');
            DB.participantes_evento.splice(idx, 1);
            logSQL(`Participante '${part.nome}' removido do evento.`, 'success');
            refreshAllUI();
            return true;
        }
    };



    // ------------------------------------------------------------------------
    // 3. AUTENTICAÇÃO — gerida pelo módulo auth.js (window.initAuth)
    // As funções checkBackend, localAuth e os handlers de login/logout foram
    // extraídos para auth.js. A chamada window.initAuth({...}) ocorre abaixo,
    // após openApp e syncDBFromSupabase estarem definidos.
    // ------------------------------------------------------------------------

    // ========================================================================
    // SIDEBAR & PERMISSÕES VISUAIS — extraídos para user_access.js
    // ========================================================================

    // --- Sincroniza dados do Supabase para Memória Local ---
    window.syncDBFromSupabase = async function() {
        console.log('Iniciando sincronização com o Supabase...');
        const tables = [
            'usuarios', 'eventos', 'tarefas_logistica', 'modalidades', 'atletas',
            'produtos', 'produto_variantes', 'calendario_editorial', 'cronograma_postagens',
            'escalacoes', 'participantes_evento', 'lancamentos_financeiros',
            'parceiros_patrocinadores', 'documentos_contratos', 'logs_notificacoes',
            'fornecedores', 'coordenador_modalidades',
            // Sprint 4 — Supply Chain: tabelas do módulo de Pedidos de Compra
            'pedidos_compra', 'pedidos_compra_itens', 'log_recebimentos',
            'chat_conversations', 'chat_participants', 'chat_messages', 'diretorias',
            'usuario_diretorias', 'permissoes', 'configuracoes_globais', 'notificacoes_config'
        ];

        try {
            for (const table of tables) {
                const { data, error } = await supabase.from(table).select('*');

                // Early Return dentro do loop: loga o erro e avança para a próxima tabela
                if (error) {
                    console.error(`[Sync] Erro ao carregar tabela "${table}":`, error);
                    continue;
                }

                // Corrigido: antes só sobrescrevia DB[table] quando data.length > 0,
                // então uma tabela real vazia no Supabase nunca limpava dados falsos
                // deixados em memória por inserts que não persistiam (ex.: fornecedores/produtos).
                if (data) DB[table] = data;
            }

            // Mapeamento transicional: injeta o nome da diretoria e computa diretorias_ids acumuladas
            if (DB.usuarios && DB.diretorias) {
                DB.usuarios.forEach(u => {
                    if (u.diretoria_id) {
                        const dir = DB.diretorias.find(d => d.id === u.diretoria_id);
                        u.diretoria = dir ? dir.nome : 'Sem diretoria';
                    } else {
                        u.diretoria = u.diretoria || 'Sem diretoria';
                    }

                    // Suporte a Múltiplas Diretorias (Sprint 1): herda diretoria primária + secundárias da tabela relacional
                    const linked = (DB.usuario_diretorias || [])
                        .filter(ud => ud.usuario_id === u.id)
                        .map(ud => ud.diretoria_id);
                    const allIds = new Set();
                    if (u.diretoria_id) allIds.add(u.diretoria_id);
                    linked.forEach(id => { if (id) allIds.add(id); });
                    u.diretorias_ids = Array.from(allIds);
                });
            }

            // Garante que a conversa padrão "Geral LUP" existe (seed automático)
            if (!DB.chat_conversations.find(c => c.id === 'conv-1')) {
                const seedConv = { id: 'conv-1', name: 'Geral LUP', type: 'Grupo' };
                DB.chat_conversations.push(seedConv);

                // Fire-and-forget intencional: o seed não deve bloquear o restante do fluxo.
                // Erros são capturados via .catch() explícito (equivalente ao .then() anterior).
                supabase.from('chat_conversations').upsert(seedConv)
                    .then(function(r){ if(r.error) console.warn('[Sync] Erro ao fazer seed do Geral LUP:', r.error); });
            }

            console.log('Sincronização concluída! chat_conversations:', DB.chat_conversations.length);

            // Carrega e aplica as configurações globais master
            if (window.ConfigModule) {
                window.ConfigModule.loadConfig().catch(e => console.warn(e));
            }
        } catch (err) {
            console.error('[Sync] Erro inesperado durante a sincronização:', err);
        }
    };


    // --- Abre o painel após autenticação ---
    function openApp(user) {
        currentUser = user;
        window.currentUser = currentUser;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-wrapper').style.display = '';
        
        // Atualiza a foto e textos do perfil no topo
        const userAvatar = user.avatar || 'assets/default-avatar.png';
        const imgHeader = document.getElementById('header-user-avatar');
        const imgDropdown = document.getElementById('dropdown-user-avatar');
        if (imgHeader) imgHeader.src = userAvatar;
        if (imgDropdown) imgDropdown.src = userAvatar;

        const nameEl = document.getElementById('dropdown-user-name');
        const emailEl = document.getElementById('dropdown-user-email');
        const badgeEl = document.getElementById('dropdown-user-badge');
        if (nameEl) nameEl.textContent = user.nome;
        if (emailEl) emailEl.textContent = user.email;
        if (badgeEl) badgeEl.textContent = `${user.cargo} / ${user.diretoria !== 'Nenhuma' ? user.diretoria : 'Geral'}`;

        populateSidebar(user);
        applyNavPermissions();
        applyReadonlyMode();
        logSQL(`LOGIN: Usuário '${user.nome}' autenticado. cargo=${user.cargo}, diretoria=${user.diretoria}`, 'trigger');
        
        // Configura e inicializa o calendário para o mês atual ao entrar no app
        calendarCurrentDate = new Date();
        calendarSelectedDate = new Date();
        renderDashboardCalendar();
        renderCalendarDayDetails(calendarSelectedDate);

        // Cron simulado: verifica contratos vencendo nos próximos 30 dias ao abrir o painel
        checkContratoVencendoNotifications();

        refreshAllUI();

        // Sempre resetar para a aba "Dashboard Executivo" ao fazer login para evitar herdar telas anteriores
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.module-section').forEach(s => s.classList.remove('active'));
        
        const dashboardNavItem = document.querySelector('[data-target="mod-dashboard"]');
        if (dashboardNavItem) {
            dashboardNavItem.classList.add('active');
            document.getElementById('mod-dashboard').classList.add('active');
        }
    }

    // --- Inicializa o módulo de autenticação (auth.js) ---
    // Passa todas as dependências necessárias como contrato explícito,
    // evitando acoplamento implícito entre os módulos.
    window.initAuth({
        supabase,
        getDB:          () => DB,
        syncDB:         window.syncDBFromSupabase,
        onLogin:        openApp,
        logSQL,
        setCurrentUser: (user) => {
            currentUser = user;
            window.currentUser = user;
        },
    });

    // --- Inicializa o módulo financeiro (finance.js) ---
    window.initFinance({
        supabase,
        getDB:          () => DB,
        getDBEngine:    () => DB_Engine,
        getCurrentUser: () => currentUser,
        logSQL,
        refreshAllUI,
        formatCurrency: (val) => `R$ ${parseFloat(val).toFixed(2)}`
    });

    // --- Inicializa o módulo de configurações (config.js) ---
    if (window.ConfigModule) {
        window.ConfigModule.init();
    }

    // --- Inicializa o módulo de controle de acesso e usuários (user_access.js) ---
    window.initUserAccess({
        supabase,
        getDB:          () => DB,
        getDBEngine:    () => DB_Engine,
        getCurrentUser: () => currentUser,
        setCurrentUser: (user) => {
            currentUser = user;
            window.currentUser = user;
        },
        logSQL,
        refreshAllUI
    });

    // --- Inicializa o módulo GED e Documentos (ged_docs.js) ---
    window.initGED({
        supabase,
        getDB:          () => DB,
        getCurrentUser: () => currentUser,
        logSQL,
        refreshAllUI
    });

    // --- Inicializa o módulo de Compras / Supply Chain (compras.js — Sprint 4) ---
    if (window.initComprasModule) {
        window.initComprasModule({
            supabase,
            getDB:          () => DB,
            getCurrentUser: () => currentUser,
            logSQL,
            refreshAllUI
        });
    }





    // ------------------------------------------------------------------------
    // 4. LOGICA DA INTERFACE DE USUÁRIO (DOM MANIPULATION)
    // ------------------------------------------------------------------------

    // Tab Navigation Switcher
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.module-section');

    let prevTarget = null;
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetSection = item.getAttribute('data-target');

        navItems.forEach(n => n.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));

        item.classList.add('active');
        document.getElementById(targetSection).classList.add('active');
        logSQL(`Navegação: Acessou módulo '${item.innerText.trim()}'`, 'query');

        // Inicializar chat ao entrar no módulo
        if (targetSection === 'mod-comunicacao' && currentUser) {
            ChatModule.init();
            const _noConv = document.getElementById('chat-no-selection');
            const _actConv = document.getElementById('chat-active-area');
            if (_noConv)  _noConv.style.display  = 'flex';
            if (_actConv) _actConv.style.display = 'none';
        }

        // Destruir subscriptions Realtime ao sair do módulo
        if (prevTarget === 'mod-comunicacao' && targetSection !== 'mod-comunicacao') {
            ChatModule.destroy();
        }

        prevTarget = targetSection;
    });
});

    // Close Error Overlay Modal
    document.getElementById('btn-close-error').addEventListener('click', () => {
        document.getElementById('error-overlay').classList.remove('active');
    });

    // --- FASE 2: Quick Actions Bar ---
    // Função utilitária local para navegar simulando click no nav
    function qaNavTo(moduleId, afterNav) {
        const navBtn = document.querySelector(`.nav-item[data-target="${moduleId}"]`);
        if (navBtn) {
            navBtn.click();
            if (afterNav) setTimeout(afterNav, 120); // aguarda o módulo renderizar
        }
    }

    document.getElementById('qa-novo-recebimento')?.addEventListener('click', () => {
        qaNavTo('mod-financeiro', () => {
            // Foca no campo de valor para início imediato do lançamento
            const valField = document.getElementById('fin-val');
            if (valField) {
                valField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                valField.focus();
            }
        });
    });

    document.getElementById('qa-novo-pedido')?.addEventListener('click', () => {
        qaNavTo('mod-produtos', () => {
            // Dispara o modal de novo pedido de compra
            if (typeof window.openModalNovoPedido === 'function') {
                window.openModalNovoPedido();
            } else if (window.Compras?.openModalNovoPedido) {
                window.Compras.openModalNovoPedido();
            } else {
                // Fallback: simula click no botão nativo do módulo
                document.getElementById('btn-novo-pedido-compra')?.click();
            }
        });
    });

    document.getElementById('qa-cadastrar-atleta')?.addEventListener('click', () => {
        qaNavTo('mod-esportes');
    });

    document.getElementById('qa-criar-evento')?.addEventListener('click', () => {
        qaNavTo('mod-eventos');
    });

    // RENDER 1: EXECUTIVE DASHBOARD
    let dashboardRenderVersion = 0;
    async function renderExecutiveDashboard() {
        const version = ++dashboardRenderVersion;
        const safeQuery = async (table, columns) => {
            try {
                const { data, error } = await supabase.from(table).select(columns);
                if (error) throw error;
                return data || [];
            } catch (error) {
                console.warn(`[Dashboard] Dados indisponíveis em ${table}:`, error.message);
                return [];
            }
        };
        const formatCurrency = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

        const [financial, athletes, modalities, orders, events, products, variants, partners, contracts] = await Promise.all([
            safeQuery('lancamentos_financeiros', 'tipo,valor,data_competencia'),
            safeQuery('atletas', 'id,status_documentacao,modalidade_id'),
            safeQuery('modalidades', 'id,nome'),
            safeQuery('pedidos_compra', 'id,status,data_prevista_entrega'),
            safeQuery('eventos', 'id,nome,data_evento,status_aprovacao,tipo'),
            safeQuery('produtos', 'id,nome'),
            safeQuery('produto_variantes', 'produto_id,tamanho,estoque_atual'),
            safeQuery('parceiros_patrocinadores', 'id,status_funil'),
            safeQuery('documentos_contratos', 'id,titulo,tipo_documento,arquivo_url,data_vencimento')
        ]);
        if (version !== dashboardRenderVersion) return;

        const totalCash = financial.reduce((total, item) => total + (item.tipo === 'Entrada' ? Number(item.valor || 0) : -Number(item.valor || 0)), 0);
        const monthly = financial.filter(item => new Date(item.data_competencia) >= monthStart).reduce((acc, item) => {
            acc[item.tipo === 'Entrada' ? 'income' : 'expense'] += Number(item.valor || 0);
            return acc;
        }, { income: 0, expense: 0 });

        // --- Cálculo do mês anterior para tendências ---
        const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const prevMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
        const prevMonthly = financial.filter(item => {
            const d = new Date(item.data_competencia);
            return d >= prevMonthStart && d <= prevMonthEnd;
        }).reduce((acc, item) => {
            acc[item.tipo === 'Entrada' ? 'income' : 'expense'] += Number(item.valor || 0);
            return acc;
        }, { income: 0, expense: 0 });
        const prevNetCash = prevMonthly.income - prevMonthly.expense;
        const currNetCash = monthly.income - monthly.expense;

        const next15Days = new Date(today);
        next15Days.setDate(next15Days.getDate() + 15);
        const scheduledFinancialItems = financial.filter(item => {
            const date = new Date(item.data_competencia);
            return date >= today && date <= next15Days;
        }).length;
        const pendingDocuments = athletes.filter(item => String(item.status_documentacao || '').toLowerCase() === 'pendente').length;
        const athletesByModality = athletes.reduce((distribution, athlete) => {
            distribution[athlete.modalidade_id] = (distribution[athlete.modalidade_id] || 0) + 1;
            return distribution;
        }, {});
        const pendingOrders = orders.filter(item => ['aguardando aprovação', 'aguardando aprovacao', 'pendente'].includes(String(item.status || '').toLowerCase())).length;
        const upcomingEvents = events.filter(item => item.data_evento && new Date(item.data_evento) >= today).sort((a, b) => new Date(a.data_evento) - new Date(b.data_evento)).slice(0, 5);
        const nextEvent = upcomingEvents[0];
        const criticalVariants = variants.filter(item => Number(item.estoque_atual || 0) <= 5);
        const productNameById = new Map(products.map(item => [item.id, item.nome]));
        const activeProposals = partners.filter(item => ['prospecção', 'proposta', 'proposta gerada', 'negociação'].includes(String(item.status_funil || '').toLowerCase())).length;
        const unsignedContracts = contracts.filter(item => !item.arquivo_url || /pendente|assinatura/i.test(item.tipo_documento || '')).length;

        // --- FASE 1: Semântica de cor + KPI values ---
        setText('kpi-saldo-caixa', formatCurrency(totalCash));
        setText('kpi-financeiro-mes', `Receitas ${formatCurrency(monthly.income)} · Despesas ${formatCurrency(monthly.expense)}`);
        setText('kpi-atletas-ativos', athletes.length);
        setText('kpi-atletas-pendentes', `${pendingDocuments} documento${pendingDocuments === 1 ? '' : 's'} pendente${pendingDocuments === 1 ? '' : 's'}`);
        document.getElementById('kpi-atletas-ativos')?.setAttribute('title', Object.entries(athletesByModality).map(([id, count]) => `${modalities.find(item => item.id === id)?.nome || 'Sem modalidade'}: ${count}`).join(' | '));
        setText('kpi-compras-pendentes', pendingOrders);
        setText('kpi-proximo-evento', nextEvent ? nextEvent.nome : 'Sem eventos');
        setText('kpi-proximo-evento-data', nextEvent ? new Date(nextEvent.data_evento).toLocaleDateString('pt-BR', { dateStyle: 'medium' }) : 'Sem agendamentos futuros');

        // Semântica de cor no KPI de Saldo em Caixa
        const kpiCaixaIcon = document.getElementById('kpi-caixa-icon');
        const kpiCaixaH3   = document.getElementById('kpi-saldo-caixa');
        const cashColor    = totalCash < 0 ? '#ef4444' : '#10b981';
        if (kpiCaixaIcon) kpiCaixaIcon.style.color = cashColor;
        if (kpiCaixaH3)   kpiCaixaH3.style.color   = cashColor;

        // Indicadores de tendência — Saldo em Caixa vs mês anterior
        const trendCaixa = document.getElementById('kpi-caixa-trend');
        if (trendCaixa) {
            if (prevNetCash === 0 && currNetCash === 0) {
                trendCaixa.textContent = '';
            } else {
                const diff = currNetCash - prevNetCash;
                const pct  = prevNetCash !== 0 ? Math.abs(Math.round((diff / Math.abs(prevNetCash)) * 100)) : null;
                const arrow = diff >= 0 ? '▲' : '▼';
                const label = pct !== null ? `${arrow} ${pct}% vs mês anterior` : `${arrow} ${formatCurrency(Math.abs(diff))} vs mês anterior`;
                trendCaixa.textContent = label;
                trendCaixa.style.color = diff >= 0 ? '#10b981' : '#ef4444';
            }
        }

        // Tendência — Atletas (estático por ora: não temos histórico de atletas por mês)
        const trendAtletas = document.getElementById('kpi-atletas-trend');
        if (trendAtletas) {
            const meta = 150;
            const pct  = Math.round((athletes.length / meta) * 100);
            trendAtletas.textContent = `${pct}% da meta (${meta} atletas)`;
            trendAtletas.style.color = athletes.length >= meta ? '#10b981' : athletes.length >= meta * 0.7 ? '#f59e0b' : '#ef4444';
        }

        // Tendência — Compras Pendentes
        const trendCompras = document.getElementById('kpi-compras-trend');
        if (trendCompras) {
            if (pendingOrders === 0) {
                trendCompras.textContent = '✓ Nenhuma pendência';
                trendCompras.style.color = '#10b981';
            } else {
                trendCompras.textContent = `${pendingOrders} aguardando aprovação`;
                trendCompras.style.color = pendingOrders >= 3 ? '#ef4444' : '#f59e0b';
            }
        }

        // --- FASE 2: Alertas Acionáveis ---
        // Função utilitária para navegar para um módulo via click no nav-item
        function navTo(moduleId) {
            const navBtn = document.querySelector(`.nav-item[data-target="${moduleId}"]`);
            if (navBtn) navBtn.click();
        }

        const alertsList = document.getElementById('dashboard-alerts-list');
        if (alertsList) {
            const alertDefs = [
                { count: pendingDocuments,       icon: 'fas fa-file-medical',      label: 'documentos de atletas aguardam validação',            actionLabel: 'Ver Atletas',       action: () => navTo('mod-esportes') },
                { count: pendingOrders,          icon: 'fas fa-shopping-cart',     label: 'pedidos de compra aguardam liberação',                 actionLabel: 'Aprovar Pedidos',   action: () => navTo('mod-produtos') },
                { count: scheduledFinancialItems,icon: 'fas fa-calendar-alt',      label: 'lançamentos financeiros previstos nos próximos 15 dias', actionLabel: 'Ver Tesouraria',   action: () => navTo('mod-financeiro') },
                { count: criticalVariants.length,icon: 'fas fa-exclamation-triangle',label: 'itens com estoque crítico',                           actionLabel: 'Repor Estoque',     action: () => navTo('mod-produtos') },
                { count: unsignedContracts,      icon: 'fas fa-file-signature',    label: 'contratos pendentes de assinatura',                    actionLabel: 'Ver GED',           action: () => navTo('mod-ged') },
                { count: activeProposals,        icon: 'fas fa-handshake',         label: 'propostas de parceria em andamento',                   actionLabel: 'Ver Parcerias',     action: () => navTo('mod-parcerias') }
            ].filter(a => a.count > 0);

            if (alertDefs.length === 0) {
                alertsList.innerHTML = '<p style="color:var(--text-secondary); font-size:13px; margin:0;">Nenhuma pendência operacional no momento.</p>';
            } else {
                alertsList.innerHTML = alertDefs.map((a, i) => `
                    <div data-alert-idx="${i}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid var(--border-glass); border-radius:var(--radius-sm); transition:background .15s;">
                        <span style="display:flex; align-items:center; gap:10px; font-size:13px; flex:1;">
                            <i class="${a.icon}" style="color:var(--warning); width:16px; text-align:center;"></i>
                            <span><b>${a.count}</b> ${a.label}</span>
                        </span>
                        <button data-alert-action="${i}" style="flex-shrink:0; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:var(--text-secondary); border-radius:5px; padding:4px 10px; font-size:11px; cursor:pointer; white-space:nowrap; transition:all .2s;">
                            ${a.actionLabel} →
                        </button>
                    </div>`).join('');

                // Registra listeners nos botões de ação
                alertsList.querySelectorAll('[data-alert-action]').forEach(btn => {
                    const idx = Number(btn.getAttribute('data-alert-action'));
                    btn.addEventListener('click', () => alertDefs[idx].action());
                    btn.addEventListener('mouseover', () => { btn.style.background = 'rgba(255,255,255,0.12)'; btn.style.color = '#fff'; });
                    btn.addEventListener('mouseout',  () => { btn.style.background = 'rgba(255,255,255,0.06)'; btn.style.color = 'var(--text-secondary)'; });
                });
            }
        }

        const eventsList = document.getElementById('dashboard-upcoming-events');
        if (eventsList) {
            eventsList.innerHTML = upcomingEvents.length ? upcomingEvents.map(event => `<div style="display:flex; justify-content:space-between; gap:12px; padding:10px; border:1px solid var(--border-glass); border-radius:var(--radius-sm);"><span style="font-size:13px;"><b>${escapeSportsHtml(event.nome)}</b><br><small style="color:var(--text-secondary);">${event.tipo || 'Evento'} · ${event.status_aprovacao || 'Sem status'}</small></span><span class="badge badge-secondary">${new Date(event.data_evento).toLocaleDateString('pt-BR')}</span></div>`).join('') : '<p style="color:var(--text-secondary); font-size:13px; margin:0;">Sem eventos ou jogos futuros cadastrados.</p>';
        }

        // -----------------------------------------------------------------------
        // FASE 3 — TERMÔMETRO DE METAS
        // Constantes de meta (futuro: buscar de tabela de configurações no Supabase)
        // -----------------------------------------------------------------------
        (function renderMetas() {
            const METAS = {
                atletas:  { meta: 150,    atual: athletes.length,         formato: 'num' },
                receita:  { meta: 5000,   atual: monthly.income,          formato: 'brl' },
                pedidos:  { meta: 0,      atual: pendingOrders,           formato: 'inv' } // Invertido: 0 é a meta
            };

            function metaColor(pct, invertido) {
                if (invertido) return pct === 0 ? '#10b981' : pct <= 30 ? '#f59e0b' : '#ef4444';
                return pct >= 100 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444';
            }

            function applyMeta(key, { meta, atual, formato }) {
                const fill   = document.getElementById(`meta-${key}-fill`);
                const pctEl  = document.getElementById(`meta-${key}-pct`);
                const atualEl= document.getElementById(`meta-${key}-atual`);
                const labelEl= document.getElementById(`meta-${key}-label`);
                if (!fill || !pctEl || !atualEl || !labelEl) return;

                const invertido = formato === 'inv';
                let pct;
                if (invertido) {
                    // Para compras pendentes: quanto menos, melhor. 0 = 100%
                    pct = atual === 0 ? 100 : Math.min(Math.round((atual / Math.max(meta + 5, atual + 1)) * 100), 100);
                } else {
                    pct = meta > 0 ? Math.min(Math.round((atual / meta) * 100), 100) : 0;
                }

                const cor = metaColor(pct, invertido);

                // Aplica preenchimento e cor
                fill.style.width = `${pct}%`;
                fill.style.backgroundColor = cor;

                // Badge de percentual
                pctEl.textContent = `${pct}%`;
                pctEl.style.background = `${cor}22`;
                pctEl.style.color = cor;

                // Valor atual formatado
                if (formato === 'brl') {
                    atualEl.textContent = atual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
                } else {
                    atualEl.textContent = atual;
                }
                atualEl.style.color = cor;

                // Label de contexto
                if (invertido) {
                    labelEl.textContent = atual === 0 ? '✓ Meta atingida — nenhum pendente' : `${atual} pedido${atual > 1 ? 's' : ''} ainda aguardam aprovação`;
                    labelEl.style.color = cor;
                } else if (pct >= 100) {
                    labelEl.textContent = '✓ Meta atingida!';
                    labelEl.style.color = '#10b981';
                } else {
                    const restante = formato === 'brl'
                        ? (meta - atual).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
                        : `${meta - atual}`;
                    labelEl.textContent = `Faltam ${restante} para a meta`;
                    labelEl.style.color = cor;
                }
            }

            Object.entries(METAS).forEach(([key, cfg]) => applyMeta(key, cfg));
        })();

        // -----------------------------------------------------------------------
        // FASE 4 — GRÁFICO FINANCEIRO: Receitas vs Despesas (últimos 6 meses)
        // Reutiliza dados cacheados em `financial` — zero requisições extras
        // -----------------------------------------------------------------------
        (function renderFinancialChart() {
            const canvas = document.getElementById('chart-financeiro');
            if (!canvas || typeof Chart === 'undefined') return;

            // Monta os últimos 6 meses como labels e chaves de agrupamento
            const months = [];
            for (let i = 5; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                months.push({
                    label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
                    year:  d.getFullYear(),
                    month: d.getMonth()
                });
            }

            const receitas  = months.map(() => 0);
            const despesas  = months.map(() => 0);

            financial.forEach(item => {
                const d = new Date(item.data_competencia);
                const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
                if (idx === -1) return;
                const val = Number(item.valor || 0);
                if (item.tipo === 'Entrada') receitas[idx] += val;
                else                        despesas[idx] += val;
            });

            // Plugin de data labels reutilizado (adaptado para dois datasets)
            const dualLabelPlugin = {
                id: 'lupDualLabels',
                afterDatasetsDraw(chart) {
                    const { ctx } = chart;
                    ctx.save();
                    ctx.font = 'bold 9px Inter, Arial, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    chart.data.datasets.forEach((ds, di) => {
                        chart.getDatasetMeta(di).data.forEach((bar, i) => {
                            const val = ds.data[i];
                            if (!val || val < 10) return;
                            ctx.fillStyle = di === 0 ? '#6ee7b7' : '#fca5a5';
                            const label = val >= 1000
                                ? `R$${(val / 1000).toFixed(1)}k`
                                : `R$${val.toFixed(0)}`;
                            ctx.fillText(label, bar.x, bar.y - 2);
                        });
                    });
                    ctx.restore();
                }
            };

            // Destrói instância anterior
            if (window._lupFinanceChart instanceof Chart) {
                window._lupFinanceChart.destroy();
                window._lupFinanceChart = null;
            }

            window._lupFinanceChart = new Chart(canvas, {
                type: 'bar',
                plugins: [dualLabelPlugin],
                data: {
                    labels: months.map(m => m.label),
                    datasets: [
                        {
                            label: 'Receitas',
                            data: receitas,
                            backgroundColor: 'rgba(16,185,129,0.65)',
                            borderColor: 'rgb(16,185,129)',
                            borderWidth: 1.5,
                            borderRadius: 5,
                            borderSkipped: false
                        },
                        {
                            label: 'Despesas',
                            data: despesas,
                            backgroundColor: 'rgba(239,68,68,0.65)',
                            borderColor: 'rgb(239,68,68)',
                            borderWidth: 1.5,
                            borderRadius: 5,
                            borderSkipped: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 18 } },
                    animation: { duration: 500, easing: 'easeOutQuart' },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(10,10,25,0.95)',
                            titleColor: '#fff',
                            bodyColor: '#94a3b8',
                            borderColor: 'rgba(255,255,255,0.12)',
                            borderWidth: 1,
                            padding: 12,
                            callbacks: {
                                label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#94a3b8', font: { size: 10 } },
                            grid:  { color: 'rgba(255,255,255,0.04)' }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: '#94a3b8',
                                font: { size: 10 },
                                precision: 0,
                                callback: val => val >= 1000 ? `R$${(val/1000).toFixed(0)}k` : `R$${val}`
                            },
                            grid: { color: 'rgba(255,255,255,0.07)' }
                        }
                    }
                }
            });
        })();

        const stockList = document.getElementById('dashboard-stock-list');
        setText('dashboard-stock-summary', variants.length ? `${criticalVariants.length} crítico(s) de ${variants.length} variantes` : 'Sem dados cadastrados');
        if (stockList) {
            stockList.innerHTML = criticalVariants.length ? criticalVariants.map(item => `<span class="badge badge-warning" style="padding:8px 10px;">${escapeSportsHtml(productNameById.get(item.produto_id) || 'Produto')} · ${item.estoque_atual} un.</span>`).join('') : (products.length ? '<span style="font-size:13px; color:var(--success);">Estoque sem itens críticos.</span>' : '<span style="font-size:13px; color:var(--text-secondary);">Cadastre produtos e variantes para acompanhar o estoque.</span>');
        }

        // --- Gráfico de Barras Interativo: Estoque por Produto com Filtro de Tamanho ---
        (function renderStockChart() {
            const canvas  = document.getElementById('chart-estoque');
            const tagsEl  = document.getElementById('stock-size-tags');
            if (!canvas || typeof Chart === 'undefined') return;

            // 1. Monta estrutura: { produtoNome: { P: qty, M: qty, ... } }
            const byProduct = {};
            variants.forEach(v => {
                const nome    = productNameById.get(v.produto_id) || 'Desconhecido';
                const tamanho = (v.tamanho || 'Único').trim().toUpperCase();
                if (!byProduct[nome]) byProduct[nome] = {};
                byProduct[nome][tamanho] = (byProduct[nome][tamanho] || 0) + Number(v.estoque_atual || 0);
            });

            const productLabels = Object.keys(byProduct);

            // 2. Coleta todos os tamanhos únicos ordenados (PP→P→M→G→GG→XGG→demais)
            const sizeOrder = ['PP','P','M','G','GG','XGG','EGG','ÚNICO'];
            const allSizesSet = new Set();
            Object.values(byProduct).forEach(sizes => Object.keys(sizes).forEach(s => allSizesSet.add(s)));
            const allSizes = [...allSizesSet].sort((a, b) => {
                const ia = sizeOrder.indexOf(a), ib = sizeOrder.indexOf(b);
                if (ia === -1 && ib === -1) return a.localeCompare(b);
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
            });

            // Destrói instância anterior
            if (window._lupEstoqueChart instanceof Chart) {
                window._lupEstoqueChart.destroy();
                window._lupEstoqueChart = null;
            }

            if (productLabels.length === 0) {
                canvas.style.display = 'none';
                if (tagsEl) tagsEl.style.display = 'none';
                return;
            }
            canvas.style.display = 'block';

            // 3. Estado de seleção de tamanhos (Set vazio = "Todos")
            let selectedSizes = new Set();

            // 4. Função que calcula os dados do gráfico baseado na seleção
            function calcData() {
                return productLabels.map(nome => {
                    const sizes = byProduct[nome] || {};
                    if (selectedSizes.size === 0) {
                        return Object.values(sizes).reduce((a, b) => a + b, 0);
                    }
                    let total = 0;
                    selectedSizes.forEach(s => { total += sizes[s] || 0; });
                    return total;
                });
            }

            // 5. Cores dinâmicas por quantidade
            function calcColors(data) {
                return {
                    bg: data.map(q => q <= 5 ? 'rgba(239,68,68,0.75)' : 'rgba(16,185,129,0.75)'),
                    border: data.map(q => q <= 5 ? 'rgb(239,68,68)' : 'rgb(16,185,129)')
                };
            }

            // 6. Plugin de data labels permanentes no topo das barras
            const dataLabelPlugin = {
                id: 'lupDataLabels',
                afterDatasetsDraw(chart) {
                    const { ctx, data } = chart;
                    ctx.save();
                    chart.getDatasetMeta(0).data.forEach((bar, i) => {
                        const value = data.datasets[0].data[i];
                        if (value === 0) return;
                        ctx.fillStyle = '#f1f5f9';
                        ctx.font = 'bold 11px Inter, Arial, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(value, bar.x, bar.y - 3);
                    });
                    ctx.restore();
                }
            };

            // 7. Cria o gráfico
            const initialData   = calcData();
            const initialColors = calcColors(initialData);

            window._lupEstoqueChart = new Chart(canvas, {
                type: 'bar',
                plugins: [dataLabelPlugin],
                data: {
                    labels: productLabels,
                    datasets: [{
                        label: 'Estoque',
                        data: initialData,
                        backgroundColor: initialColors.bg,
                        borderColor: initialColors.border,
                        borderWidth: 1.5,
                        borderRadius: 6,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 18 } },
                    animation: { duration: 450, easing: 'easeOutQuart' },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(10,10,25,0.95)',
                            titleColor: '#ffffff',
                            bodyColor: '#94a3b8',
                            borderColor: 'rgba(255,255,255,0.12)',
                            borderWidth: 1,
                            padding: 12,
                            callbacks: {
                                title: items => items[0].label,
                                label: ctx => {
                                    const label = selectedSizes.size === 0
                                        ? 'Total'
                                        : [...selectedSizes].join(' + ');
                                    return ` ${label}: ${ctx.parsed.y} un.`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#94a3b8', font: { size: 11 }, maxRotation: 35 },
                            grid: { color: 'rgba(255,255,255,0.04)' }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: { color: '#94a3b8', font: { size: 11 }, precision: 0 },
                            grid: { color: 'rgba(255,255,255,0.07)' }
                        }
                    }
                }
            });

            // 8. Renderiza as tags de filtro de tamanho
            if (!tagsEl) return;
            tagsEl.style.display = 'flex';

            function renderTags() {
                const isAll = selectedSizes.size === 0;
                tagsEl.innerHTML = ['__TODOS__', ...allSizes].map(size => {
                    const isAll_btn = size === '__TODOS__';
                    const isActive  = isAll_btn ? isAll : selectedSizes.has(size);
                    const label     = isAll_btn ? 'Todos' : size;
                    const activeStyle = isActive
                        ? 'background:rgba(249,115,22,0.18); border-color:rgba(249,115,22,0.7); color:#fb923c; font-weight:700;'
                        : 'background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.12); color:#94a3b8;';
                    return `<button
                        data-size="${size}"
                        style="
                            ${activeStyle}
                            border:1px solid; border-radius:6px;
                            padding:4px 12px; font-size:12px;
                            cursor:pointer; transition:all 0.2s;
                            font-family:Inter,Arial,sans-serif;
                        "
                    >${label}</button>`;
                }).join('');

                // Listeners das tags
                tagsEl.querySelectorAll('button').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const size = btn.dataset.size;
                        if (size === '__TODOS__') {
                            selectedSizes.clear();
                        } else {
                            if (selectedSizes.has(size)) {
                                selectedSizes.delete(size);
                            } else {
                                selectedSizes.add(size);
                            }
                        }
                        // Atualiza gráfico
                        const newData   = calcData();
                        const newColors = calcColors(newData);
                        window._lupEstoqueChart.data.datasets[0].data            = newData;
                        window._lupEstoqueChart.data.datasets[0].backgroundColor = newColors.bg;
                        window._lupEstoqueChart.data.datasets[0].borderColor     = newColors.border;
                        window._lupEstoqueChart.update();
                        renderTags();
                    });
                });
            }
            renderTags();
        })();

        if (window.UserAccess) window.UserAccess.renderAccessModule();

        // Render Logs & Audit table (with Delete attempt simulated to test RN-LOG-01)
        const logsTbody = document.querySelector('#logs-table tbody');
        logsTbody.innerHTML = '';
        
        const sortedLogs = DB.logs_notificacoes.slice().sort((a, b) => b.data_envio.localeCompare(a.data_envio));
        sortedLogs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${log.data_envio}</td>
                <td><span class="badge badge-secondary">${log.tipo_notificacao}</span></td>
                <td><span class="badge ${log.gatilho_regra === 'TENTATIVA_VIOLACAO' ? 'badge-danger' : 'badge-warning'}">${log.gatilho_regra}</span></td>
                <td><code>${log.destinatario_email}</code></td>
                <td>
                    <span class="badge ${log.status_entrega === 'ENVIADO' ? 'badge-success' : 'badge-danger'}">
                        ${log.status_entrega}
                    </span>
                    ${log.erro_detalhe ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:4px; max-width:250px;">${log.erro_detalhe}</div>` : ''}
                </td>
                <td>
                    <button class="btn btn-secondary btn-delete-log" data-log-id="${log.id}" style="padding: 4px 8px; font-size:11px;">
                        <i class="fas fa-trash"></i> Deletar
                    </button>
                </td>
            `;
            logsTbody.appendChild(tr);
        });

        // Event listener for trying to delete append-only logs (RN-LOG-01)
        document.querySelectorAll('.btn-delete-log').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const logId = btn.getAttribute('data-log-id');
                if (confirm('Tem certeza de que deseja excluir este log de auditoria? Esta ação é irreversível.')) {
                    DB_Engine.mutateAuditLog(logId, 'delete');
                }
            });
        });
    }

    // --- FUNÇÕES E LISTENERS DO CALENDÁRIO ---
    function renderDashboardCalendar() {
        const monthYearEl = document.getElementById('cal-month-year');
        const calWrapper = document.querySelector('.calendar-wrapper');
        if (!monthYearEl || !calWrapper) return;

        const year = calendarCurrentDate.getFullYear();
        const month = calendarCurrentDate.getMonth();

        const monthsPT = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        monthYearEl.textContent = `${monthsPT[month]} ${year}`;

        calWrapper.innerHTML = `
            <div class="calendar-grid-header">
                <div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
            </div>
            <div class="calendar-grid-body"></div>
        `;

        const gridBody = calWrapper.querySelector('.calendar-grid-body');

        const firstDayIndex = new Date(year, month, 1).getDay();
        const prevLastDay = new Date(year, month, 0).getDate();
        const lastDay = new Date(year, month + 1, 0).getDate();
        const lastDayIndex = new Date(year, month, lastDay).getDay();
        const nextDays = 7 - lastDayIndex - 1;

        // Dias do mês anterior
        for (let x = firstDayIndex; x > 0; x--) {
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-day other-month';
            dayEl.textContent = prevLastDay - x + 1;
            gridBody.appendChild(dayEl);
        }

        // Dias do mês atual
        for (let i = 1; i <= lastDay; i++) {
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-day';
            dayEl.textContent = i;

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            dayEl.setAttribute('data-date', dateStr);

            const today = new Date();
            if (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
                dayEl.classList.add('today');
            }

            if (i === calendarSelectedDate.getDate() && month === calendarSelectedDate.getMonth() && year === calendarSelectedDate.getFullYear()) {
                dayEl.classList.add('active-day');
            }

            // Busca eventos aprovados
            const hasEvents = DB.eventos.some(e => {
                if (e.status_aprovacao !== 'Aprovado') return false;
                return e.data_evento.split(' ')[0] === dateStr;
            });

            // Busca posts agendados
            const hasPosts = DB.cronograma_postagens.some(p => {
                if (p.status !== 'Agendado') return false;
                return p.data_publicacao.split(' ')[0] === dateStr;
            });

            if (hasEvents || hasPosts) {
                const dotsContainer = document.createElement('div');
                dotsContainer.className = 'calendar-dots-container';
                if (hasEvents) {
                    const dot = document.createElement('span');
                    dot.className = 'calendar-dot dot-event';
                    dotsContainer.appendChild(dot);
                }
                if (hasPosts) {
                    const dot = document.createElement('span');
                    dot.className = 'calendar-dot dot-post';
                    dotsContainer.appendChild(dot);
                }
                dayEl.appendChild(dotsContainer);
            }

            dayEl.addEventListener('click', () => {
                calendarSelectedDate = new Date(year, month, i);
                renderDashboardCalendar();
                renderCalendarDayDetails(calendarSelectedDate);
            });

            gridBody.appendChild(dayEl);
        }

        // Dias do próximo mês
        for (let j = 1; j <= nextDays; j++) {
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-day other-month';
            dayEl.textContent = j;
            gridBody.appendChild(dayEl);
        }
    }

    function renderCalendarDayDetails(date) {
        const selectedLabel = document.getElementById('cal-selected-day-label');
        const actionsList = document.getElementById('calendar-day-actions-list');
        if (!selectedLabel || !actionsList) return;

        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        selectedLabel.textContent = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
        actionsList.innerHTML = '';

        const dayEvents = DB.eventos.filter(e => {
            if (e.status_aprovacao !== 'Aprovado') return false;
            return e.data_evento.split(' ')[0] === dateStr;
        });

        const dayPosts = DB.cronograma_postagens.filter(p => {
            if (p.status !== 'Agendado') return false;
            return p.data_publicacao.split(' ')[0] === dateStr;
        });

        if (dayEvents.length === 0 && dayPosts.length === 0) {
            actionsList.innerHTML = `
                <div style="text-align:center; padding: 24px 12px; color: var(--text-secondary); font-size:12px;">
                    <i class="fas fa-calendar-times" style="font-size:24px; margin-bottom:8px; opacity:0.4;"></i>
                    <p>Nenhuma ação agendada para este dia.</p>
                </div>
            `;
            return;
        }

        dayEvents.forEach(evt => {
            const timeStr = evt.data_evento.split(' ')[1] || 'Geral';
            const card = document.createElement('div');
            card.className = 'action-day-card event-type';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:4px; color:#10b981;">
                    <span><i class="fas fa-star"></i> Evento Aprovado</span>
                    <span>${timeStr}</span>
                </div>
                <div style="font-size:13px; font-weight:bold; color:#fff; margin-bottom:2px;">${evt.nome}</div>
                <div style="color:var(--text-secondary); font-size:11px;">
                    <i class="fas fa-map-marker-alt"></i> Local: ${evt.local} | Tipo: ${evt.tipo}
                </div>
            `;
            actionsList.appendChild(card);
        });

        dayPosts.forEach(post => {
            const timeStr = post.data_publicacao.split(' ')[1] || 'Geral';
            const card = document.createElement('div');
            card.className = 'action-day-card post-type';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:4px; color:#ea580c;">
                    <span><i class="fab fa-instagram"></i> Postagem Agendada (${post.plataforma})</span>
                    <span>${timeStr}</span>
                </div>
                <div style="font-size:13px; font-weight:bold; color:#fff; margin-bottom:2px;">${post.tipo_conteudo}</div>
                <div style="color:var(--text-secondary); font-size:11px; word-break:break-word;">
                    Desc: ${post.descricao}
                </div>
            `;
            actionsList.appendChild(card);
        });
    }

    // Navegação do Calendário
    const prevMonthBtn = document.getElementById('cal-prev-month');
    const nextMonthBtn = document.getElementById('cal-next-month');
    if (prevMonthBtn && nextMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
            calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
            renderDashboardCalendar();
        });
        nextMonthBtn.addEventListener('click', () => {
            calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
            renderDashboardCalendar();
        });
    }

    // ================================================================
    // MÓDULO: GESTÃO DE ACESSOS E PERFIL DE USUÁRIOS
    // Extraído para user_access.js (window.UserAccess).
    // O módulo é carregado antes do app.js via <script src="user_access.js">.
    // ================================================================

    // RENDER 3: EVENTS MODULE (KANBAN BOARD)
    function renderEventsModule() {
        const cols = {
            'Rascunho': document.getElementById('col-rascunho-body'),
            'Aguardando Tesouraria': document.getElementById('col-tesouraria-body'),
            'Aprovado': document.getElementById('col-aprovado-body'),
            'Cancelado': document.getElementById('col-cancelado-body')
        };

        // Clear columns
        Object.keys(cols).forEach(k => cols[k].innerHTML = '');

        // Populate Kanban cards
        DB.eventos.forEach(evt => {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.setAttribute('draggable', 'true');
            card.innerHTML = `
                <div class="event-name">${evt.nome}</div>
                <div class="event-details">
                    <span><i class="fas fa-map-marker-alt"></i> ${evt.local}</span>
                    <span><i class="fas fa-calendar-alt"></i> ${evt.data_evento}</span>
                </div>
                <div class="event-details" style="margin-top: 4px; display: flex; gap: 4px; align-items: center;">
                    <span class="badge badge-secondary" style="font-size:10px; padding: 2px 6px;">${evt.tipo || 'Institucional'}</span>
                    ${(evt.tipo === 'Social' || evt.tipo === 'Misto' || evt.tipo === 'Competição') && evt.valor_taxa_base > 0 ? `
                        <span class="badge" style="font-size:10px; padding: 2px 6px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);"><i class="fas fa-ticket-alt"></i> R$ ${evt.valor_taxa_base.toFixed(2)}</span>
                    ` : ''}
                </div>
                <div class="event-budget" style="margin-top: 8px;">
                    <span>Orçamento: R$ ${evt.orcamento_previsto.toFixed(2)}</span>
                    ${evt.status_aprovacao === 'Aguardando Tesouraria' ? `
                        <button class="btn-approve-event" data-evt-id="${evt.id}">
                            <i class="fas fa-check"></i> Aprovar
                        </button>
                    ` : ''}
                </div>
            `;

            // Click listener for Approve Button (testing triggers & permissions)
            const approveBtn = card.querySelector('.btn-approve-event');
            if (approveBtn) {
                approveBtn.addEventListener('click', async () => {
                    await DB_Engine.updateEventStatus(evt.id, 'Aprovado');
                });
            }

            // Simple Drag and Drop listeners or column transitions
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', evt.id);
            });

            if (cols[evt.status_aprovacao]) {
                cols[evt.status_aprovacao].appendChild(card);
            }
        });

        // Set up drop zones
        Object.keys(cols).forEach(status => {
            const colBody = cols[status];
            colBody.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            colBody.addEventListener('drop', async (e) => {
                e.preventDefault();
                const evtId = e.dataTransfer.getData('text/plain');
                await DB_Engine.updateEventStatus(evtId, status);
            });
        });
    }

    // Toggle Taxa Base visibility based on Event Type
    const evtTipoSelect = document.getElementById('evt-tipo');
    if (evtTipoSelect) {
        evtTipoSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            const groupTaxa = document.getElementById('group-taxa-base');
            if (groupTaxa) {
                if (val === 'Social' || val === 'Misto' || val === 'Competição') {
                    groupTaxa.style.display = 'block';
                } else {
                    groupTaxa.style.display = 'none';
                    document.getElementById('evt-taxa-base').value = '0.00';
                }
            }
        });
    }

    // Event Handler: Create Event Form
    document.getElementById('form-create-event').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('evt-nome').value;
        const data = document.getElementById('evt-data').value;
        const local = document.getElementById('evt-local').value;
        const orcamento = parseFloat(document.getElementById('evt-orcamento').value) || 0;
        const tipo = document.getElementById('evt-tipo').value;
        const taxaBase = parseFloat(document.getElementById('evt-taxa-base').value) || 0;

        const eventPayload = {
            nome: nome,
            data_evento: data.replace('T', ' '),
            local: local,
            orcamento_previsto: orcamento,
            status_aprovacao: 'Rascunho',
            tipo: tipo,
            valor_taxa_base: taxaBase,
            criador_id: currentUser.id
        };

        const { data: event, error: eventError } = await supabase
            .from('eventos')
            .insert([eventPayload])
            .select()
            .single();
        if (eventError) {
            console.error('[Eventos] Erro ao criar evento:', eventError);
            alert(`Não foi possível criar o evento: ${eventError.message}`);
            return;
        }
        DB.eventos.push(event);
        logSQL(`INSERT INTO eventos (nome, data_evento, local, orcamento_previsto, status_aprovacao, tipo, valor_taxa_base, criador_id) VALUES ('${nome}', '${data}', '${local}', ${orcamento}, 'Rascunho', '${tipo}', ${taxaBase}, '${currentUser.id}');`, 'query');
        logSQL(`Event successfully created in state 'Rascunho'. Please drag or push it to 'Aguardando Tesouraria' to request funds.`, 'success');

        // --- TRIGGER NOTIFICAÇÃO: Solicitação de Verba para eventos do tipo Misto ou com orçamento previsto ---
        if (tipo === 'Misto' || orcamento > 0) {
            const alertEmail = window.getNotificationEmail('SOLICITACAO_VERBA');
            supabase.from('logs_notificacoes').insert([{
                usuario_id: currentUser ? currentUser.id : 'u1',
                tipo_notificacao: 'Email',
                gatilho_regra: 'SOLICITACAO_VERBA',
                destinatario_email: alertEmail,
                status_entrega: 'ENVIADO',
                data_envio: new Date().toISOString().replace('T', ' ').substring(0, 16),
                lida: false
            }]).then();
            logSQL(`INSERT INTO logs_notificacoes (usuario_id, tipo_notificacao, gatilho_regra, destinatario_email, status_entrega) VALUES ('${currentUser ? currentUser.id : 'u1'}', 'Email', 'SOLICITACAO_VERBA', '${alertEmail}', 'ENVIADO');`, 'query');
            logSQL(`Notificação de SOLICITACAO_VERBA disparada automaticamente para Tesouraria.`, 'success');
        }
        
        document.getElementById('form-create-event').reset();
        const groupTaxa = document.getElementById('group-taxa-base');
        if (groupTaxa) groupTaxa.style.display = 'none';
        refreshAllUI();
    });

    // RENDER: MARKETING MODULE (Fase 4)
    async function renderMarketingModule() {
        const mktEvtSelect = document.getElementById('mkt-evento-select');
        if (!mktEvtSelect) return;

        // Populate event select with approved events
        const prevSelectValue = selectedMarketingEventId;
        mktEvtSelect.innerHTML = '<option value="">Selecione um Evento...</option>';
        
        const { data: approvedEvents, error: approvedEventsError } = await supabase
            .from('eventos')
            .select('*')
            .eq('status_aprovacao', 'Aprovado');
        if (approvedEventsError) {
            console.error('[Marketing] Erro ao buscar eventos aprovados:', approvedEventsError);
            alert(`Não foi possível carregar os eventos aprovados: ${approvedEventsError.message}`);
            return;
        }
        approvedEvents.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.innerText = `${e.nome} (${e.tipo || 'Institucional'})`;
            mktEvtSelect.appendChild(opt);
        });

        if (prevSelectValue && approvedEvents.some(e => e.id === prevSelectValue)) {
            mktEvtSelect.value = prevSelectValue;
            selectedMarketingEventId = prevSelectValue;
        } else {
            mktEvtSelect.value = '';
            selectedMarketingEventId = '';
        }

        // Setup change listener once
        if (!mktEvtSelect.dataset.listener) {
            mktEvtSelect.addEventListener('change', async (e) => {
                selectedMarketingEventId = e.target.value;
                await renderMarketingModule();
            });
            mktEvtSelect.dataset.listener = 'true';
        }

        const container = document.getElementById('mkt-cronograma-container');
        const placeholder = document.getElementById('mkt-no-evento-selected');

        if (!selectedMarketingEventId) {
            if (container) container.style.display = 'none';
            if (placeholder) placeholder.style.display = 'block';
            return;
        }

        if (container) container.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';

        // Render table of post schedules
        const tbody = document.querySelector('#mkt-posts-table tbody');
        if (tbody) {
            tbody.innerHTML = '';
            const { data: posts, error: postsError } = await supabase
                .from('cronograma_postagens')
                .select('*')
                .eq('evento_id', selectedMarketingEventId)
                .order('data_publicacao');
            if (postsError) {
                console.error('[Marketing] Erro ao buscar postagens:', postsError);
                alert(`Não foi possível carregar as postagens: ${postsError.message}`);
                return;
            }
            
            if (posts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary);">Nenhuma postagem agendada para este evento.</td></tr>';
            } else {
                posts.forEach(post => {
                    const tr = document.createElement('tr');
                    
                    let statusBadge = '';
                    if (post.status === 'Publicado') {
                        statusBadge = `<span class="badge badge-success"><i class="fas fa-check-circle"></i> Publicado</span>`;
                    } else if (post.status === 'Cancelado') {
                        statusBadge = `<span class="badge badge-danger"><i class="fas fa-times-circle"></i> Cancelado</span>`;
                    } else {
                        statusBadge = `<span class="badge badge-warning"><i class="fas fa-clock"></i> Agendado</span>`;
                    }

                    const evento = DB.eventos.find(e => e.id === post.evento_id);
                    const eventoNome = evento ? evento.nome : '—';

                    tr.innerHTML = `
                        <td><b>${eventoNome}</b></td>
                        <td><b>${post.plataforma}</b> <span class="badge badge-secondary" style="font-size:10px;">${post.tipo_conteudo}</span></td>
                        <td><code>${post.data_publicacao}</code></td>
                        <td>${post.descricao}</td>
                        <td>${statusBadge}</td>
                        <td>
                            <div style="display:flex; gap:6px;">
                                ${post.status === 'Agendado' ? `
                                    <button class="btn btn-secondary btn-publish-post" data-post-id="${post.id}" style="padding:4px 8px; font-size:11px; background:var(--success-glow); color:var(--success);">
                                        Publicar
                                    </button>
                                    <button class="btn btn-secondary btn-cancel-post" data-post-id="${post.id}" style="padding:4px 8px; font-size:11px; background:var(--danger-glow); color:var(--danger);">
                                        Cancelar
                                    </button>
                                ` : ''}
                                <button class="btn btn-secondary btn-delete-post" data-post-id="${post.id}" style="padding:4px 8px; font-size:11px;">
                                    Excluir
                                </button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                // Attach button click listeners
                tbody.querySelectorAll('.btn-publish-post').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.getAttribute('data-post-id');
                        await DB_Engine.updateCronogramaPostagemStatus(id, 'Publicado');
                    });
                });

                tbody.querySelectorAll('.btn-cancel-post').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.getAttribute('data-post-id');
                        await DB_Engine.updateCronogramaPostagemStatus(id, 'Cancelado');
                    });
                });

                tbody.querySelectorAll('.btn-delete-post').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.getAttribute('data-post-id');
                        if (confirm('Tem certeza de que deseja excluir esta postagem? Esta ação é irreversível.')) {
                            await DB_Engine.deleteCronogramaPostagem(id);
                        }
                    });
                });
            }
        }
    }

    // Event Handler: Create Marketing Schedule Post
    const formCreatePost = document.getElementById('form-create-post');
    if (formCreatePost) {
        formCreatePost.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!selectedMarketingEventId) {
                alert('Selecione um evento primeiro!');
                return;
            }
            const plataforma = document.getElementById('post-plataforma').value;
            const tipo = document.getElementById('post-tipo').value;
            const data = document.getElementById('post-data').value;
            const desc = document.getElementById('post-descricao').value;

            const postId = await DB_Engine.insertCronogramaPostagem(selectedMarketingEventId, plataforma, tipo, data, desc);
            if (postId) formCreatePost.reset();
        });
    }

    // RENDER 3: PRODUCTS & INVENTORY
    function renderProductsModule() {
        // Tabela de Inventário
        const inventoryTbody = document.querySelector('#inventory-table tbody');
        inventoryTbody.innerHTML = '';
        
        // Tabela de Cadastro de Produtos (Aba Produtos)
        const productsTbody = document.querySelector('#produtos-list-table tbody');
        if (productsTbody) {
            productsTbody.innerHTML = '';

            if (!DB.produtos || DB.produtos.length === 0) {
                productsTbody.innerHTML = `
                    <tr>
                        <td colspan="4">
                            <div class="empty-state">
                                <i class="fas fa-shirt icon-empty"></i>
                                <h3>Nenhum produto cadastrado</h3>
                                <p>Ainda não há produtos cadastrados neste módulo.</p>
                                <button class="btn-primary" onclick="document.getElementById('prod-nome')?.focus()">+ Cadastrar Produto</button>
                            </div>
                        </td>
                    </tr>`;
            }

            DB.produtos.forEach(p => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.innerHTML = `
                    <td><b>${p.nome}</b></td>
                    <td>R$ ${p.preco_custo.toFixed(2)}</td>
                    <td>R$ ${p.preco_venda.toFixed(2)}</td>
                    <td>
                        <button class="btn btn-secondary btn-delete-product" data-prod-id="${p.id}" style="padding:4px 8px; font-size:11px; background:rgba(239,68,68,0.1); color:#ef4444;">
                            <i class="fas fa-trash-alt"></i> Excluir
                        </button>
                    </td>
                `;
                // Ao clicar na linha (mas não no botão de excluir), preenche o formulário
                tr.addEventListener('click', (e) => {
                    if (e.target.closest('.btn-delete-product')) return;
                    
                    document.getElementById('prod-edit-id').value = p.id;
                    document.getElementById('prod-nome').value = p.nome;
                    document.getElementById('prod-custo').value = p.preco_custo.toFixed(2);
                    document.getElementById('prod-venda').value = p.preco_venda.toFixed(2);
                    
                    const btnSave = document.getElementById('btn-save-product');
                    const btnCancel = document.getElementById('btn-cancel-product');
                    if (btnSave) btnSave.innerHTML = '<i class="fas fa-save"></i> Atualizar Produto';
                    if (btnCancel) btnCancel.style.display = 'inline-block';
                });
                
                productsTbody.appendChild(tr);
            });

            // Delete buttons
            productsTbody.querySelectorAll('.btn-delete-product').forEach(btn => {
                btn.addEventListener('click', () => {
                    const pId = btn.getAttribute('data-prod-id');
                    if (confirm('Tem certeza que deseja excluir este produto? Esta ação é irreversível.')) {
                        const idx = DB.produtos.findIndex(p => p.id === pId);
                        if (idx !== -1) {
                            DB.produtos.splice(idx, 1);
                            logSQL(`DELETE FROM produtos WHERE id = '${pId}';`, 'query');
                            refreshAllUI();
                        }
                    }
                });
            });
        }

        
        if (!DB.produto_variantes || DB.produto_variantes.length === 0) {
            inventoryTbody.innerHTML = `
                <tr>
                    <td colspan="5">
                        <div class="empty-state">
                            <i class="fas fa-boxes-stacked icon-empty"></i>
                            <h3>Nenhuma variante em estoque</h3>
                            <p>Cadastre um produto e suas variantes para começar a controlar o estoque.</p>
                            <button class="btn-primary" onclick="document.getElementById('prod-nome')?.focus()">+ Cadastrar Produto</button>
                        </div>
                    </td>
                </tr>`;
        }

        DB.produto_variantes.forEach(variant => {
            const product = DB.produtos.find(p => p.id === variant.produto_id);
            const tr = document.createElement('tr');
            
            // Stock Alert
            let stockBadge = `<span class="badge badge-success">${variant.estoque_atual} un</span>`;
            if (variant.estoque_atual === 0) {
                stockBadge = `<span class="badge badge-danger">ESGOTADO</span>`;
            } else if (variant.estoque_atual <= 5) {
                stockBadge = `<span class="badge badge-warning">Estoque Baixo (${variant.estoque_atual})</span>`;
            }

            tr.innerHTML = `
                <td><b>${product.nome}</b></td>
                <td><span class="badge badge-secondary" style="font-size:12px;">${variant.tamanho}</span></td>
                <td>R$ ${product.preco_custo.toFixed(2)}</td>
                <td>R$ ${product.preco_venda.toFixed(2)}</td>
                <td>${stockBadge}</td>
            `;
            inventoryTbody.appendChild(tr);
        });

        // Populate dropdowns in distribution form
        const productSelect = document.getElementById('dist-product-select');
        productSelect.innerHTML = '<option value="">Selecione...</option>';
        DB.produtos.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = p.nome;
            productSelect.appendChild(opt);
        });

        // Populate size variants based on selected product
        const sizeSelect = document.getElementById('dist-size-select');
        productSelect.addEventListener('change', () => {
            const pId = productSelect.value;
            sizeSelect.innerHTML = '<option value="">Selecione...</option>';
            if (!pId) return;

            const variants = DB.produto_variantes.filter(pv => pv.produto_id === pId);
            variants.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.innerText = `${v.tamanho} (Disponível: ${v.estoque_atual})`;
                sizeSelect.appendChild(opt);
            });
        });
    }

    // Event Handler: Sell / Distribute variant (tests RN-PROD-01 stocks Check)
    document.getElementById('btn-distribute-product').addEventListener('click', () => {
        const variantId = document.getElementById('dist-size-select').value;
        const quant = parseInt(document.getElementById('dist-qty').value) || 0;
        const buyer = document.getElementById('dist-buyer').value;

        if (!variantId || quant <= 0 || !buyer) {
            alert('Preencha os dados de distribuição corretamente.');
            return;
        }

        // Simula a venda/decremento de estoque (Delta negativo)
        const isSuccess = DB_Engine.mutateProductStock(variantId, -quant);
        
        if (isSuccess) {
            const variant = DB.produto_variantes.find(v => v.id === variantId);
            const product = DB.produtos.find(p => p.id === variant.produto_id);
            const totalVal = product.preco_venda * quant;
            
            // Injeta o lançamento financeiro automático correspondente à venda — persistido de verdade no Supabase
            const financeEntry = {
                id: crypto.randomUUID(),
                tipo: 'Entrada',
                categoria: `Venda ${product.nome} (Qtd: ${quant})`,
                valor: totalVal,
                data_competencia: new Date().toISOString().split('T')[0],
                status_conciliacao: false,
                evento_id: null,
                produto_id: product.id
            };
            supabase.from('lancamentos_financeiros').insert([financeEntry]).then(({ error }) => {
                if (error) console.error('[Lançamentos] Erro ao gerar lançamento de venda:', error);
            });
            DB.lancamentos_financeiros.push(financeEntry);
            logSQL(`Venda registrada! Entrada de R$ ${totalVal.toFixed(2)} inserida no caixa do produto '${product.nome}' (Variant size: ${variant.tamanho}).`, 'success');
            
            document.getElementById('dist-qty').value = '1';
            document.getElementById('dist-buyer').value = '';
            refreshAllUI();
        }
    });

    // Event Handler: Form Manage Product
    const formManageProduct = document.getElementById('form-manage-product');
    const btnCancelProduct = document.getElementById('btn-cancel-product');

    if (formManageProduct) {
        formManageProduct.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('prod-edit-id').value;
            const nome = document.getElementById('prod-nome').value;
            const custo = parseFloat(document.getElementById('prod-custo').value) || 0;
            const venda = parseFloat(document.getElementById('prod-venda').value) || 0;
            const variantes = [...new Set(document.getElementById('prod-variantes').value.split(',').map(v => v.trim()).filter(Boolean))];

            if (!nome) {
                showDBErrorDialog('23502 (Not Null Violation)', 'produtos.nome', 'O nome do produto é obrigatório.');
                return;
            }

            const btnSave = document.getElementById('btn-save-product');
            if (btnSave) btnSave.disabled = true;

            if (id) {
                // Update real via Supabase — antes só alterava o objeto em memória
                logSQL(`UPDATE produtos SET nome='${nome}', preco_custo=${custo}, preco_venda=${venda} WHERE id='${id}';`, 'query');

                const { data, error } = await supabase
                    .from('produtos')
                    .update({ nome, preco_custo: custo, preco_venda: venda })
                    .eq('id', id)
                    .select()
                    .single();

                if (error) {
                    console.error('[Produtos] Erro ao atualizar:', error);
                    logSQL(`Erro ao atualizar produto: ${error.message}`, 'error');
                    showDBErrorDialog(error.code || 'ERROR', 'produtos', error.message);
                    if (btnSave) btnSave.disabled = false;
                    return;
                }

                const prod = DB.produtos.find(p => p.id === id);
                if (prod) Object.assign(prod, data);
                logSQL(`Produto '${nome}' atualizado com sucesso.`, 'success');
            } else {
                // Insert real via Supabase — antes só simulava em memória com id fake
                // 'p_<timestamp>' que nunca existia na tabela real.
                logSQL(`INSERT INTO produtos (nome, preco_custo, preco_venda) VALUES ('${nome}', ${custo}, ${venda});`, 'query');

                const { data, error } = await supabase
                    .from('produtos')
                    .insert([{ nome, preco_custo: custo, preco_venda: venda }])
                    .select()
                    .single();

                if (error) {
                    console.error('[Produtos] Erro ao cadastrar:', error);
                    logSQL(`Erro ao cadastrar produto: ${error.message}`, 'error');
                    showDBErrorDialog(error.code || 'ERROR', 'produtos', error.message);
                    if (btnSave) btnSave.disabled = false;
                    return;
                }

                DB.produtos.push(data);
                if (variantes.length) {
                    const { data: novasVariantes, error: variantesError } = await supabase.from('produto_variantes')
                        .insert(variantes.map(tamanho => ({ produto_id: data.id, tamanho, estoque_atual: 0 }))).select();
                    if (variantesError) alert(`Produto salvo, mas não foi possível criar as variantes: ${variantesError.message}`);
                    else DB.produto_variantes.push(...novasVariantes);
                }
                logSQL(`Produto '${nome}' cadastrado com sucesso (ID: ${data.id}).`, 'success');
            }

            if (btnSave) btnSave.disabled = false;
            formManageProduct.reset();
            document.getElementById('prod-edit-id').value = '';
            document.getElementById('btn-save-product').innerHTML = '<i class="fas fa-save"></i> Salvar Produto';
            if (btnCancelProduct) btnCancelProduct.style.display = 'none';
            refreshAllUI();
        });
    }

    if (btnCancelProduct) {
        btnCancelProduct.addEventListener('click', () => {
            if (formManageProduct) formManageProduct.reset();
            document.getElementById('prod-edit-id').value = '';
            document.getElementById('btn-save-product').innerHTML = '<i class="fas fa-save"></i> Salvar Produto';
            btnCancelProduct.style.display = 'none';
        });
    }

    function isSportsRestrictedUser() {
        return !!currentUser && ['Coordenador', 'Apoio'].includes(currentUser.cargo);
    }

    function getManagedSportsModalityIds(userId = currentUser?.id) {
        if (!userId) return [];
        return (DB.coordenador_modalidades || [])
            .filter(link => link.usuario_id === userId)
            .map(link => link.modalidade_id);
    }

    function getVisibleSportsModalities() {
        const activeModalities = (DB.modalidades || []).filter(mod => mod.ativo !== false && mod.status !== false);
        if (!isSportsRestrictedUser()) return activeModalities;
        const managedIds = new Set(getManagedSportsModalityIds());
        return activeModalities.filter(mod => managedIds.has(mod.id));
    }

    function showSportsToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `chat-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2800);
    }

    function escapeSportsHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function closeCoordinatorModal() {
        document.getElementById('coordinator-modal-overlay')?.classList.remove('active');
    }

    // RENDER 4: SPORTS & ATHLETES (Fase 4)
    function renderSportsModule() {
        const restrictedUser = isSportsRestrictedUser();
        const visibleModalities = getVisibleSportsModalities();
        const managedIds = new Set(getManagedSportsModalityIds());

        document.querySelector('[data-tab="esp-tab-modalidades"]')?.style.setProperty('display', restrictedUser ? 'none' : '');
        document.querySelector('[data-tab="esp-tab-coordenadores"]')?.style.setProperty('display', restrictedUser ? 'none' : '');

        // Modalidades list
        const modalitiesTbody = document.querySelector('#modalities-table tbody');
        if (modalitiesTbody) {
            modalitiesTbody.innerHTML = '';

            if (!DB.modalidades || DB.modalidades.length === 0) {
                modalitiesTbody.innerHTML = `
                    <tr>
                        <td colspan="5">
                            <div class="empty-state">
                                <i class="fas fa-people-group icon-empty"></i>
                                <h3>Nenhuma modalidade cadastrada</h3>
                                <p>Ainda não há modalidades esportivas cadastradas neste módulo.</p>
                                <button class="btn-primary" onclick="document.getElementById('mod-nome')?.focus()">+ Cadastrar Modalidade</button>
                            </div>
                        </td>
                    </tr>`;
            }

            DB.modalidades.forEach(mod => {
                const manager = DB.usuarios.find(u => u.id === mod.coordenador_id);
                const countAthletes = DB.atletas.filter(a => a.modalidade_id === mod.id).length;
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><b>${mod.nome}</b></td>
                    <td><span class="badge badge-secondary">${mod.categoria || 'Coletivo'}</span></td>
                    <td>${manager ? manager.nome : 'Nenhum'}</td>
                    <td><span class="badge badge-secondary">${countAthletes} atletas</span></td>
                    <td>
                        <button class="btn btn-secondary btn-delete-mod" data-mod-id="${mod.id}" style="padding:4px 8px; font-size:11px; background:var(--danger-glow); color:var(--danger);">
                            <i class="fas fa-trash-alt"></i> Excluir
                        </button>
                    </td>
                `;
                modalitiesTbody.appendChild(tr);
            });

            // Modality Delete button listeners
            document.querySelectorAll('.btn-delete-mod').forEach(btn => {
                btn.addEventListener('click', () => {
                    const modId = btn.getAttribute('data-mod-id');
                    if (confirm('Tem certeza que deseja excluir esta modalidade? Esta ação é irreversível. Todos os atletas e escalações dela também serão excluídos.')) {
                        DB_Engine.deleteModalidade(modId);
                    }
                });
            });
        }

        // Coordinator assignments (exclusive to directors and administrators)
        const coordinatorsTbody = document.querySelector('#coordinators-table tbody');
        if (coordinatorsTbody) {
            coordinatorsTbody.innerHTML = '';
            const coordinators = (DB.usuarios || []).filter(user =>
                user.status !== false && ['Coordenador', 'Apoio'].includes(user.cargo)
            );

            if (!coordinators.length) {
                coordinatorsTbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><i class="fas fa-users-slash icon-empty"></i><h3>Nenhum coordenador ou apoio cadastrado</h3><p>Cadastre usuários com cargo Coordenador ou Apoio na Gestão de Acessos.</p></div></td></tr>';
            }

            coordinators.forEach(coordinator => {
                const assignedModalities = (DB.coordenador_modalidades || [])
                    .filter(link => link.usuario_id === coordinator.id)
                    .map(link => DB.modalidades.find(mod => mod.id === link.modalidade_id))
                    .filter(Boolean);
                const badges = assignedModalities.length
                    ? assignedModalities.map(mod => `<span class="badge badge-secondary">${escapeSportsHtml(mod.nome)}</span>`).join(' ')
                    : '<span class="badge badge-warning">Sem modalidade atribuída</span>';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><b>${escapeSportsHtml(coordinator.nome)}</b><br><small style="color:var(--text-secondary)">${escapeSportsHtml(coordinator.cargo)}</small></td>
                    <td>${escapeSportsHtml(coordinator.email || coordinator.contato || '—')}</td>
                    <td style="display:flex; flex-wrap:wrap; gap:5px;">${badges}</td>
                    <td><button class="btn btn-secondary btn-manage-coordinator" data-user-id="${coordinator.id}" style="padding:6px 10px; font-size:12px;"><i class="fas fa-pen"></i> Gerenciar Modalidades</button></td>`;
                coordinatorsTbody.appendChild(tr);
            });

            coordinatorsTbody.querySelectorAll('.btn-manage-coordinator').forEach(btn => {
                btn.addEventListener('click', () => openCoordinatorModal(btn.dataset.userId));
            });
        }

        // Athlete rows
        const athletesTbody = document.querySelector('#athletes-table tbody');
        if (athletesTbody) {
            athletesTbody.innerHTML = '';

            const modalityFilter = document.getElementById('athlete-filter-modality');
            const statusFilter = document.getElementById('athlete-filter-status');
            if (modalityFilter) {
                const selectedValue = modalityFilter.value;
                modalityFilter.innerHTML = `<option value="">${restrictedUser ? 'Minhas Modalidades' : 'Todas as Modalidades'}</option>`;
                visibleModalities.forEach(mod => modalityFilter.add(new Option(mod.nome, mod.id)));
                modalityFilter.value = visibleModalities.some(mod => mod.id === selectedValue) ? selectedValue : '';
                if (!modalityFilter.dataset.listener) {
                    modalityFilter.addEventListener('change', renderSportsModule);
                    modalityFilter.dataset.listener = 'true';
                }
            }
            if (statusFilter && !statusFilter.dataset.listener) {
                statusFilter.addEventListener('change', renderSportsModule);
                statusFilter.dataset.listener = 'true';
            }
            const selectedModalityId = modalityFilter?.value || '';
            const selectedStatus = statusFilter?.value || '';
            const visibleAthletes = (DB.atletas || []).filter(athlete =>
                (!restrictedUser || managedIds.has(athlete.modalidade_id)) &&
                (!selectedModalityId || athlete.modalidade_id === selectedModalityId) &&
                (!selectedStatus || athlete.status_documentacao === selectedStatus)
            );

            if (!visibleAthletes.length) {
                athletesTbody.innerHTML = `
                    <tr>
                        <td colspan="6">
                            <div class="empty-state">
                                <i class="fas fa-person-running icon-empty"></i>
                                <h3>Nenhum atleta cadastrado</h3>
                                <p>Ainda não há atletas cadastrados neste módulo.</p>
                                <button class="btn-primary" onclick="document.getElementById('enroll-name')?.focus()">+ Cadastrar Atleta</button>
                            </div>
                        </td>
                    </tr>`;
            }

            visibleAthletes.forEach(athlete => {
                const mod = DB.modalidades.find(m => m.id === athlete.modalidade_id);
                const tr = document.createElement('tr');
                
                let statusBadge = '';
                if (athlete.status_documentacao === 'Aprovado') {
                    statusBadge = `<span class="badge badge-success"><i class="fas fa-check-circle"></i> Aprovado (Elegível)</span>`;
                } else if (athlete.status_documentacao === 'Rejeitado') {
                    statusBadge = `<span class="badge badge-danger"><i class="fas fa-times-circle"></i> Rejeitado (Impedido)</span>`;
                } else {
                    statusBadge = `<span class="badge badge-warning"><i class="fas fa-clock"></i> Pendente</span>`;
                }

                tr.innerHTML = `
                    <td><b>${athlete.nome}</b></td>
                    <td><code>${athlete.ra_matricula}</code></td>
                    <td><span class="badge badge-secondary">${mod ? mod.nome : '—'}</span></td>
                    <td>${statusBadge}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button class="btn btn-secondary btn-approve-doc" data-ath-id="${athlete.id}" style="padding:4px 8px; font-size:11px; background:var(--success-glow); color:var(--success);">
                                Validar
                            </button>
                            <button class="btn btn-secondary btn-reject-doc" data-ath-id="${athlete.id}" style="padding:4px 8px; font-size:11px; background:var(--danger-glow); color:var(--danger);">
                                Reprovar
                            </button>
                        </div>
                    </td>
                    <td>
                        <button class="btn btn-secondary btn-delete-athlete" data-ath-id="${athlete.id}" style="padding:4px 8px; font-size:11px; background:var(--danger-glow); color:var(--danger);">
                            <i class="fas fa-trash-alt"></i> Excluir
                        </button>
                    </td>
                `;
                athletesTbody.appendChild(tr);
            });

            // Doc approval button click listeners (tests RN-ESP-01)
            document.querySelectorAll('.btn-approve-doc').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const athId = btn.getAttribute('data-ath-id');
                    await DB_Engine.updateAthleteDocStatus(athId, 'Aprovado');
                });
            });

            document.querySelectorAll('.btn-reject-doc').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const athId = btn.getAttribute('data-ath-id');
                    await DB_Engine.updateAthleteDocStatus(athId, 'Rejeitado');
                });
            });

            // Athlete Delete button listeners
            document.querySelectorAll('.btn-delete-athlete').forEach(btn => {
                btn.addEventListener('click', () => {
                    const athId = btn.getAttribute('data-ath-id');
                    if (confirm('Deseja realmente excluir este atleta? Esta ação é irreversível.')) {
                        DB_Engine.deleteAtleta(athId);
                    }
                });
            });
        }

        // Modalidade select list in athlete enrollment form
        const modSelect = document.getElementById('enroll-mod-select');
        if (modSelect) {
            modSelect.innerHTML = '<option value="">Selecione...</option>';
            visibleModalities.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.innerText = m.nome;
                modSelect.appendChild(opt);
            });
        }

        // Populate coordinators list in modality creation form
        const coordSelect = document.getElementById('mod-coordenador');
        if (coordSelect) {
            coordSelect.innerHTML = '<option value="">Selecione...</option>';
            DB.usuarios.filter(u => ['Coordenador', 'Apoio'].includes(u.cargo)).forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.innerText = `${u.nome} (${u.cargo} / ${u.diretoria})`;
                coordSelect.appendChild(opt);
            });
        }

        // --- ROSTER BUILDER RENDERING ---
        renderRosterBuilder();
    }

    function openCoordinatorModal(userId) {
        const coordinator = (DB.usuarios || []).find(user => user.id === userId);
        const overlay = document.getElementById('coordinator-modal-overlay');
        const title = document.getElementById('coordinator-modal-title');
        const hiddenId = document.getElementById('coordinator-modal-user-id');
        const list = document.getElementById('coordinator-modal-modalities');
        if (!coordinator || !overlay || !title || !hiddenId || !list) return;

        const selectedIds = new Set(getManagedSportsModalityIds(userId));
        title.innerHTML = `<i class="fas fa-users-cog"></i> Atribuir Modalidades - ${escapeSportsHtml(coordinator.nome)}`;
        hiddenId.value = userId;
        list.innerHTML = '';

        const activeModalities = (DB.modalidades || []).filter(mod => mod.ativo !== false && mod.status !== false);
        if (!activeModalities.length) {
            list.innerHTML = '<p style="grid-column:1/-1; color:var(--text-secondary); margin:0;">Nenhuma modalidade ativa está disponível.</p>';
        }
        activeModalities.forEach(modality => {
            const label = document.createElement('label');
            label.className = 'coordinator-modality-option';
            label.innerHTML = `<input type="checkbox" value="${modality.id}" ${selectedIds.has(modality.id) ? 'checked' : ''}><span>${escapeSportsHtml(modality.nome)}</span>`;
            list.appendChild(label);
        });
        overlay.classList.add('active');
    }

    async function saveCoordinatorModalities() {
        const userId = document.getElementById('coordinator-modal-user-id')?.value;
        const saveButton = document.getElementById('btn-save-coordinator-modal');
        if (!userId || !saveButton) return;

        const selectedIds = [...document.querySelectorAll('#coordinator-modal-modalities input:checked')].map(input => input.value);
        const currentIds = getManagedSportsModalityIds(userId);
        const selectedSet = new Set(selectedIds);
        const idsToRemove = currentIds.filter(id => !selectedSet.has(id));
        const rowsToUpsert = selectedIds.map(modalidade_id => ({ usuario_id: userId, modalidade_id }));

        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        try {
            const operations = [];
            if (idsToRemove.length) {
                operations.push(supabase.from('coordenador_modalidades').delete().eq('usuario_id', userId).in('modalidade_id', idsToRemove));
            }
            if (rowsToUpsert.length) {
                operations.push(supabase.from('coordenador_modalidades').upsert(rowsToUpsert, { onConflict: 'usuario_id,modalidade_id' }));
            }
            const results = await Promise.all(operations);
            const failure = results.find(result => result.error)?.error;
            if (failure) throw failure;

            // Atualiza imediatamente a lista e a visão eventualmente restrita do próprio usuário.
            DB.coordenador_modalidades = (DB.coordenador_modalidades || [])
                .filter(link => link.usuario_id !== userId)
                .concat(rowsToUpsert.map(row => ({ id: `${row.usuario_id}-${row.modalidade_id}`, ...row })));
            closeCoordinatorModal();
            refreshAllUI();
            showSportsToast('Modalidades do coordenador atualizadas com sucesso.');
        } catch (error) {
            console.error('[Coordenadores] Erro ao salvar modalidades:', error);
            showSportsToast(`Não foi possível salvar as modalidades: ${error.message || 'tente novamente.'}`, 'error');
        } finally {
            saveButton.disabled = false;
            saveButton.innerHTML = '<i class="fas fa-save"></i> Salvar Modalidades';
        }
    }

    document.getElementById('btn-close-coordinator-modal')?.addEventListener('click', closeCoordinatorModal);
    document.getElementById('btn-cancel-coordinator-modal')?.addEventListener('click', closeCoordinatorModal);
    document.getElementById('coordinator-modal-overlay')?.addEventListener('click', event => {
        if (event.target.id === 'coordinator-modal-overlay') closeCoordinatorModal();
    });
    document.getElementById('btn-save-coordinator-modal')?.addEventListener('click', saveCoordinatorModalities);

    // --- FUNCTION: RENDER ROSTER BUILDER ---
    function renderRosterBuilder() {
        const rosterEvtSelect = document.getElementById('roster-evento-select');
        const rosterModSelect = document.getElementById('roster-mod-select');
        if (!rosterEvtSelect || !rosterModSelect) return;

        // Populate event selector (Aprovado + tipo === Competição)
        if (!rosterEvtSelect.dataset.populated) {
            rosterEvtSelect.innerHTML = '<option value="">Selecione um Evento...</option>';
            const compEvents = DB.eventos.filter(e => e.status_aprovacao === 'Aprovado' && e.tipo === 'Competição');
            compEvents.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.id;
                opt.innerText = e.nome;
                rosterEvtSelect.appendChild(opt);
            });
            rosterEvtSelect.dataset.populated = 'true';
        }

        // Populate modality selector
        if (!rosterModSelect.dataset.populated) {
            rosterModSelect.innerHTML = '<option value="">Selecione uma Modalidade...</option>';
            getVisibleSportsModalities().forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.innerText = m.nome;
                rosterModSelect.appendChild(opt);
            });
            rosterModSelect.dataset.populated = 'true';
        }

        // Listeners for changes in selections
        if (!rosterEvtSelect.dataset.listener) {
            rosterEvtSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                if (selectedSportsEventId !== val) {
                    selectedSportsEventId = val;
                    pendingRoster = []; // Clear pending list
                    renderRosterBuilder();
                }
            });
            rosterEvtSelect.dataset.listener = 'true';
        }

        if (!rosterModSelect.dataset.listener) {
            rosterModSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                if (selectedSportsModalityId !== val) {
                    selectedSportsModalityId = val;
                    pendingRoster = []; // Clear pending list
                    renderRosterBuilder();
                }
            });
            rosterModSelect.dataset.listener = 'true';
        }

        const rosterInterface = document.getElementById('roster-builder-interface');
        const rosterNoSelection = document.getElementById('roster-no-selection');
        const rosterSavedContainer = document.getElementById('roster-saved-container');

        if (!selectedSportsEventId || !selectedSportsModalityId) {
            if (rosterInterface) rosterInterface.style.display = 'none';
            if (rosterSavedContainer) rosterSavedContainer.style.display = 'none';
            if (rosterNoSelection) rosterNoSelection.style.display = 'block';
            return;
        }

        if (rosterInterface) rosterInterface.style.display = 'block';
        if (rosterNoSelection) rosterNoSelection.style.display = 'none';

        // Load existing saved roster into pendingRoster if pendingRoster is empty
        const savedEscalacoes = DB.escalacoes.filter(esc => esc.evento_id === selectedSportsEventId && esc.modalidade_id === selectedSportsModalityId);
        if (pendingRoster.length === 0 && savedEscalacoes.length > 0) {
            savedEscalacoes.forEach(esc => {
                pendingRoster.push({
                    atleta_id: esc.atleta_id,
                    funcao: esc.funcao,
                    observacao: esc.observacao
                });
            });
        }

        // 1. Render Available Athletes (filtered by modality)
        const availableDiv = document.getElementById('roster-available-athletes');
        if (availableDiv) {
            availableDiv.innerHTML = '';
            const modalityAthletes = DB.atletas.filter(a => a.modalidade_id === selectedSportsModalityId);
            
            if (modalityAthletes.length === 0) {
                availableDiv.innerHTML = '<p style="font-size:12px; color:var(--text-secondary); text-align:center; padding:10px;">Nenhum atleta inscrito nesta modalidade.</p>';
            } else {
                modalityAthletes.forEach(ath => {
                    const isIncluded = pendingRoster.some(item => item.atleta_id === ath.id);
                    const card = document.createElement('div');
                    card.className = 'glass-card-item';
                    card.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.02); border-radius:var(--radius-sm); border:1px solid var(--border-glass);';
                    
                    let badge = '';
                    let disabled = false;
                    if (ath.status_documentacao === 'Aprovado') {
                        badge = '<span class="badge badge-success" style="font-size:10px;">🟢 Apto</span>';
                    } else if (ath.status_documentacao === 'Rejeitado') {
                        badge = '<span class="badge badge-danger" style="font-size:10px;">🔴 Reprovado</span>';
                        disabled = true;
                    } else {
                        badge = '<span class="badge badge-warning" style="font-size:10px;">🟡 Pendente</span>';
                        disabled = true;
                    }

                    card.innerHTML = `
                        <div>
                            <div style="font-size:12px; font-weight:bold;">${ath.nome}</div>
                            <div style="font-size:10px; color:var(--text-secondary);">RA: ${ath.ra_matricula} | ${badge}</div>
                        </div>
                        <div>
                            ${isIncluded ? `
                                <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" disabled>
                                    Incluído
                                </button>
                            ` : `
                                <button class="btn btn-accent btn-include-athlete" data-ath-id="${ath.id}" style="padding:4px 8px; font-size:11px;" ${disabled ? 'disabled' : ''}>
                                    <i class="fas fa-plus"></i> Incluir
                                </button>
                            `}
                        </div>
                    `;
                    availableDiv.appendChild(card);
                });

                // Include athlete click listeners
                availableDiv.querySelectorAll('.btn-include-athlete').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const athId = btn.getAttribute('data-ath-id');
                        pendingRoster.push({
                            atleta_id: athId,
                            funcao: 'Titular',
                            observacao: ''
                        });
                        renderRosterBuilder();
                    });
                });
            }
        }

        // 2. Render Roster (pending selection)
        const currentDiv = document.getElementById('roster-current-athletes');
        if (currentDiv) {
            currentDiv.innerHTML = '';
            if (pendingRoster.length === 0) {
                currentDiv.innerHTML = '<p style="font-size:12px; color:var(--text-secondary); text-align:center; padding:10px;">Nenhum atleta incluído nesta escalação ainda.</p>';
            } else {
                pendingRoster.forEach((item, index) => {
                    const ath = DB.atletas.find(a => a.id === item.atleta_id);
                    if (!ath) return;

                    const row = document.createElement('div');
                    row.className = 'glass-card-item';
                    row.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:12px; background:rgba(255,255,255,0.03); border-radius:var(--radius-sm); border:1px solid var(--border-glass);';
                    
                    row.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <span style="font-size:12px; font-weight:bold; color:var(--accent);">${ath.nome}</span>
                                <span style="font-size:10px; color:var(--text-secondary);"> (${ath.ra_matricula})</span>
                            </div>
                            <button class="btn btn-secondary btn-remove-roster" data-index="${index}" style="padding:2px 6px; font-size:10px; background:rgba(239,68,68,0.1); color:#ef4444;">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="form-grid" style="grid-template-columns:1fr 1.5fr; gap:8px; margin-top:4px;">
                            <div class="form-group" style="margin-bottom:0;">
                                <label style="font-size:10px; margin-bottom:2px;">Função</label>
                                <select class="form-control roster-funcao-select" data-index="${index}" style="font-size:11px; padding:4px 8px; height:auto;">
                                    <option value="Titular" ${item.funcao === 'Titular' ? 'selected' : ''}>Titular</option>
                                    <option value="Reserva" ${item.funcao === 'Reserva' ? 'selected' : ''}>Reserva</option>
                                    <option value="Capitão" ${item.funcao === 'Capitão' ? 'selected' : ''}>Capitão</option>
                                    <option value="Staff Técnico" ${item.funcao === 'Staff Técnico' ? 'selected' : ''}>Staff Técnico</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom:0;">
                                <label style="font-size:10px; margin-bottom:2px;">Observação</label>
                                <input type="text" class="form-control roster-obs-input" data-index="${index}" value="${item.observacao || ''}" placeholder="Ex: Camisa 10 / lesão recente..." style="font-size:11px; padding:4px 8px; height:auto;">
                            </div>
                        </div>
                    `;
                    currentDiv.appendChild(row);
                });

                // Bind remove buttons
                currentDiv.querySelectorAll('.btn-remove-roster').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const index = parseInt(btn.getAttribute('data-index'));
                        pendingRoster.splice(index, 1);
                        renderRosterBuilder();
                    });
                });

                // Bind change in function select
                currentDiv.querySelectorAll('.roster-funcao-select').forEach(select => {
                    select.addEventListener('change', (e) => {
                        const idx = parseInt(select.getAttribute('data-index'));
                        pendingRoster[idx].funcao = e.target.value;
                    });
                });

                // Bind change in observation input
                currentDiv.querySelectorAll('.roster-obs-input').forEach(input => {
                    input.addEventListener('input', (e) => {
                        const idx = parseInt(input.getAttribute('data-index'));
                        pendingRoster[idx].observacao = e.target.value;
                    });
                });
            }
        }

        // 3. Render Saved Roster Table
        if (savedEscalacoes.length > 0) {
            if (rosterSavedContainer) rosterSavedContainer.style.display = 'block';
            const tbody = document.querySelector('#roster-saved-table tbody');
            if (tbody) {
                tbody.innerHTML = '';
                savedEscalacoes.forEach(esc => {
                    const ath = DB.atletas.find(a => a.id === esc.atleta_id);
                    const mod = DB.modalidades.find(m => m.id === esc.modalidade_id);
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><b>${ath ? ath.nome : '—'}</b></td>
                        <td><code>${ath ? ath.ra_matricula : '—'}</code></td>
                        <td><span class="badge badge-secondary">${mod ? mod.nome : '—'}</span></td>
                        <td><span class="badge badge-accent">${esc.funcao}</span></td>
                        <td>${esc.observacao || '<span style="color:var(--text-muted);">—</span>'}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else {
            if (rosterSavedContainer) rosterSavedContainer.style.display = 'none';
        }
    }

    // --- EVENT LISTENERS SPORTS MODULE ---
    
    // Handler: Create Modality Form
    const formCreateModality = document.getElementById('form-create-modality');
    if (formCreateModality) {
        formCreateModality.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nome = document.getElementById('mod-nome').value;
            const coordId = document.getElementById('mod-coordenador').value;
            const categoria = document.getElementById('mod-categoria').value;

            if (!nome) {
                alert('Nome da modalidade é obrigatório!');
                return;
            }

            // Nota: a tabela 'modalidades' no Supabase não possui coluna 'categoria'
            // hoje — o valor do campo é mantido só na UI/local até uma migração
            // adicionar essa coluna. Persistimos nome + coordenador_id de verdade.
            logSQL(`INSERT INTO modalidades (nome, coordenador_id) VALUES ('${nome}', '${coordId}');`, 'query');

            const { data, error } = await supabase
                .from('modalidades')
                .insert([{ id: crypto.randomUUID(), nome: nome, coordenador_id: coordId || null }])
                .select()
                .single();

            if (error) {
                console.error('[Modalidades] Erro ao cadastrar:', error);
                logSQL(`Erro ao cadastrar modalidade: ${error.message}`, 'error');
                showDBErrorDialog(error.code || 'ERROR', 'modalidades', error.message);
                return;
            }

            DB.modalidades.push({ ...data, categoria: categoria || null });
            logSQL(`Modalidade '${nome}' cadastrada com sucesso (ID: ${data.id}).`, 'success');

            // Reset fields
            document.getElementById('mod-nome').value = '';
            document.getElementById('mod-coordenador').value = '';

            // Rebuild selects that depend on modalities
            const rosterModSelect = document.getElementById('roster-mod-select');
            if (rosterModSelect) rosterModSelect.removeAttribute('data-populated');
            const enrollModSelect = document.getElementById('enroll-mod-select');
            if (enrollModSelect) enrollModSelect.removeAttribute('data-populated');

            refreshAllUI();
        });
    }

    // Handler: Register Athlete
    const btnEnrollAthlete = document.getElementById('btn-enroll-athlete');
    if (btnEnrollAthlete) {
        // Remove old listener if double defined or just replace
        btnEnrollAthlete.replaceWith(btnEnrollAthlete.cloneNode(true));
        document.getElementById('btn-enroll-athlete').addEventListener('click', async () => {
            const name = document.getElementById('enroll-name').value;
            const ra = document.getElementById('enroll-ra').value;
            const modId = document.getElementById('enroll-mod-select').value;
            const contact = document.getElementById('enroll-contact').value.trim();
            const email = document.getElementById('enroll-email').value.trim();

            if (!name || !ra || !modId) {
                alert('Preencha todos os campos do cadastro do atleta!');
                return;
            }

            if (isSportsRestrictedUser() && !getManagedSportsModalityIds().includes(modId)) {
                showSportsToast('Você só pode cadastrar atletas nas modalidades atribuídas a você.', 'error');
                return;
            }

            logSQL(`INSERT INTO atletas (nome, ra_matricula, modalidade_id, status_documentacao) VALUES ('${name}', '${ra}', '${modId}', 'Pendente');`, 'query');

            const { data, error } = await supabase
                .from('atletas')
                .insert([{
                    id: crypto.randomUUID(),
                    nome: name,
                    ra_matricula: ra,
                    contato: contact || null,
                    email: email || null,
                    modalidade_id: modId,
                    status_documentacao: 'Pendente' // Default is pending for Juridico approval
                }])
                .select()
                .single();

            if (error) {
                console.error('[Atletas] Erro ao cadastrar:', error);
                logSQL(`Erro ao cadastrar atleta: ${error.message}`, 'error');
                showDBErrorDialog(error.code || 'ERROR', 'atletas', error.message);
                return;
            }

            DB.atletas.push(data);
            logSQL(`Atleta cadastrado com sucesso (ID: ${data.id}). Status inicial da documentação: 'Pendente'. Requer análise jurídica para homologação de elegibilidade desportiva (RN-ESP-01).`, 'success');

            document.getElementById('enroll-name').value = '';
            document.getElementById('enroll-ra').value = '';
            document.getElementById('enroll-contact').value = '';
            document.getElementById('enroll-email').value = '';
            refreshAllUI();
        });
    }

    // Handler: Clear Roster
    const btnClearRoster = document.getElementById('btn-clear-roster');
    if (btnClearRoster) {
        btnClearRoster.addEventListener('click', () => {
            pendingRoster = [];
            renderRosterBuilder();
            logSQL('Escalação pendente limpa.', 'success');
        });
    }

    // Handler: Save Roster
    const btnSaveRoster = document.getElementById('btn-save-roster');
    if (btnSaveRoster) {
        btnSaveRoster.addEventListener('click', () => {
            if (!selectedSportsEventId || !selectedSportsModalityId) return;
            if (pendingRoster.length === 0) {
                if (!confirm('Deseja salvar a escalação vazia?')) return;
            }
            DB_Engine.saveEscalacao(selectedSportsEventId, selectedSportsModalityId, pendingRoster);
        });
    }

    // ================================================================
    // MÓDULO: FINANCEIRO / TESOURARIA
    // Extraído para finance.js (window.FinanceModule).
    // O módulo é carregado antes do app.js via <script src="finance.js">.
    // ================================================================

    // ================================================================
    // MÓDULO: PARCERIAS, JURÍDICO & GED
    // Extraído para ged_docs.js (window.GEDModule).
    // O módulo é carregado antes do app.js via <script src="ged_docs.js">.
    // ================================================================

    // ------------------------------------------------------------------------
    // 4. BOOTSTRAP E RENDERIZADOR TOTAL
    // ------------------------------------------------------------------------

    // RENDER: SUPPLIERS & PURCHASE ORDERS (inside Products module)
    function renderProductsSupplyModule() {
        // -- Tabela de Fornecedores --
        const suppliersTbody = document.querySelector('#suppliers-table tbody');
        if (!suppliersTbody) return;
        suppliersTbody.innerHTML = '';

        const filterSelect = document.getElementById('supplier-filter-select');
        if (filterSelect && !filterSelect.dataset.listener) {
            filterSelect.addEventListener('change', () => {
                renderProductsSupplyModule();
            });
            filterSelect.dataset.listener = 'true';
        }

        const filterVal = filterSelect ? filterSelect.value : 'Todos';
        const filteredSuppliers = DB.fornecedores.filter(f => {
            if (filterVal === 'Todos') return true;
            return f.categoria_servico === filterVal;
        });

        if (filteredSuppliers.length === 0) {
            suppliersTbody.innerHTML = `
                <tr>
                    <td colspan="4">
                        <div class="empty-state">
                            <i class="fas fa-truck-loading icon-empty"></i>
                            <h3>Nenhum fornecedor encontrado</h3>
                            <p>${DB.fornecedores.length === 0 ? 'Ainda não há fornecedores cadastrados neste módulo.' : 'Nenhum fornecedor corresponde ao filtro selecionado.'}</p>
                            <button class="btn-primary" onclick="document.getElementById('sup-nome')?.focus()">+ Cadastrar Fornecedor</button>
                        </div>
                    </td>
                </tr>`;
        }

        filteredSuppliers.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${f.nome}</b></td>
                <td>${f.tipo_produto}</td>
                <td><span class="badge badge-secondary">${f.categoria_servico || 'Outros'}</span></td>
                <td>${f.contato ? `${f.contato}` : ''} ${f.telefone ? `<br><code style="font-size:11px;">${f.telefone}</code>` : ''}</td>
            `;
            suppliersTbody.appendChild(tr);
        });

        // -- Tabela de Pedidos de Compra (legado desativado; compras.js é a fonte única) --
        /*
        const ordersTbody = document.querySelector('#orders-table tbody');
        if (!ordersTbody) return;
        ordersTbody.innerHTML = '';
        DB.pedidos_compra.forEach(pc => {
            const fornecedor = DB.fornecedores.find(f => f.id === pc.fornecedor_id);
            const produto = DB.produtos.find(p => p.id === pc.produto_id);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${produto ? produto.nome : '—'}</b> <span class="badge badge-secondary" style="font-size:11px;">${pc.tamanho}</span></td>
                <td>${pc.quantidade}</td>
                <td>${fornecedor ? fornecedor.nome : '—'}</td>
                <td>${pc.data_prevista_entrega || pc.data_previsao || '—'}</td>
                <td>
                    <span class="badge ${pc.status === 'Recebido' ? 'badge-success' : 'badge-warning'}">
                        ${pc.status === 'Recebido' ? '<i class="fas fa-check"></i> Recebido' : '<i class="fas fa-clock"></i> Pendente'}
                    </span>
                </td>
                <td>
                    ${pc.status !== 'Recebido' ? `
                        <button class="btn btn-secondary btn-receive-order" data-pc-id="${pc.id}" style="padding:4px 8px; font-size:11px; background:var(--success-glow); color:var(--success);">
                            <i class="fas fa-box-open"></i> Receber
                        </button>
                    ` : '<span style="font-size:11px; color:var(--text-muted);">Concluído</span>'}
                </td>
            `;
            ordersTbody.appendChild(tr);
        });

        // Receive Order button listeners (simula trigger trg_receber_pedido_compra)
        document.querySelectorAll('.btn-receive-order').forEach(btn => {
            btn.addEventListener('click', () => {
                const pcId = btn.getAttribute('data-pc-id');
                DB_Engine.receberPedidoCompra(pcId);
            });
        });

        */

        // Populate supplier select in order form
        const orderSupplierSelect = document.getElementById('order-supplier-select');
        if (orderSupplierSelect) {
            orderSupplierSelect.innerHTML = '<option value="">Selecione o Fornecedor...</option>';
            DB.fornecedores.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.id;
                opt.innerText = f.nome;
                orderSupplierSelect.appendChild(opt);
            });
        }

        // Populate product select in order form
        const orderProductSelect = document.getElementById('order-product-select');
        if (orderProductSelect) {
            orderProductSelect.innerHTML = '<option value="">Selecione o Produto...</option>';
            DB.produtos.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.innerText = p.nome;
                orderProductSelect.appendChild(opt);
            });
        }
    }

    // Event Handler: Create Supplier
    const formCreateSupplier = document.getElementById('form-create-supplier');
    if (formCreateSupplier) {
        formCreateSupplier.addEventListener('submit', async (e) => {
            e.preventDefault();
            const ok = await DB_Engine.insertFornecedor(
                document.getElementById('sup-nome').value,
                document.getElementById('sup-contato').value,
                document.getElementById('sup-telefone').value,
                document.getElementById('sup-email').value,
                document.getElementById('sup-tipo').value,
                document.getElementById('sup-categoria').value,
                document.getElementById('sup-obs').value
            );
            if (ok) formCreateSupplier.reset();
        });
    }

    // Event Handler: Create Purchase Order
    const formCreateOrder = document.getElementById('form-create-order');
    if (formCreateOrder) {
        formCreateOrder.addEventListener('submit', (e) => {
            e.preventDefault();
            const ok = DB_Engine.insertPedidoCompra(
                document.getElementById('order-supplier-select').value,
                document.getElementById('order-product-select').value,
                document.getElementById('order-size').value,
                parseInt(document.getElementById('order-qty').value) || 0,
                document.getElementById('order-date').value
            );
            if (ok) formCreateOrder.reset();
        });
    }

    function setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-tab');
                if (!targetId) return;
                
                const tabNav = btn.closest('.tab-nav');
                const moduleContainer = tabNav ? tabNav.parentElement : document;
                
                if (tabNav) {
                    tabNav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                }
                
                if (moduleContainer) {
                    moduleContainer.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                }
                
                btn.classList.add('active');
                const targetContent = document.getElementById(targetId);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });
    }

    function setupConnectionBadge() {
        const badge = document.getElementById('connection-status-badge');
        const icon = document.getElementById('conn-icon');
        if (badge && icon) {
            badge.className = 'conn-icon-badge checking-icon';
            icon.className = 'fas fa-circle-notch fa-spin';
            
            setTimeout(() => {
                badge.className = 'conn-icon-badge online-icon';
                icon.className = 'fas fa-check-circle';
            }, 1500);
        }
    }

    function renderNotifications() {
        const notifList = document.getElementById('notifications-list');
        const notifBadge = document.getElementById('notif-badge');
        if (!notifList) return;

        notifList.innerHTML = '';

        const logs = DB.logs_notificacoes.slice().sort((a, b) => b.data_envio.localeCompare(a.data_envio));
        const unreadCount = logs.filter(l => !l.lida).length;

        if (notifBadge) {
            if (unreadCount > 0) {
                notifBadge.style.display = 'flex';
                notifBadge.innerText = unreadCount;
            } else {
                notifBadge.style.display = 'none';
            }
        }

        if (logs.length === 0) {
            notifList.innerHTML = '<div class="notif-empty">Nenhuma notificação no momento.</div>';
            return;
        }

        logs.forEach(log => {
            const isError = log.status_entrega === 'FALHA';
            const isRead = !!log.lida;
            const div = document.createElement('div');
            div.className = `notif-item${isRead ? ' read' : ''}`;

            const gatilhoLabel = {
                'SOLICITACAO_VERBA':    '💸 Solicitação de Verba',
                'ATLETA_BARRADO':       '⚠️ Atleta Irregular',
                'CONTRATO_VENCENDO':    '📄 Contrato Vencendo',
                'TENTATIVA_VIOLACAO':   '🚨 Tentativa de Violação',
                'NOVA_PARCERIA':        '🤝 Nova Parceria',
                'STATUS_PARCERIA_JURIDICO': '📝 Atualização de Parceria'
            }[log.gatilho_regra] || `${log.tipo_notificacao} — ${log.gatilho_regra}`;

            div.innerHTML = `
                <div class="notif-item-header">
                    <span class="notif-item-title">${gatilhoLabel}</span>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span class="notif-item-time">${log.data_envio.substring(0, 16)}</span>
                        ${!isRead ? `<button class="btn-mark-notif-read" data-log-id="${log.id}" title="Marcar como lida"><i class="fas fa-check"></i> Lida</button>` : `<span style="font-size:10px;color:var(--text-muted);"><i class="fas fa-check-double"></i></span>`}
                    </div>
                </div>
                <div class="notif-item-detail">Para: ${log.destinatario_email}</div>
                ${log.erro_detalhe ? `<div class="notif-item-detail" style="color:var(--text-secondary);font-size:11px;">${log.erro_detalhe}</div>` : ''}
                <div>
                    <span class="${isError ? 'notif-status-falha' : 'notif-status-enviado'}">
                        ${isError ? '<i class="fas fa-times-circle"></i> FALHA' : '<i class="fas fa-check-circle"></i> ENVIADO'}
                    </span>
                </div>
            `;

            notifList.appendChild(div);
        });

        // Listener: Marcar notificação como lida
        notifList.querySelectorAll('.btn-mark-notif-read').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const logId = btn.getAttribute('data-log-id');
                const logEntry = DB.logs_notificacoes.find(l => l.id === logId);
                if (logEntry) {
                    logEntry.lida = true;
                    logSQL(`UPDATE logs_notificacoes SET lida = TRUE WHERE id = '${logId}'; -- [SIMULADO: campo lida não é auditável]`, 'query');
                    logSQL(`Notificação '${logEntry.gatilho_regra}' marcada como lida pelo usuário '${currentUser ? currentUser.nome : 'Sistema'}'.`, 'success');
                    renderNotifications();
                }
            });
        });
    }

    // Comportamento do Drawer de Notificações
    const btnNotif = document.getElementById('btn-notifications');
    const drawer = document.getElementById('notifications-drawer');
    const overlay = document.getElementById('notifications-overlay');
    const btnCloseNotif = document.getElementById('btn-close-notifications');

    if (btnNotif && drawer && overlay && btnCloseNotif) {
        btnNotif.addEventListener('click', () => {
            drawer.classList.add('open');
            overlay.classList.add('active');
        });
        
        const closeDrawer = () => {
            drawer.classList.remove('open');
            overlay.classList.remove('active');
        };

        btnCloseNotif.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);
    }

    function refreshAllUI() {
        // Garante que alertas de contratos vencendo são atualizados em tempo real antes de renderizar
        checkContratoVencendoNotifications();

        renderExecutiveDashboard();
        if (window.UserAccess) window.UserAccess.renderAccessModule();
        renderEventsModule();
        renderMarketingModule();
        renderProductsModule();
        renderProductsSupplyModule();
        if (window.renderPedidosCompra) window.renderPedidosCompra();
        renderSportsModule();
        if (window.FinanceModule) window.FinanceModule.renderFinanceModule();
        if (window.GEDModule) {
            window.GEDModule.renderParceriasModule();
            window.GEDModule.renderLegalModule();
        }
        renderNotifications();
        
        // Atualiza a reatividade do calendário do dashboard
        renderDashboardCalendar();
    }

    // ------------------------------------------------------------------------
    // SINCRONIZAÇÃO REALTIME GLOBAL
    // Toda alteração confirmada no Supabase é reconciliada em segundo plano e
    // refletida pelos renderizadores existentes, sem recarregar a página.
    // ------------------------------------------------------------------------
    const realtimeTables = [
        'usuarios', 'eventos', 'tarefas_logistica', 'modalidades', 'atletas',
        'produtos', 'produto_variantes', 'calendario_editorial', 'cronograma_postagens',
        'escalacoes', 'participantes_evento', 'lancamentos_financeiros',
        'parceiros_patrocinadores', 'documentos_contratos', 'logs_notificacoes',
        'fornecedores', 'pedidos_compra', 'pedidos_compra_itens', 'log_recebimentos',
        'diretorias', 'usuario_diretorias', 'permissoes', 'configuracoes_globais',
        'notificacoes_config', 'coordenador_modalidades'
    ];
    let realtimeSyncTimer;
    let realtimeSyncInProgress = false;

    async function reconcileRealtimeChange() {
        if (realtimeSyncInProgress) return;
        realtimeSyncInProgress = true;
        try {
            await window.syncDBFromSupabase();
            refreshAllUI();
        } catch (error) {
            console.error('[Realtime] Não foi possível sincronizar a interface:', error);
        } finally {
            realtimeSyncInProgress = false;
        }
    }

    function scheduleRealtimeSync() {
        clearTimeout(realtimeSyncTimer);
        realtimeSyncTimer = setTimeout(reconcileRealtimeChange, 180);
    }

    const realtimeChannel = supabase.channel('app-global-realtime');
    realtimeTables.forEach(table => {
        realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRealtimeSync);
    });
    realtimeChannel.subscribe(status => {
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] Canal global indisponível. Verifique a publicação das tabelas no Supabase.');
    });
// Bind global para comentários contextuais em qualquer módulo
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.ctx-comments-trigger');
      if (!btn || !currentUser) return;

      const entityType = btn.dataset.entityType;
      const entityId   = btn.dataset.entityId;
      const container  = document.getElementById(`ctx-${entityType}-${entityId}`);

      if (container && typeof ChatModule !== 'undefined') {
        const isVisible = container.innerHTML !== '' && container.style.display !== 'none';
        if (isVisible) {
          container.innerHTML = '';
          container.style.display = 'none';
        } else {
          container.style.display = 'block';
          await ChatModule.renderContextualCommentPanel(entityType, entityId, container);
        }
      }
    });

    // Auto-resize do textarea de chat
    document.addEventListener('input', (e) => {
      if (e.target.id === 'chat-input' || e.target.classList.contains('ctx-comment-input')) {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
      }
    });
    // Inicialização da Fase 5 (Abas e Badge)
    setupTabs();
    setupConnectionBadge();

    // Startup system logs (executados uma vez no carregamento)
    logSQL('SGBD Iniciado. PostgreSQL v16.1 (Debian) em x86_64-pc-linux-gnu.', 'success');
    logSQL('Executando scripts do schema.sql...', 'success');
    logSQL('Compilando triggers.sql: 7 Regras de Negócio rigidamente asseguradas na camada de dados.', 'success');

    // --- CRON SIMULADO: CONTRATO_VENCENDO (Dispara ao abrir o painel) ---
    // Simula o job diário que verifica contratos vencendo em 30 dias.
    function checkContratoVencendoNotifications() {
        const prazo_alerta = window.ConfigModule ? window.ConfigModule.globalConfig.prazo_alerta_contratos : 30;
        const hoje = new Date();
        const limiteDias = new Date(hoje);
        limiteDias.setDate(hoje.getDate() + prazo_alerta);

        DB.documentos_contratos.forEach(dc => {
            if (!dc.data_vencimento) return;
            const venc = new Date(dc.data_vencimento);
            const diffDays = Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays <= prazo_alerta) {
                // Gera notificação apenas se ainda não existe uma para este contrato hoje
                const jaNotificado = DB.logs_notificacoes.some(l =>
                    l.gatilho_regra === 'CONTRATO_VENCENDO' &&
                    l.erro_detalhe && l.erro_detalhe.includes(dc.id) &&
                    l.data_envio.startsWith(hoje.toISOString().substring(0, 10))
                );
                if (!jaNotificado) {
                    const parceiro = DB.parceiros_patrocinadores.find(p => p.id === dc.parceiro_id);
                    const alertEmail = window.getNotificationEmail('CONTRATO_VENCENDO');
                    supabase.from('logs_notificacoes').insert([{
                        usuario_id: 'u1',
                        tipo_notificacao: 'Sistema',
                        gatilho_regra: 'CONTRATO_VENCENDO',
                        destinatario_email: alertEmail,
                        status_entrega: 'ENVIADO',
                        data_envio: hoje.toISOString().replace('T', ' ').substring(0, 16),
                        erro_detalhe: `[doc:${dc.id}] Contrato "${dc.titulo}"${parceiro ? ` (${parceiro.nome_empresa})` : ''} vence em ${diffDays} dia(s), em ${dc.data_vencimento}.`,
                        lida: false
                    }]).then();
                    logSQL(`CRON CONTRATO_VENCENDO: Alerta gerado para o contrato '${dc.titulo}' (vence em ${diffDays} dia(s)).`, 'trigger');
                }
            }
        });
    }


// ================================================================
// MÓDULO: COMUNICAÇÃO — Chat Interno
// Extraído para chat.js (window.ChatModule).
// O módulo é carregado antes do app.js via <script src="chat.js">.
// API: ChatModule.init() | ChatModule.destroy() | ChatModule.openConversation()
// ================================================================


}); // ← fechamento do DOMContentLoaded

