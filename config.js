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

    // --- Permissões Matrix ---
    const ACOES_SISTEMA = [
        { id: 'aprovar_evento', label: 'Aprovar Eventos' },
        { id: 'criar_usuario', label: 'Criar Usuários' },
        { id: 'excluir_usuario', label: 'Excluir Usuários' },
        { id: 'editar_financas', label: 'Editar Finanças' },
        { id: 'editar_documentos', label: 'Editar Documentos Jurídicos' },
        { id: 'gerenciar_estoque', label: 'Gerenciar Estoque' }
    ];

    // Removido: const CARGOS = ['Master', 'Presidente', 'Vice-Presidente', 'Diretor', 'Membro'];

    let localPermissoes = [];

    async function loadPermissoes() {
        if (!window.supabaseClient) return;
        try {
            const { data, error } = await window.supabaseClient.from('permissoes').select('*');
            if (error) throw error;
            localPermissoes = data || [];
        } catch (error) {
            console.warn('[ConfigModule] Tabela permissoes pode não existir ainda ou erro de acesso:', error);
            localPermissoes = [];
        }
        renderPermissoesMatrix();
    }

    function renderPermissoesMatrix() {
        const tbody = document.getElementById('lista-permissoes-master');
        if (!tbody) return;

        const theadRow = document.getElementById('thead-permissoes-master');
        if (theadRow) {
            let ths = '<th>Módulos (Ação de Sistema)</th>';
            ths += `<th style="text-align:center;">Master (Cargo)</th>`; // Coluna especial do Master
            if (window.DB && window.DB.diretorias) {
                window.DB.diretorias.filter(d => d.ativa).forEach(dir => {
                    ths += `<th style="text-align:center;">${dir.nome}</th>`;
                });
            }
            theadRow.innerHTML = ths;
        }

        if (!window.DB || !window.DB.diretorias) return;

        tbody.innerHTML = ACOES_SISTEMA.map(acao => {
            let rowHtml = `<tr><td><strong>${acao.label}</strong><br><small style="color:var(--text-secondary)">${acao.id}</small></td>`;
            
            // Coluna do Master (Sempre concedida, imutável)
            rowHtml += `
            <td style="text-align:center;">
                <input type="checkbox" checked disabled
                       style="accent-color: var(--primary); transform: scale(1.3); cursor: not-allowed;">
            </td>`;
            
            window.DB.diretorias.filter(d => d.ativa).forEach(dir => {
                const isPresidency = dir.nome === 'Presidência' || dir.nome === 'Vice-Presidência';
                const perm = localPermissoes.find(p => p.acao_sistema === acao.id && p.diretoria_id === dir.id);
                const isConcedida = isPresidency ? true : (perm ? perm.concedida : false);
                
                rowHtml += `
                <td style="text-align:center;">
                    <input type="checkbox" 
                           ${isConcedida ? 'checked' : ''} 
                           ${isPresidency ? 'disabled' : ''}
                           onchange="window.ConfigModule.togglePermissao('${acao.id}', '${dir.id}', this.checked)"
                           style="accent-color: var(--primary); transform: scale(1.3); cursor: ${isPresidency ? 'not-allowed' : 'pointer'};">
                </td>`;
            });
            
            rowHtml += `</tr>`;
            return rowHtml;
        }).join('');
    }

    async function togglePermissao(acao_id, diretoria_id, isConcedida) {
        try {
            const perm = localPermissoes.find(p => p.acao_sistema === acao_id && p.diretoria_id === diretoria_id);
            
            if (perm) {
                const { error } = await window.supabaseClient
                    .from('permissoes')
                    .update({ concedida: isConcedida })
                    .eq('id', perm.id);
                if (error) throw error;
                perm.concedida = isConcedida;
            } else {
                const { error } = await window.supabaseClient
                    .from('permissoes')
                    .insert([{ acao_sistema: acao_id, diretoria_id: diretoria_id, concedida: isConcedida }]);
                if (error) throw error;
                await loadPermissoes();
            }
        } catch (error) {
            console.error('[ConfigModule] Erro ao alternar permissão:', error);
            alert('Erro ao alterar permissão. Verifique se a tabela foi criada no banco.');
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
