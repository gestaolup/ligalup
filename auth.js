// ============================================================================
// AUTH.JS — Módulo de Autenticação LIGA-LUP
// Responsabilidade: Login, Logout, Restauração de Sessão e Verificação de Conexão.
//
// Contrato de API:
//   window.initAuth(deps) é chamada pelo app.js após toda a infraestrutura
//   de estado (supabase, DB, openApp) estar pronta.
//
// Dependências recebidas via objeto `deps`:
//   - supabase:        cliente do Supabase já instanciado
//   - getDB:           função () => DB — acesso de leitura ao banco em memória
//   - syncDB:          função async () — sincroniza o DB com o Supabase
//   - onLogin:         callback(user) — chamado após autenticação bem-sucedida
//   - logSQL:          função de log SQL do app (para auditoria de login/logout)
//   - setCurrentUser:  função (user) — setter para atualizar currentUser no app.js
// ============================================================================

window.initAuth = function (deps) {
    const { supabase, getDB, syncDB, onLogin, logSQL, setCurrentUser } = deps;

    // -----------------------------------------------------------------------
    // Verifica se o cliente Supabase está disponível e atualiza os badges de
    // status de conexão na tela de login e no header do painel.
    // -----------------------------------------------------------------------
    async function checkBackend() {
        const badge     = document.getElementById('login-status-badge');
        const connBadge = document.getElementById('connection-status-badge');

        let online = false;
        if (typeof window.supabase !== 'undefined') {
            online = true;
        }

        if (online) {
            if (badge) {
                badge.style.display = 'none';
            }
            if (connBadge) {
                connBadge.className = 'badge';
                connBadge.style.cssText = 'padding:6px; background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center;';
                connBadge.innerHTML = '<i class="fas fa-database"></i>';
                connBadge.title = 'Banco de Dados Conectado';
            }
        } else {
            if (badge) {
                badge.style.display = '';
                badge.className = 'login-status-badge offline';
                badge.innerHTML = '<i class="fas fa-exclamation-circle"></i> Banco Local (Simulado)';
            }
            if (connBadge) {
                connBadge.className = 'badge badge-secondary';
                connBadge.style.cssText = 'padding:8px 12px;';
                connBadge.innerHTML = '<i class="fas fa-flask"></i> Ambiente Simulado';
                connBadge.title = '';
            }
        }
    }

    // A autenticação agora depende estritamente do Supabase Auth.
    // -----------------------------------------------------------------------
    // Handler do formulário de login.
    // Fluxo: Supabase Auth → syncDB → busca na tabela usuarios → onLogin(user).
    // Fallback: localAuth (cache em memória) caso o Supabase falhe.
    // -----------------------------------------------------------------------
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email   = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errEl   = document.getElementById('login-error');
        const btnText = document.getElementById('btn-login-text');
        const btnLoad = document.getElementById('btn-login-loading');
        const btn     = document.getElementById('btn-login');

        errEl.style.display = 'none';
        btnText.style.display = 'none';
        btnLoad.style.display = '';
        btn.disabled = true;

        try {
            // 1. Supabase Auth
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email, password
            });

            if (authError) throw authError;

            // 2. Sincroniza o Banco de Dados Inteiro
            await syncDB();

            // 3. Valida se o usuário existe na tabela pública.
            // Usa o UUID real do Auth como id do currentUser para garantir que sender_id do chat é correto.
            const DB = getDB();
            const authUID = authData.user.id;
            let user = DB.usuarios.find(u => u.id === authUID);
            if (!user) {
                // Fallback: busca por email e atualiza o ID para o UUID real
                user = DB.usuarios.find(u => u.email === email);
                if (user) {
                    user.id = authUID; // Corrige o ID local para o UUID real
                }
            }
            if (!user) throw new Error('Seu usuário foi criado no cofre, mas ainda não tem ficha na tabela de usuários. Peça ao Master para criar sua ficha.');

            onLogin(user);

        } catch (err) {
            console.error('Erro no Supabase:', err);
            errEl.textContent = err.message || 'E-mail ou senha inválidos no Supabase.';
            errEl.style.display = 'block';
        }

        btnText.style.display = '';
        btnLoad.style.display = 'none';
        btn.disabled = false;
    });

    // -----------------------------------------------------------------------
    // Toggle show/hide senha no campo de login.
    // -----------------------------------------------------------------------
    document.getElementById('btn-toggle-password').addEventListener('click', () => {
        const pwInput = document.getElementById('login-password');
        const icon    = document.getElementById('pw-eye-icon');
        if (pwInput.type === 'password') {
            pwInput.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            pwInput.type = 'password';
            icon.className = 'fas fa-eye';
        }
    });

    // -----------------------------------------------------------------------
    // Logout: limpa o estado local e retorna à tela de login.
    // -----------------------------------------------------------------------
    document.getElementById('btn-logout').addEventListener('click', () => {
        localStorage.removeItem('lup_token');
        localStorage.removeItem('lup_user');
        setCurrentUser(null);
        document.getElementById('app-wrapper').style.display = 'none';
        document.getElementById('login-screen').style.display = '';
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        logSQL('LOGOUT: Sessão encerrada pelo usuário.', 'trigger');
    });

    // -----------------------------------------------------------------------
    // Inicialização: verifica conexão e tenta restaurar sessão salva no
    // localStorage para evitar que o usuário precise logar novamente.
    // -----------------------------------------------------------------------
    (async () => {
        await checkBackend();
        // Se token válido no localStorage, tenta restaurar sessão
        try {
            const savedUser  = JSON.parse(localStorage.getItem('lup_user'));
            const savedToken = localStorage.getItem('lup_token');
            if (savedUser && savedToken) {
                onLogin(savedUser);
                return;
            }
        } catch { /* ignorar */ }
    })();
};
