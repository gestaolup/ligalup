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
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
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
        logs_notificacoes: [], fornecedores: [], pedidos_compra: [], permissoes: [], notificacoes_config: [], chat_conversations: [
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
        let fallbackEmail = window.currentUser && (window.currentUser.cargo === 'Master' || window.currentUser.cargo === 'Presidente' || window.currentUser.diretoria === 'Presidência')
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
        updateEventStatus: function(eventId, newStatus) {
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
                const isAuthorized = user.diretoria === 'Tesouraria' || user.cargo === 'Master' || user.diretoria === 'Presidência' || user.diretoria === 'Vice-Presidência';
                
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
            event.status_aprovacao = newStatus;
            logSQL(`Event status committed: '${oldStatus}' -> '${newStatus}'`, 'success');
            supabase.from('eventos').update({status_aprovacao: newStatus}).eq('id', eventId).then(({error}) => { if(error) console.error(error); });

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
                
                // Criação automática do lançamento financeiro (Débito/Saída)
                const newFinanceId = 'lf_' + Date.now();
                const financeEntry = {
                    id: newFinanceId,
                    tipo: 'Saída',
                    categoria: 'Logística Evento',
                    valor: event.orcamento_previsto,
                    data_competencia: new Date().toISOString().split('T')[0],
                    status_conciliacao: false,
                    evento_id: event.id,
                    produto_id: null
                };
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
        updateAthleteDocStatus: function(athleteId, newStatus) {
            const athlete = DB.atletas.find(a => a.id === athleteId);
            if (!athlete) return false;

            const oldStatus = athlete.status_documentacao;
            if (oldStatus === newStatus) return true;

            logSQL(`UPDATE atletas SET status_documentacao = '${newStatus}' WHERE id = '${athleteId}';`, 'query');
            logSQL(`Evaluating trg_proteger_documentacao_atleta BEFORE UPDATE...`, 'trigger');

            // RN-ESP-01: Apenas diretoria == 'Jurídico', Master ou Presidência pode alterar documentação
            const user = currentUser;
            const isAuthorized = user.diretoria === 'Jurídico' || user.cargo === 'Master' || user.cargo === 'Presidente' || user.diretoria === 'Presidência';

            if (!isAuthorized) {
                const msg = `Erro 403 (Permissão Negada): O usuário ${user.nome} (${user.cargo}/${user.diretoria}) tentou alterar a documentação de um atleta, mas esta ação é restrita exclusivamente ao departamento JURÍDICO da Atlética.`;
                logSQL(msg, 'error');
                showDBErrorDialog('42501 (Permission Denied)', 'RN-ESP-01 (Elegibilidade Esportiva)', msg);
                return false;
            }

            athlete.status_documentacao = newStatus;
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

        // Simula INSERT em Fornecedores
        insertFornecedor: function(nome, contato, telefone, email, tipo_produto, categoria_servico, obs) {
            logSQL(`INSERT INTO fornecedores (nome, contato, telefone, email, tipo_produto, categoria_servico, obs) VALUES (...);`, 'query');
            if (!nome || !tipo_produto || !categoria_servico) {
                showDBErrorDialog('23502 (Not Null Violation)', 'fornecedores.nome', 'Nome, tipo de produto e categoria são campos obrigatórios.');
                return false;
            }
            const newId = 'f_' + Date.now();
            DB.fornecedores.push({ id: newId, nome, contato, telefone, email, tipo_produto, categoria_servico, obs });
            logSQL(`Fornecedor '${nome}' cadastrado com sucesso (ID: ${newId}).`, 'success');
            refreshAllUI();
            return newId;
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
        insertCronogramaPostagem: function(eventoId, plataforma, tipo_conteudo, data_publicacao, descricao) {
            logSQL(`INSERT INTO cronograma_postagens (evento_id, plataforma, tipo_conteudo, data_publicacao, descricao, status) VALUES ('${eventoId}', '${plataforma}', '${tipo_conteudo}', '${data_publicacao}', '${descricao}', 'Agendado');`, 'query');
            const newId = 'cp_' + Date.now();
            DB.cronograma_postagens.push({
                id: newId,
                evento_id: eventoId,
                plataforma: plataforma,
                tipo_conteudo: tipo_conteudo,
                data_publicacao: data_publicacao.replace('T', ' '),
                descricao: descricao,
                status: 'Agendado'
            });
            logSQL(`Postagem agendada com sucesso (ID: ${newId}).`, 'success');
            refreshAllUI();
            return newId;
        },
        updateCronogramaPostagemStatus: function(postId, status) {
            const post = DB.cronograma_postagens.find(p => p.id === postId);
            if (!post) return false;
            logSQL(`UPDATE cronograma_postagens SET status = '${status}' WHERE id = '${postId}';`, 'query');
            post.status = status;
            logSQL(`Status da postagem '${postId}' atualizado para '${status}'.`, 'success');
            refreshAllUI();
            return true;
        },
        deleteCronogramaPostagem: function(postId) {
            const idx = DB.cronograma_postagens.findIndex(p => p.id === postId);
            if (idx === -1) return false;
            logSQL(`DELETE FROM cronograma_postagens WHERE id = '${postId}';`, 'query');
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
                const newFinanceId = 'lf_' + Date.now();
                const event = DB.eventos.find(e => e.id === eventoId);
                DB.lancamentos_financeiros.push({
                    id: newFinanceId,
                    tipo: 'Entrada',
                    categoria: `Ingresso: ${event ? event.nome : 'Evento'}`,
                    valor: parseFloat(valorCobrado),
                    data_competencia: new Date().toISOString().split('T')[0],
                    status_conciliacao: false,
                    evento_id: eventoId,
                    produto_id: null
                });
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
                
                const newFinanceId = 'lf_' + Date.now();
                const event = DB.eventos.find(e => e.id === part.evento_id);
                DB.lancamentos_financeiros.push({
                    id: newFinanceId,
                    tipo: 'Entrada',
                    categoria: `Ingresso: ${event ? event.nome : 'Evento'}`,
                    valor: part.valor_cobrado,
                    data_competencia: new Date().toISOString().split('T')[0],
                    status_conciliacao: false,
                    evento_id: part.evento_id,
                    produto_id: null
                });
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
            'fornecedores', 'pedidos_compra', 'chat_conversations', 'chat_participants', 'chat_messages', 'diretorias'
        ];

        try {
            for (const table of tables) {
                const { data, error } = await supabase.from(table).select('*');

                // Early Return dentro do loop: loga o erro e avança para a próxima tabela
                if (error) {
                    console.error(`[Sync] Erro ao carregar tabela "${table}":`, error);
                    continue;
                }

                if (data?.length > 0) DB[table] = data;
            }

            // Mapeamento transicional: injeta o nome da diretoria baseado no UUID para a interface
            if (DB.usuarios && DB.diretorias) {
                DB.usuarios.forEach(u => {
                    if (u.diretoria_id) {
                        const dir = DB.diretorias.find(d => d.id === u.diretoria_id);
                        u.diretoria = dir ? dir.nome : 'Sem diretoria';
                    } else {
                        u.diretoria = u.diretoria || 'Sem diretoria';
                    }
                });
            }

            // Garante que a conversa padrão "Geral LUP" existe (seed automático)
            if (!DB.chat_conversations.find(c => c.id === 'conv-1')) {
                const seedConv = { id: 'conv-1', name: 'Geral LUP', type: 'Grupo' };
                DB.chat_conversations.push(seedConv);

                // Fire-and-forget intencional: o seed não deve bloquear o restante do fluxo.
                // Erros são capturados via .catch() explícito (equivalente ao .then() anterior).
                supabase.from('chat_conversations').upsert(seedConv)
                    .catch(err => console.warn('[Sync] Erro ao fazer seed do Geral LUP:', err));
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

    // RENDER 1: EXECUTIVE DASHBOARD
    function renderExecutiveDashboard() {
        // KPIs calculations
        const totalCash = DB.lancamentos_financeiros.reduce((sum, item) => {
            return item.tipo === 'Entrada' ? sum + item.valor : sum - item.valor;
        }, 0);
        
        const countEvents = DB.eventos.filter(e => e.status_aprovacao === 'Aguardando Tesouraria').length;
        
        const prazo_alerta = window.ConfigModule ? window.ConfigModule.globalConfig.prazo_alerta_contratos : 30;
        const countContracts = DB.documentos_contratos.filter(dc => {
            if (!dc.data_vencimento) return false;
            const diffDays = Math.ceil((new Date(dc.data_vencimento) - new Date()) / (1000 * 60 * 60 * 24));
            return diffDays >= 0 && diffDays <= prazo_alerta;
        }).length;
        
        const countAtletasIrregulares = DB.atletas.filter(a => a.status_documentacao === 'Pendente' || a.status_documentacao === 'Rejeitado').length;

        // Populate KPI elements
        document.getElementById('kpi-saldo-caixa').innerText = `R$ ${totalCash.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('kpi-eventos-pendentes').innerText = countEvents;
        document.getElementById('kpi-contratos-vencer').innerText = countContracts;
        document.getElementById('kpi-atletas-irregulares').innerText = countAtletasIrregulares;

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
                approveBtn.addEventListener('click', () => {
                    DB_Engine.updateEventStatus(evt.id, 'Aprovado');
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
            colBody.addEventListener('drop', (e) => {
                e.preventDefault();
                const evtId = e.dataTransfer.getData('text/plain');
                DB_Engine.updateEventStatus(evtId, status);
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
    document.getElementById('form-create-event').addEventListener('submit', (e) => {
        e.preventDefault();
        const nome = document.getElementById('evt-nome').value;
        const data = document.getElementById('evt-data').value;
        const local = document.getElementById('evt-local').value;
        const orcamento = parseFloat(document.getElementById('evt-orcamento').value) || 0;
        const tipo = document.getElementById('evt-tipo').value;
        const taxaBase = parseFloat(document.getElementById('evt-taxa-base').value) || 0;

        const newId = 'e_' + Date.now();
        const event = {
            id: newId,
            nome: nome,
            data_evento: data.replace('T', ' '),
            local: local,
            orcamento_previsto: orcamento,
            status_aprovacao: 'Rascunho',
            tipo: tipo,
            valor_taxa_base: taxaBase,
            criador_id: currentUser.id
        };

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
    function renderMarketingModule() {
        const mktEvtSelect = document.getElementById('mkt-evento-select');
        if (!mktEvtSelect) return;

        // Populate event select with approved events
        const prevSelectValue = selectedMarketingEventId;
        mktEvtSelect.innerHTML = '<option value="">Selecione um Evento...</option>';
        
        const approvedEvents = DB.eventos.filter(e => e.status_aprovacao === 'Aprovado');
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
            mktEvtSelect.addEventListener('change', (e) => {
                selectedMarketingEventId = e.target.value;
                renderMarketingModule();
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
            const posts = DB.cronograma_postagens.filter(p => p.evento_id === selectedMarketingEventId);
            
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
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-post-id');
                        DB_Engine.updateCronogramaPostagemStatus(id, 'Publicado');
                    });
                });

                tbody.querySelectorAll('.btn-cancel-post').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-post-id');
                        DB_Engine.updateCronogramaPostagemStatus(id, 'Cancelado');
                    });
                });

                tbody.querySelectorAll('.btn-delete-post').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-post-id');
                        if (confirm('Tem certeza de que deseja excluir esta postagem? Esta ação é irreversível.')) {
                            DB_Engine.deleteCronogramaPostagem(id);
                        }
                    });
                });
            }
        }
    }

    // Event Handler: Create Marketing Schedule Post
    const formCreatePost = document.getElementById('form-create-post');
    if (formCreatePost) {
        formCreatePost.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!selectedMarketingEventId) {
                alert('Selecione um evento primeiro!');
                return;
            }
            const plataforma = document.getElementById('post-plataforma').value;
            const tipo = document.getElementById('post-tipo').value;
            const data = document.getElementById('post-data').value;
            const desc = document.getElementById('post-descricao').value;

            DB_Engine.insertCronogramaPostagem(selectedMarketingEventId, plataforma, tipo, data, desc);
            formCreatePost.reset();
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
            
            // Injeta o lançamento financeiro automático correspondente à venda
            const finId = 'lf_' + Date.now();
            DB.lancamentos_financeiros.push({
                id: finId,
                tipo: 'Entrada',
                categoria: `Venda ${product.nome} (Qtd: ${quant})`,
                valor: totalVal,
                data_competencia: new Date().toISOString().split('T')[0],
                status_conciliacao: false,
                evento_id: null,
                produto_id: product.id
            });
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
        formManageProduct.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('prod-edit-id').value;
            const nome = document.getElementById('prod-nome').value;
            const custo = parseFloat(document.getElementById('prod-custo').value) || 0;
            const venda = parseFloat(document.getElementById('prod-venda').value) || 0;

            if (id) {
                // Update
                const prod = DB.produtos.find(p => p.id === id);
                if (prod) {
                    prod.nome = nome;
                    prod.preco_custo = custo;
                    prod.preco_venda = venda;
                    logSQL(`UPDATE produtos SET nome='${nome}', preco_custo=${custo}, preco_venda=${venda} WHERE id='${id}';`, 'query');
                }
            } else {
                // Insert
                const newId = 'p_' + Date.now();
                DB.produtos.push({
                    id: newId,
                    nome: nome,
                    preco_custo: custo,
                    preco_venda: venda
                });
                logSQL(`INSERT INTO produtos (nome, preco_custo, preco_venda) VALUES ('${nome}', ${custo}, ${venda});`, 'query');
            }

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

    // RENDER 4: SPORTS & ATHLETES (Fase 4)
    function renderSportsModule() {
        // Modalidades list
        const modalitiesTbody = document.querySelector('#modalities-table tbody');
        if (modalitiesTbody) {
            modalitiesTbody.innerHTML = '';
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

        // Athlete rows
        const athletesTbody = document.querySelector('#athletes-table tbody');
        if (athletesTbody) {
            athletesTbody.innerHTML = '';
            DB.atletas.forEach(athlete => {
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
                btn.addEventListener('click', () => {
                    const athId = btn.getAttribute('data-ath-id');
                    DB_Engine.updateAthleteDocStatus(athId, 'Aprovado');
                });
            });

            document.querySelectorAll('.btn-reject-doc').forEach(btn => {
                btn.addEventListener('click', () => {
                    const athId = btn.getAttribute('data-ath-id');
                    DB_Engine.updateAthleteDocStatus(athId, 'Rejeitado');
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
            DB.modalidades.forEach(m => {
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
            DB.usuarios.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.innerText = `${u.nome} (${u.cargo} / ${u.diretoria})`;
                coordSelect.appendChild(opt);
            });
        }

        // --- ROSTER BUILDER RENDERING ---
        renderRosterBuilder();
    }

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
            DB.modalidades.forEach(m => {
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
        formCreateModality.addEventListener('submit', (e) => {
            e.preventDefault();
            const nome = document.getElementById('mod-nome').value;
            const coordId = document.getElementById('mod-coordenador').value;
            const categoria = document.getElementById('mod-categoria').value;
            
            // Create a custom insertion to include the category!
            logSQL(`INSERT INTO modalidades (nome, coordenador_id, categoria) VALUES ('${nome}', '${coordId}', '${categoria}');`, 'query');
            const newId = 'm_' + Date.now();
            DB.modalidades.push({ id: newId, nome: nome, coordenador_id: coordId || null, categoria: categoria });
            logSQL(`Modalidade '${nome}' de categoria '${categoria}' cadastrada com sucesso.`, 'success');
            
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
        document.getElementById('btn-enroll-athlete').addEventListener('click', () => {
            const name = document.getElementById('enroll-name').value;
            const ra = document.getElementById('enroll-ra').value;
            const modId = document.getElementById('enroll-mod-select').value;

            if (!name || !ra || !modId) {
                alert('Preencha todos os campos do cadastro do atleta!');
                return;
            }

            const newId = 'a_' + Date.now();
            DB.atletas.push({
                id: newId,
                nome: name,
                ra_matricula: ra,
                modalidade_id: modId,
                status_documentacao: 'Pendente' // Default is pending for Juridico approval
            });

            logSQL(`INSERT INTO atletas (nome, ra_matricula, modalidade_id, status_documentacao) VALUES ('${name}', '${ra}', '${modId}', 'Pendente');`, 'query');
            logSQL(`Atleta cadastrado com sucesso. Status inicial da documentação: 'Pendente'. Requer análise jurídica para homologação de elegibilidade desportiva (RN-ESP-01).`, 'success');

            document.getElementById('enroll-name').value = '';
            document.getElementById('enroll-ra').value = '';
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

        // -- Tabela de Pedidos de Compra --
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
                <td>${pc.data_previsao || '—'}</td>
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
        formCreateSupplier.addEventListener('submit', (e) => {
            e.preventDefault();
            const ok = DB_Engine.insertFornecedor(
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

