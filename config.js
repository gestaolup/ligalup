// config.js
// Módulo de Configurações Globais (Exclusivo Master)

window.ConfigModule = (function() {
    let globalConfig = {
        id: 1,
        nome_instituicao: 'Atlética LUP',
        cor_primaria: '#18181b',
        logo_url: '',
        prazo_alerta_contratos: 30,
        remetente_email: 'notificacoes@atleticalup.com.br'
    };

    async function loadConfig() {
        if (!window.supabaseClient) return;
        try {
            const { data, error } = await window.supabaseClient
                .from('configuracoes_globais')
                .select('*')
                .eq('id', 1)
                .single();
            
            if (error && error.code !== 'PGRST116') throw error; // Ignora se não encontrar (usa fallback)
            
            if (data) {
                globalConfig = { ...globalConfig, ...data };
            }
            applyConfig();
            renderDiretorias();
            loadPermissoes();
        } catch (error) {
            console.warn('[ConfigModule] Erro ao carregar configurações globais:', error);
            // Mesmo com erro, aplica os fallbacks para garantir renderização correta
            applyConfig();
            renderDiretorias();
            loadPermissoes();
        }
    }

    function applyConfig() {
        // Hex to RGBA logic for glow
        let hex = globalConfig.cor_primaria.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        let r = parseInt(hex.substring(0, 2), 16) || 234;
        let g = parseInt(hex.substring(2, 4), 16) || 88;
        let b = parseInt(hex.substring(4, 6), 16) || 12;

        // Aplica cores no :root
        document.documentElement.style.setProperty('--primary', globalConfig.cor_primaria);
        document.documentElement.style.setProperty('--accent', globalConfig.cor_primaria);
        document.documentElement.style.setProperty('--primary-glow', `rgba(${r}, ${g}, ${b}, 0.35)`);
        
        // Atualiza textos no Header principal e Sidebar
        const headerTitle = document.querySelector('.header-title h2');
        if (headerTitle) headerTitle.innerText = globalConfig.nome_instituicao;
        
        const sidebarTitle = document.querySelector('.logo-text h1');
        if (sidebarTitle) sidebarTitle.innerText = globalConfig.nome_instituicao;
        
        // Atualiza o Logo, se existir
        const logoIcon = document.querySelector('.logo-icon img');
        if (logoIcon && globalConfig.logo_url) logoIcon.src = globalConfig.logo_url;
        
        // Preenche os campos do formulário para edição
        const formNome = document.getElementById('config-nome-instituicao');
        if (formNome) formNome.value = globalConfig.nome_instituicao;
        
        const formCor = document.getElementById('config-cor-primaria');
        if (formCor) formCor.value = globalConfig.cor_primaria;
        
        const formCorPicker = document.getElementById('config-cor-primaria-picker');
        if (formCorPicker) formCorPicker.value = globalConfig.cor_primaria;
        
        const formPrazo = document.getElementById('config-prazo-alerta');
        if (formPrazo) formPrazo.value = globalConfig.prazo_alerta_contratos;
        
        const formEmail = document.getElementById('config-remetente-email');
        if (formEmail) formEmail.value = globalConfig.remetente_email;
        
        const formLogo = document.getElementById('config-logo-url');
        if (formLogo) formLogo.value = globalConfig.logo_url || '';
    }

    async function saveConfig(e) {
        e.preventDefault();
        
        const btn = document.getElementById('btn-save-config');
        const msg = document.getElementById('config-save-message');
        const originalText = btn.innerHTML;
        
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        btn.disabled = true;
        msg.style.display = 'none';

        const updatedData = {
            nome_instituicao: document.getElementById('config-nome-instituicao').value,
            cor_primaria: document.getElementById('config-cor-primaria').value,
            prazo_alerta_contratos: parseInt(document.getElementById('config-prazo-alerta').value, 10),
            remetente_email: document.getElementById('config-remetente-email').value,
            logo_url: document.getElementById('config-logo-url').value,
            updated_at: new Date().toISOString()
        };

        try {
            const { error } = await window.supabaseClient
                .from('configuracoes_globais')
                .update(updatedData)
                .eq('id', 1);

            if (error) throw error;

            globalConfig = { ...globalConfig, ...updatedData };
            applyConfig();

            msg.innerText = 'Configurações salvas com sucesso!';
            msg.style.color = 'var(--success)';
            msg.style.display = 'block';
        } catch (error) {
            console.error('[ConfigModule] Erro ao salvar:', error);
            msg.innerText = 'Erro ao salvar. Apenas a conta Master ou Presidência têm permissão.';
            msg.style.color = 'var(--danger)';
            msg.style.display = 'block';
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
            setTimeout(() => { msg.style.display = 'none'; }, 5000);
        }
    }

    function init() {
        const form = document.getElementById('form-master-config');
        if (form) form.addEventListener('submit', saveConfig);

        const colorPicker = document.getElementById('config-cor-primaria-picker');
        const colorInput = document.getElementById('config-cor-primaria');

        if (colorPicker && colorInput) {
            colorPicker.addEventListener('input', (e) => {
                colorInput.value = e.target.value;
            });
            colorInput.addEventListener('input', (e) => {
                if (/^#[0-9A-Fa-f]{6}$/i.test(e.target.value)) {
                    colorPicker.value = e.target.value;
                }
            });
        }

        const btnNova = document.getElementById('btn-nova-diretoria');
        const formNovaContainer = document.getElementById('form-nova-diretoria-container');
        const formNova = document.getElementById('form-nova-diretoria');

        if (btnNova && formNovaContainer) {
            btnNova.addEventListener('click', () => {
                formNovaContainer.style.display = formNovaContainer.style.display === 'none' ? 'block' : 'none';
            });
        }
        if (formNova) {
            formNova.addEventListener('submit', handleAddDiretoria);
        }

        const tabDiretorias = document.getElementById('tab-diretorias');
        const tabPermissoes = document.getElementById('tab-permissoes');
        const contentDiretorias = document.getElementById('content-diretorias');
        const contentPermissoes = document.getElementById('content-permissoes');

        if (tabDiretorias && tabPermissoes) {
            tabDiretorias.addEventListener('click', () => {
                tabDiretorias.classList.add('active');
                tabDiretorias.style.color = 'var(--primary)';
                tabDiretorias.style.borderBottom = '2px solid var(--primary)';
                
                tabPermissoes.classList.remove('active');
                tabPermissoes.style.color = 'var(--text-secondary)';
                tabPermissoes.style.borderBottom = 'none';

                contentDiretorias.style.display = 'block';
                contentPermissoes.style.display = 'none';
            });

            tabPermissoes.addEventListener('click', () => {
                tabPermissoes.classList.add('active');
                tabPermissoes.style.color = 'var(--primary)';
                tabPermissoes.style.borderBottom = '2px solid var(--primary)';
                
                tabDiretorias.classList.remove('active');
                tabDiretorias.style.color = 'var(--text-secondary)';
                tabDiretorias.style.borderBottom = 'none';

                contentDiretorias.style.display = 'none';
                contentPermissoes.style.display = 'block';
            });
        }
    }

    function renderDiretorias() {
        const tbody = document.getElementById('lista-diretorias-master');
        if (!tbody) return;

        const diretorias = (window.DB && window.DB.diretorias) ? window.DB.diretorias : [];
        
        if (diretorias.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 24px;">Nenhuma diretoria cadastrada</td></tr>';
            return;
        }

        tbody.innerHTML = diretorias.map(d => `
            <tr>
                <td>${d.nome}</td>
                <td>
                    <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: ${d.ativa ? 'rgba(46, 213, 115, 0.1)' : 'rgba(255, 71, 87, 0.1)'}; color: ${d.ativa ? '#2ed573' : '#ff4757'}">
                        ${d.ativa ? 'Ativa' : 'Inativa'}
                    </span>
                </td>
                <td style="text-align:right;">
                    <button class="btn btn-sm btn-secondary" onclick="window.ConfigModule.toggleDiretoria('${d.id}', ${!d.ativa})">
                        <i class="fas fa-${d.ativa ? 'ban' : 'check'}"></i> ${d.ativa ? 'Desativar' : 'Ativar'}
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async function toggleDiretoria(id, newStatus) {
        if (!confirm(`Deseja realmente ${newStatus ? 'ativar' : 'desativar'} esta diretoria?`)) return;
        
        try {
            const { error } = await window.supabaseClient
                .from('diretorias')
                .update({ ativa: newStatus })
                .eq('id', id);
            
            if (error) throw error;
            
            await window.syncDBFromSupabase();
            renderDiretorias();
        } catch (error) {
            console.error('Erro ao alternar status da diretoria:', error);
            alert('Erro ao alterar o status. Apenas usuários Master ou Presidência têm permissão.');
        }
    }

    async function handleAddDiretoria(e) {
        e.preventDefault();
        const nomeInput = document.getElementById('nova-diretoria-nome');
        const nome = nomeInput.value.trim();
        if (!nome) return;

        const btn = document.getElementById('btn-save-diretoria');
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
        btn.disabled = true;

        try {
            const newDir = {
                id: crypto.randomUUID(),
                nome: nome,
                ativa: true,
                created_at: new Date().toISOString()
            };

            const { error } = await window.supabaseClient
                .from('diretorias')
                .insert([newDir]);
            
            if (error) throw error;
            
            nomeInput.value = '';
            document.getElementById('form-nova-diretoria-container').style.display = 'none';
            
            await window.syncDBFromSupabase();
            renderDiretorias();
        } catch (error) {
            console.error('Erro ao criar diretoria:', error);
            alert('Erro ao criar diretoria. Verifique suas permissões (Master ou Presidência).');
        } finally {
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    // Mapeamento Funcional Estruturado por Categoria / Módulo
    const CATEGORIAS_PERMISSOES = [
        {
            modulo: 'mod-dashboard',
            titulo: 'Dashboard Executivo',
            icone: 'fas fa-chart-line',
            acoes: [
                { id: 'mod-dashboard', label: 'Visualizar Dashboard', sublabel: 'Acesso e visualização de KPIs, indicadores e calendário' },
                { id: 'mod-dashboard:export', label: 'Exportar Relatórios Executivos', sublabel: 'Download de demonstrativos gerenciais e dados da Atlética' }
            ]
        },
        {
            modulo: 'mod-eventos',
            titulo: 'Diretoria de Eventos',
            icone: 'fas fa-calendar-alt',
            acoes: [
                { id: 'mod-eventos', label: 'Visualizar Módulo Eventos', sublabel: 'Acesso à lista de eventos e cronograma logístico' },
                { id: 'mod-eventos:create', label: 'Criar Eventos', sublabel: 'Cadastrar novos eventos em modo rascunho' },
                { id: 'mod-eventos:edit', label: 'Editar Eventos', sublabel: 'Alterar datas, locais, informações e orçamentos previstos' },
                { id: 'aprovar_evento', label: 'Aprovar Orçamento de Eventos', sublabel: 'Autorização e liberação financeira final de eventos' },
                { id: 'mod-eventos:delete', label: 'Excluir / Cancelar Eventos', sublabel: 'Cancelar ou remover eventos cadastrados' }
            ]
        },
        {
            modulo: 'mod-marketing',
            titulo: 'Diretoria de Marketing',
            icone: 'fas fa-bullhorn',
            acoes: [
                { id: 'mod-marketing', label: 'Visualizar Módulo Marketing', sublabel: 'Acesso às campanhas e ao calendário editorial' },
                { id: 'mod-marketing:create', label: 'Criar Posts & Campanhas', sublabel: 'Agendar novas publicações e conteúdos' },
                { id: 'mod-marketing:edit', label: 'Editar Campanhas', sublabel: 'Alterar datas, mídias e artes das postagens' },
                { id: 'mod-marketing:delete', label: 'Remover Postagens', sublabel: 'Excluir posts agendados do calendário' }
            ]
        },
        {
            modulo: 'mod-produtos',
            titulo: 'Produtos & Estoque (Loja)',
            icone: 'fas fa-box-open',
            acoes: [
                { id: 'mod-produtos', label: 'Visualizar Produtos & Estoque', sublabel: 'Acesso ao catálogo de produtos e unidades em estoque' },
                { id: 'mod-produtos:create', label: 'Cadastrar Produtos', sublabel: 'Adicionar novos itens à loja oficial' },
                { id: 'gerenciar_estoque', label: 'Gerenciar Estoque & Variantes', sublabel: 'Ajustar estoque por variante (tamanhos P/M/G)' },
                { id: 'mod-produtos:delete', label: 'Excluir Produtos', sublabel: 'Remover itens do catálogo e do estoque' }
            ]
        },
        {
            modulo: 'mod-esportes',
            titulo: 'Esportes & Atletas',
            icone: 'fas fa-running',
            acoes: [
                { id: 'mod-esportes', label: 'Visualizar Módulo Esportes', sublabel: 'Acesso às modalidades, times e atletas' },
                { id: 'mod-esportes:create', label: 'Cadastrar Atletas & Escalações', sublabel: 'Inscrever novos atletas e vincular modalidades' },
                { id: 'validar_atleta', label: 'Validar Documentação de Atletas', sublabel: 'Aprovar ou reprovar atestados e documentos de atletas' },
                { id: 'mod-esportes:edit', label: 'Editar Ficha do Atleta', sublabel: 'Alterar informações acadêmicas e de saúde dos atletas' }
            ]
        },
        {
            modulo: 'mod-financeiro',
            titulo: 'Tesouraria & Caixa',
            icone: 'fas fa-wallet',
            acoes: [
                { id: 'mod-financeiro', label: 'Visualizar Tesouraria & Caixa', sublabel: 'Acesso ao livro caixa e extrato de lançamentos' },
                { id: 'mod-financeiro:create', label: 'Lançar Entradas & Saídas', sublabel: 'Inserir novas movimentações financeiras no caixa' },
                { id: 'editar_financas', label: 'Editar Finanças & Conciliação', sublabel: 'Alterar lançamentos e realizar conciliação bancária' },
                { id: 'mod-financeiro:export', label: 'Exportar Extrato Financeiro', sublabel: 'Download do demonstrativo do livro caixa' }
            ]
        },
        {
            modulo: 'mod-parcerias',
            titulo: 'Diretoria de Parcerias',
            icone: 'fas fa-handshake',
            acoes: [
                { id: 'mod-parcerias', label: 'Visualizar Funil de Parcerias', sublabel: 'Acesso ao CRM e lista de patrocinadores' },
                { id: 'mod-parcerias:create', label: 'Cadastrar Novos Parceiros', sublabel: 'Adicionar empresas ao funil de negociação' },
                { id: 'mod-parcerias:edit', label: 'Atualizar Etapas do Funil', sublabel: 'Avançar parceiros nas fases da negociação' },
                { id: 'mod-parcerias:delete', label: 'Arquivar / Excluir Parcerias', sublabel: 'Remover patrocinadores do funil de vendas' }
            ]
        },
        {
            modulo: 'mod-legal',
            titulo: 'Jurídico & GED',
            icone: 'fas fa-file-contract',
            acoes: [
                { id: 'mod-legal', label: 'Visualizar Jurídico & GED', sublabel: 'Acesso ao repositório de contratos e arquivos legais' },
                { id: 'mod-legal:create', label: 'Upload de Contratos & Documentos', sublabel: 'Anexar novos contratos e minutas jurídicas no GED' },
                { id: 'editar_documentos', label: 'Editar Status & Contratos', sublabel: 'Alterar prazos, parceiros e termos contratuais' },
                { id: 'mod-legal:delete', label: 'Excluir Documentos do GED', sublabel: 'Remover arquivos salvos no repositório' }
            ]
        },
        {
            modulo: 'mod-comunicacao',
            titulo: 'Comunicação Interna',
            icone: 'fas fa-comments',
            acoes: [
                { id: 'mod-comunicacao', label: 'Visualizar Painel de Comunicação', sublabel: 'Acesso aos avisos e mural interno' },
                { id: 'mod-comunicacao:create', label: 'Disparar Comunicados Gerais', sublabel: 'Publicar avisos importantes para toda a diretoria' }
            ]
        }
    ];

    let localPermissoes = [];

    async function loadPermissoes() {
        if (!window.supabaseClient) return;
        try {
            const { data, error } = await window.supabaseClient.from('permissoes').select('*');
            if (error) throw error;
            localPermissoes = data || [];
            if (window.DB) window.DB.permissoes = localPermissoes;
        } catch (error) {
            console.warn('[ConfigModule] Tabela permissoes pode não existir ainda ou erro de acesso:', error);
            localPermissoes = (window.DB && window.DB.permissoes) ? window.DB.permissoes : [];
        }
        renderPermissoesMatrix();
    }

    function renderPermissoesMatrix() {
        const tbody = document.getElementById('lista-permissoes-master');
        if (!tbody) return;

        const activeDirectorias = (window.DB && window.DB.diretorias)
            ? window.DB.diretorias.filter(d => d.ativa)
            : [];

        const totalCols = 2 + activeDirectorias.length; // 1 Funcionalidade + 1 Master + N Diretorias

        const theadRow = document.getElementById('thead-permissoes-master');
        if (theadRow) {
            let ths = '<th style="min-width: 320px; text-align: left; padding: 12px 16px;">Módulos & Funcionalidades Operacionais</th>';
            ths += `<th style="text-align:center; min-width: 120px; padding: 12px 8px;">Master (Cargo)</th>`;
            activeDirectorias.forEach(dir => {
                ths += `<th style="text-align:center; min-width: 130px; padding: 12px 8px;">${dir.nome}</th>`;
            });
            theadRow.innerHTML = ths;
        }

        let matrixHtml = '';

        CATEGORIAS_PERMISSOES.forEach(cat => {
            // Subcabeçalho de Módulo com visual destacado
            matrixHtml += `
            <tr class="perm-category-header" style="background: rgba(212, 175, 55, 0.12); border-top: 2px solid rgba(212, 175, 55, 0.3); border-bottom: 1px solid rgba(212, 175, 55, 0.2);">
                <td colspan="${totalCols}" style="padding: 10px 16px; font-weight: 700; color: #D4AF37; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">
                    <i class="${cat.icone}" style="margin-right: 8px;"></i> ${cat.titulo}
                </td>
            </tr>`;

            // Linhas das Ações Operacionais da Categoria
            cat.acoes.forEach(acao => {
                matrixHtml += `<tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                    <td style="padding: 10px 16px 10px 28px;">
                        <strong style="color: var(--text-primary, #ffffff); font-size: 13px;">${acao.label}</strong>
                        <br>
                        <small style="color: var(--text-secondary, #94a3b8); font-size: 11px;">${acao.sublabel}</small>
                        <span style="font-size: 10px; color: rgba(212, 175, 55, 0.7); font-family: monospace; display: block; margin-top: 2px;">[Chave: ${acao.id}]</span>
                    </td>
                    
                    <!-- Coluna Master (Sempre concedida, imutável) -->
                    <td style="text-align:center; vertical-align: middle;">
                        <input type="checkbox" checked disabled
                               title="Acesso incondicional concedido ao Master"
                               style="accent-color: #D4AF37; transform: scale(1.25); cursor: not-allowed;">
                    </td>`;

                activeDirectorias.forEach(dir => {
                    const isPresidency = dir.nome === 'Presidência' || dir.nome === 'Vice-Presidência';
                    const perm = localPermissoes.find(p => p.acao_sistema === acao.id && p.diretoria_id === dir.id);
                    const isConcedida = isPresidency ? true : (perm ? perm.concedida : false);

                    matrixHtml += `
                    <td style="text-align:center; vertical-align: middle;">
                        <input type="checkbox" 
                               ${isConcedida ? 'checked' : ''} 
                               ${isPresidency ? 'disabled' : ''}
                               title="${isPresidency ? 'Acesso incondicional do Núcleo Executivo' : `Permissão ${acao.id} para ${dir.nome}`}"
                               onchange="window.ConfigModule.togglePermissao('${acao.id}', '${dir.id}', this.checked)"
                               style="accent-color: #D4AF37; transform: scale(1.25); cursor: ${isPresidency ? 'not-allowed' : 'pointer'};">
                    </td>`;
                });

                matrixHtml += `</tr>`;
            });
        });

        tbody.innerHTML = matrixHtml;
    }

    async function togglePermissao(acao_id, diretoria_id, isConcedida) {
        try {
            let perm = localPermissoes.find(p => p.acao_sistema === acao_id && p.diretoria_id === diretoria_id);
            
            if (perm) {
                const { error } = await window.supabaseClient
                    .from('permissoes')
                    .update({ concedida: isConcedida })
                    .eq('id', perm.id);
                if (error) throw error;
                perm.concedida = isConcedida;
            } else {
                const { data, error } = await window.supabaseClient
                    .from('permissoes')
                    .insert([{ acao_sistema: acao_id, diretoria_id: diretoria_id, concedida: isConcedida }])
                    .select();
                if (error) throw error;
                if (data && data.length > 0) {
                    localPermissoes.push(data[0]);
                } else {
                    localPermissoes.push({ acao_sistema: acao_id, diretoria_id: diretoria_id, concedida: isConcedida });
                }
            }

            // Sincroniza em memória no DB global para atualização imediata
            if (window.DB) {
                window.DB.permissoes = localPermissoes;
            }

        } catch (error) {
            console.error('[ConfigModule] Erro ao alternar permissão:', error);
            alert('Erro ao alterar permissão no banco de dados. Verifique a conexão.');
            renderPermissoesMatrix();
        }
    }

    return {
        init,
        loadConfig,
        renderDiretorias,
        toggleDiretoria,
        togglePermissao,
        get globalConfig() { return globalConfig; }
    };
})();
