// ============================================================================
// USER_ACCESS.JS — Módulo de Usuários e Controle de Acessos — LIGA-LUP
//
// Responsabilidade: Gestão de permissões de escrita e visualização, controle
// de visibilidade de navegação (applyNavPermissions), modo somente leitura
// (applyReadonlyMode), renderização da listagem de acessos (renderAccessModule),
// cadastro/edição de membros e atualização de perfil individual.
//
// Contrato de API:
//   window.initUserAccess(deps) é chamada pelo app.js após toda a infraestrutura
//   de estado (DB, DB_Engine) estar pronta.
// ============================================================================

window.initUserAccess = function(deps) {
    const {
        supabase,
        getDB,
        getDBEngine,
        getCurrentUser,
        setCurrentUser,
        logSQL,
        refreshAllUI
    } = deps;

    // -----------------------------------------------------------------------
    // MAPEAMENTO DE PERMISSÕES DE ESCRITA POR MÓDULO
    // -----------------------------------------------------------------------
    const WRITE_PERMISSIONS = {
        'mod-dashboard':     ['Presidência', 'Vice-Presidência'],
        'mod-acessos':       ['Presidência', 'Vice-Presidência'],  // só Master
        'mod-eventos':       ['Presidência', 'Vice-Presidência', 'Tesouraria', 'Marketing', 'Esportes'],
        'mod-marketing':     ['Presidência', 'Vice-Presidência', 'Marketing'],
        'mod-produtos':      ['Presidência', 'Vice-Presidência', 'Tesouraria', 'Produtos'],
        'mod-esportes':      ['Presidência', 'Vice-Presidência', 'Esportes', 'Jurídico'],
        'mod-financeiro':    ['Presidência', 'Vice-Presidência', 'Tesouraria'],
        'mod-parcerias':     ['Presidência', 'Vice-Presidência', 'Parcerias', 'Relações Externas'],
        'mod-legal':         ['Presidência', 'Vice-Presidência', 'Jurídico'],
        'mod-comunicacao':   ['Presidência', 'Vice-Presidência', 'Tesouraria', 'Marketing', 'Esportes', 'Jurídico', 'Produtos', 'Parcerias', 'Relações Externas', 'Nenhuma'],
    };

    // Helper para verificar se o usuário pertence à diretoria executiva máxima (Master, Presidente, Vice)
    window.isExecutiveAdmin = function(user) {
        if (!user) return false;
        const cargo = user.cargo || '';
        const diretoria = user.diretoria || '';
        
        return cargo === 'Master' || 
               cargo === 'Presidente' || 
               cargo === 'Presidencia' || 
               cargo === 'Vice-Presidente' ||
               cargo === 'Vice-Presidência' ||
               diretoria === 'Presidência' || 
               diretoria === 'Presidencia' || 
               diretoria === 'Vice-Presidência' || 
               diretoria === 'Vice-Presidencia';
    };

    // --- Checagem de permissão de escrita ---
    function canWrite(moduleId) {
        const currentUser = getCurrentUser();
        
        // 1. Fail-Safe: Se não há usuário logado, bloqueia
        if (!currentUser) return false;
        
        // 2. Regra de Ouro: Executivos (Master, Presidência, Vice) têm acesso total
        if (window.isExecutiveAdmin(currentUser)) return true;
        
        // 3. Verifica se a diretoria_id do usuário está preenchida
        if (!currentUser.diretoria_id) return false;

        // 4. Se o banco já tiver as permissões (via window.DB.permissoes), usamos do banco
        if (window.DB && window.DB.permissoes && window.DB.permissoes.length > 0) {
            const hasPerm = window.DB.permissoes.some(p => 
                p.acao_sistema === moduleId && 
                p.diretoria_id === currentUser.diretoria_id && 
                p.concedida === true
            );
            return hasPerm;
        }

        // 5. Fallback Inicial (para evitar bloqueio antes do SQL rodar)
        // Usa o nome da diretoria (string) com o dicionário legado WRITE_PERMISSIONS
        const allowed = WRITE_PERMISSIONS[moduleId] || [];
        return allowed.includes(currentUser.diretoria);
    }

    function canViewFinance() {
        const currentUser = getCurrentUser();
        if (!currentUser) return false;
        if (window.isExecutiveAdmin(currentUser)) return true;
        return currentUser.diretoria === 'Tesouraria';
    }

    // --- Popula a sidebar após login ---
    function populateSidebar(user) {
        document.getElementById('sidebar-user-name').textContent = user.nome;
        document.getElementById('sidebar-user-role').textContent = user.cargo;
        document.getElementById('sidebar-user-dept').textContent =
            user.diretoria !== 'Nenhuma' ? `Dir. de ${user.diretoria}` : 'Geral';
    }

    // --- Aplica visibilidade do menu financeiro ---
    function applyNavPermissions() {
        const currentUser = getCurrentUser();
        if (!currentUser) return;
        const isMaster = window.isExecutiveAdmin(currentUser);
        const dir = currentUser.diretoria;

        // Reset visibility of conditional nav items
        const parceriasNavItem = document.querySelector('[data-target="mod-parcerias"]');
        const legalNavItem     = document.querySelector('[data-target="mod-legal"]');
        if (parceriasNavItem) parceriasNavItem.style.display = '';
        if (legalNavItem)     legalNavItem.style.display = '';

        // Financeiro: somente Presidência, Vice-Presidência, Tesouraria e Master
        const financeItem = document.querySelector('.nav-item-finance');
        if (financeItem) {
            financeItem.style.display = canViewFinance() ? '' : 'none';
        }

        // Gestão de Acessos: apenas Master
        document.querySelectorAll('[data-requires-master]').forEach(item => {
            item.style.display = isMaster ? '' : 'none';
        });

        if (!isMaster) {
            // Jurídico: NÃO vê mod-parcerias no menu
            if (dir === 'Jurídico') {
                if (parceriasNavItem) parceriasNavItem.style.display = 'none';
            }
            // Parcerias: NÃO vê mod-legal no menu
            if (dir === 'Parcerias') {
                if (legalNavItem) legalNavItem.style.display = 'none';
            }
        }
    }

    // --- Aplica modo somente leitura aos módulos ---
    function applyReadonlyMode() {
        document.querySelectorAll('.module-section').forEach(section => {
            const moduleId = section.id;
            const canEdit = canWrite(moduleId);
            const existingBanner = section.querySelector('.readonly-module-banner');

            if (!canEdit) {
                section.classList.add('module-readonly');
                if (!existingBanner) {
                    const banner = document.createElement('div');
                    banner.className = 'readonly-module-banner';
                    banner.innerHTML = `<i class="fas fa-eye"></i> <span><strong>Modo Somente Leitura</strong> — sua diretoria pode visualizar este módulo, mas apenas a diretoria responsável pode criar ou editar dados aqui.</span>`;
                    section.insertBefore(banner, section.firstChild);
                }
            } else {
                section.classList.remove('module-readonly');
                if (existingBanner) existingBanner.remove();
            }
        });
    }

    // --- RENDER 2: ACCESS MANAGEMENT MODULE (Gestão de Acessos) ---
    function renderAccessModule() {
        const DB = getDB();
        const searchInput = document.getElementById('search-users-input');
        const query = searchInput ? searchInput.value.toLowerCase() : '';

        const userListTbody = document.querySelector('#users-table tbody');
        if (!userListTbody) return;
        userListTbody.innerHTML = '';

        const filteredUsers = DB.usuarios.filter(u =>
            u.nome.toLowerCase().includes(query) ||
            u.email.toLowerCase().includes(query) ||
            u.cargo.toLowerCase().includes(query) ||
            u.diretoria.toLowerCase().includes(query)
        );

        filteredUsers.forEach(user => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.title = 'Clique para editar este membro';
            tr.innerHTML = `
                <td><b>${user.nome}</b></td>
                <td><code>${user.email}</code></td>
                <td><span class="badge badge-secondary">${user.cargo}</span></td>
                <td><span class="badge badge-secondary">${user.diretoria}</span></td>
                <td>
                    <span class="badge ${user.status ? 'badge-success' : 'badge-danger'}">
                        ${user.status ? '<i class="fas fa-circle" style="font-size:8px;"></i> Ativo' : '<i class="fas fa-ban" style="font-size:10px;"></i> Inativo'}
                    </span>
                </td>
            `;
            // Click row to load user into the edit form
            tr.addEventListener('click', () => {
                document.getElementById('user-edit-id').value = user.id;
                document.getElementById('user-nome').value = user.nome;
                document.getElementById('user-email').value = user.email;
                document.getElementById('user-cargo').value = user.cargo;
                document.getElementById('user-diretoria').value = user.diretoria;
                document.getElementById('user-status').checked = user.status;
                document.getElementById('user-status-text').innerText = user.status ? 'Conta Ativa' : 'Conta Inativa';
                document.getElementById('user-password').value = '';
                document.getElementById('user-password-group').style.opacity = '1';
                document.getElementById('user-form-title').innerHTML = `<i class="fas fa-user-edit"></i> Editando: ${user.nome}`;
                document.getElementById('btn-cancel-user-edit').style.display = 'inline-flex';
                document.getElementById('btn-save-user').innerHTML = '<i class="fas fa-save"></i> Salvar Alterações (Atualizar no Supabase)';
                
                // Highlight row
                document.querySelectorAll('#users-table tbody tr').forEach(r => r.style.background = '');
                tr.style.background = 'rgba(234, 88, 12, 0.08)';
            });
            userListTbody.appendChild(tr);
        });
    }

    // Reset user form to 'new user' mode
    function resetUserForm() {
        document.getElementById('user-edit-id').value = '';
        document.getElementById('user-form-title').innerHTML = '<i class="fas fa-user-plus"></i> Cadastrar Novo Membro da Diretoria';
        document.getElementById('form-manage-user').reset();
        document.getElementById('user-status').checked = true;
        document.getElementById('user-status-text').innerText = 'Conta Ativa';
        document.getElementById('user-password-group').style.opacity = '1';
        document.getElementById('btn-cancel-user-edit').style.display = 'none';
        document.getElementById('btn-save-user').innerHTML = '<i class="fas fa-save"></i> Salvar Membro';
        document.querySelectorAll('#users-table tbody tr').forEach(r => r.style.background = '');
    }

    // Bind de eventos
    // Reactive search: filter user table on input
    const searchUsersInput = document.getElementById('search-users-input');
    if (searchUsersInput) {
        searchUsersInput.addEventListener('input', () => renderAccessModule());
    }

    // Toggle checkbox status text
    const userStatusCheckbox = document.getElementById('user-status');
    if (userStatusCheckbox) {
        userStatusCheckbox.addEventListener('change', () => {
            document.getElementById('user-status-text').innerText = userStatusCheckbox.checked ? 'Conta Ativa' : 'Conta Inativa';
        });
    }

    // User form submit handler
    const formManageUser = document.getElementById('form-manage-user');
    if (formManageUser) {
        formManageUser.addEventListener('submit', (e) => {
            e.preventDefault();
            const DB_Engine = getDBEngine();
            const editId = document.getElementById('user-edit-id').value;
            const data = {
                id: editId || null,
                nome: document.getElementById('user-nome').value,
                email: document.getElementById('user-email').value,
                password: document.getElementById('user-password').value,
                cargo: document.getElementById('user-cargo').value,
                diretoria: document.getElementById('user-diretoria').value,
                status: document.getElementById('user-status').checked
            };

            const ok = DB_Engine.saveUsuario(data);
            if (ok) resetUserForm();
        });
    }

    const btnCancelEdit = document.getElementById('btn-cancel-user-edit');
    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => resetUserForm());
    }

    // --- LOGICA DE GERENCIAMENTO DE PERFIL INDIVIDUAL ---
    const btnProfile = document.getElementById('btn-profile-dropdown');
    const profileDropdown = document.getElementById('profile-dropdown');
    const btnGoSettings = document.getElementById('btn-go-to-settings');
    const btnDropdownLogout = document.getElementById('btn-dropdown-logout');

    if (btnProfile && profileDropdown) {
        btnProfile.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdown.style.display = profileDropdown.style.display === 'none' ? 'block' : 'none';
        });

        document.addEventListener('click', () => {
            profileDropdown.style.display = 'none';
        });

        profileDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    if (btnGoSettings) {
        btnGoSettings.addEventListener('click', () => {
            const currentUser = getCurrentUser();
            if (profileDropdown) profileDropdown.style.display = 'none';

            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.module-section').forEach(s => s.classList.remove('active'));

            const configSection = document.getElementById('mod-configuracoes');
            if (configSection) {
                configSection.classList.add('active');
            }

            if (currentUser) {
                document.getElementById('profile-name').value = currentUser.nome;
                document.getElementById('profile-email').value = currentUser.email;
                document.getElementById('profile-password').value = '';
                document.getElementById('profile-password-confirm').value = '';
                document.getElementById('profile-avatar-url').value = currentUser.avatar && !currentUser.avatar.startsWith('data:') ? currentUser.avatar : '';
                document.getElementById('profile-avatar-file').value = '';
            }
        });
    }

    if (btnDropdownLogout) {
        btnDropdownLogout.addEventListener('click', () => {
            if (profileDropdown) profileDropdown.style.display = 'none';
            const logoutBtn = document.getElementById('btn-logout');
            if (logoutBtn) logoutBtn.click();
        });
    }

    const formProfileSettings = document.getElementById('form-profile-settings');
    if (formProfileSettings) {
        formProfileSettings.addEventListener('submit', (e) => {
            e.preventDefault();
            const currentUser = getCurrentUser();
            const DB = getDB();
            if (!currentUser) return;

            const email = document.getElementById('profile-email').value.trim();
            const password = document.getElementById('profile-password').value;
            const passwordConfirm = document.getElementById('profile-password-confirm').value;
            const avatarUrl = document.getElementById('profile-avatar-url').value.trim();
            const avatarFileInput = document.getElementById('profile-avatar-file');
            const saveMsg = document.getElementById('profile-save-message');

            if (password && password.length < 6) {
                alert('A nova senha deve conter pelo menos 6 caracteres!');
                return;
            }

            if (password !== passwordConfirm) {
                alert('A nova senha e a confirmação de senha não coincidem!');
                return;
            }

            const executeSave = (avatarData) => {
                const userInDb = DB.usuarios.find(u => u.id === currentUser.id);
                if (userInDb) {
                    userInDb.email = email;
                    if (password) {
                        userInDb.senha = password;
                        userInDb.password_hash = `[HASH de '${password}']`;
                    }
                    if (avatarData) {
                        userInDb.avatar = avatarData;
                    }

                    currentUser.email = email;
                    if (password) {
                        currentUser.senha = password;
                        currentUser.password_hash = userInDb.password_hash;
                    }
                    if (avatarData) {
                        currentUser.avatar = avatarData;
                    }

                    setCurrentUser(currentUser);
                    localStorage.setItem('lup_user', JSON.stringify(currentUser));

                    logSQL(`UPDATE usuarios SET email = '${email}'${password ? `, senha = [HASH]` : ''}${avatarData ? `, avatar = [IMAGE]` : ''} WHERE id = '${currentUser.id}';`, 'query');
                    logSQL(`Perfil de '${currentUser.nome}' atualizado com sucesso.`, 'success');

                    const userAvatar = currentUser.avatar || 'assets/default-avatar.png';
                    const imgHeader = document.getElementById('header-user-avatar');
                    const imgDropdown = document.getElementById('dropdown-user-avatar');
                    if (imgHeader) imgHeader.src = userAvatar;
                    if (imgDropdown) imgDropdown.src = userAvatar;

                    const emailEl = document.getElementById('dropdown-user-email');
                    if (emailEl) emailEl.textContent = email;

                    if (saveMsg) {
                        saveMsg.textContent = 'Alterações salvas com sucesso!';
                        saveMsg.style.display = 'inline-block';
                        setTimeout(() => {
                            saveMsg.style.display = 'none';
                        }, 3000);
                    }
                    refreshAllUI();
                }
            };

            if (avatarFileInput && avatarFileInput.files && avatarFileInput.files[0]) {
                const reader = new FileReader();
                reader.onload = function(evt) {
                    executeSave(evt.target.result);
                };
                reader.readAsDataURL(avatarFileInput.files[0]);
            } else if (avatarUrl) {
                executeSave(avatarUrl);
            } else {
                executeSave(null);
            }
        });
    }

    // Expor globalmente para manter compatibilidade retroativa e uso nas closures
    window.canWrite = canWrite;
    window.canViewFinance = canViewFinance;
    window.populateSidebar = populateSidebar;
    window.applyNavPermissions = applyNavPermissions;
    window.applyReadonlyMode = applyReadonlyMode;

    window.UserAccess = {
        canWrite,
        canViewFinance,
        populateSidebar,
        applyNavPermissions,
        applyReadonlyMode,
        renderAccessModule,
        resetUserForm
    };
};
