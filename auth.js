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

    const setVisible = (id, visible) => {
        const element = document.getElementById(id);
        if (element) element.style.display = visible ? '' : 'none';
    };
    const showLogin = () => {
        setVisible('app-wrapper', false);
        setVisible('login-screen', true);
    };

    // Nunca mostra a tela de login antes de a sessão ser verificada.
    setVisible('login-screen', false);
    setVisible('app-wrapper', false);

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

    async function restoreAuthenticatedUser(authUser) {
        await syncDB();
        const DB = getDB();
        const user = DB.usuarios.find(u => u.id === authUser.id) ||
            DB.usuarios.find(u => u.email === authUser.email);
        if (!user) throw new Error('Usuário autenticado sem ficha correspondente na tabela de usuários.');

        const hydratedUser = { ...user, id: authUser.id, email: authUser.email || user.email };
        const linked = (DB.usuario_diretorias || [])
            .filter(ud => ud.usuario_id === authUser.id)
            .map(ud => ud.diretoria_id);
        hydratedUser.diretorias_ids = [...new Set([hydratedUser.diretoria_id, ...linked].filter(Boolean))];
        return hydratedUser;
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

            // 4. Verifica se a conta está ativa antes de conceder acesso
            if (user.status === false || user.status === 'false' || user.status === 0) {
                // Encerra a sessão recém-criada no Supabase Auth imediatamente
                await supabase.auth.signOut();
                throw new Error('Esta conta está desativada. Entre em contato com o administrador do sistema.');
            }

            // Sprint 1: Garante a hidratação do array de diretorias vinculadas (primária + secundárias)
            if (!user.diretorias_ids || user.diretorias_ids.length === 0) {
                const linked = (DB.usuario_diretorias || [])
                    .filter(ud => ud.usuario_id === user.id)
                    .map(ud => ud.diretoria_id);
                const allIds = new Set();
                if (user.diretoria_id) allIds.add(user.diretoria_id);
                linked.forEach(id => { if (id) allIds.add(id); });
                user.diretorias_ids = Array.from(allIds);
            }

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
    document.getElementById('btn-logout').addEventListener('click', async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Não foi possível encerrar a sessão:', error);
            alert('Não foi possível encerrar a sessão. Tente novamente.');
            return;
        }
        localStorage.removeItem('lup_token');
        localStorage.removeItem('lup_user');
        setCurrentUser(null);
        showLogin();
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
            const { data: { session }, error } = await supabase.auth.getSession();
            if (error) throw error;
            if (session?.user) {
                const restoredUser = await restoreAuthenticatedUser(session.user);
                // Bloqueia restauração de sessão para contas desativadas
                if (restoredUser.status === false || restoredUser.status === 'false' || restoredUser.status === 0) {
                    await supabase.auth.signOut();
                    showLogin();
                    const errEl = document.getElementById('login-error');
                    if (errEl) {
                        errEl.textContent = 'Esta conta está desativada. Entre em contato com o administrador do sistema.';
                        errEl.style.display = 'block';
                    }
                } else {
                    onLogin(restoredUser);
                }
            } else {
                showLogin();
            }
        } catch (error) {
            console.warn('Não foi possível restaurar a sessão:', error);
            showLogin();
        }
    })();
};
