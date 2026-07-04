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
        } catch (error) {
            console.warn('[ConfigModule] Erro ao carregar configurações globais:', error);
            // Mesmo com erro, aplica os fallbacks para garantir renderização correta
            applyConfig();
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
            msg.innerText = 'Erro ao salvar. Apenas a conta Master tem permissão.';
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
    }

    return {
        init,
        loadConfig
    };
})();
