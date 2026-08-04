// ============================================================================
// GED_DOCS.JS — Módulo de GED e Parcerias — LIGA-LUP
//
// Responsabilidade: Gestão de documentos, propostas e contratos, uploads,
// visualização de arquivos na tabela documentos_contratos e parcerias/convênios.
// Controla as telas de parcerias (renderParceriasModule) e jurídico/GED (renderLegalModule).
//
// Contrato de API:
//   window.initGED(deps) é chamada pelo app.js após toda a infraestrutura
//   de estado (DB, supabase) estar pronta.
// ============================================================================

window.initGED = function(deps) {
    const {
        supabase,
        getDB,
        getCurrentUser,
        logSQL,
        refreshAllUI
    } = deps;

    const STATUS_PROPOSTA = 'Proposta Gerada';
    const STATUS_CONTRATO_ANEXADO = 'Contrato Anexado / Em Assinatura';

    function reportError(contexto, error) {
        console.error(`[GED] ${contexto}:`, error);
        alert(`${contexto}. ${error.message || 'Tente novamente.'}`);
    }

    async function loadParceriasData() {
        const [{ data: parceiros, error: parceirosError }, { data: documentos, error: documentosError }] = await Promise.all([
            supabase.from('parceiros_patrocinadores').select('*').order('created_at', { ascending: false }),
            supabase.from('documentos_contratos').select('*').order('created_at', { ascending: false })
        ]);

        if (parceirosError) throw parceirosError;
        if (documentosError) throw documentosError;
        return { parceiros, documentos };
    }

    let realtimeRefreshTimer;
    function scheduleRealtimeRefresh() {
        clearTimeout(realtimeRefreshTimer);
        realtimeRefreshTimer = setTimeout(() => {
            renderParceriasModule();
            renderLegalModule();
        }, 150);
    }

    // Mantém as duas telas sincronizadas inclusive quando outra aba/usuário altera os dados.
    supabase.channel('parcerias-juridico-ui')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'parceiros_patrocinadores' }, scheduleRealtimeRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documentos_contratos' }, scheduleRealtimeRefresh)
        .subscribe();

    // RENDER 6: PARTNERS & LEGAL (GED Repositories)
    async function renderParceriasModule() {
        const partnersList = document.getElementById('partners-list');
        if (!partnersList) return;
        partnersList.innerHTML = '';

        let parceiros, documentos;
        try {
            ({ parceiros, documentos } = await loadParceriasData());
        } catch (error) {
            console.error('[GED] Não foi possível carregar as parcerias:', error);
            partnersList.innerHTML = '<div class="empty-state">Não foi possível carregar as parcerias. Atualize a página e tente novamente.</div>';
            return;
        }
        
        parceiros.forEach(partner => {
            const card = document.createElement('div');
            card.className = 'list-group-item';
            
            let statusBadge = '';
            if (partner.status_funil === 'Contrato Ativo') statusBadge = '<span class="badge badge-success">CONTRATO ATIVO</span>';
            else if (partner.status_funil === 'Arquivado') statusBadge = '<span class="badge badge-secondary">ARQUIVADO</span>';
            else statusBadge = `<span class="badge badge-warning">${partner.status_funil}</span>`;

            const contrato = documentos.find(d => d.parceiro_id === partner.id && d.tipo_documento === 'Contrato');

            card.innerHTML = `
                <div style="flex-grow:1;">
                    <div class="list-group-item-title">${partner.nome_empresa}</div>
                    <div class="list-group-item-desc">🏷️ Tipo: ${partner.tipo_parceria}</div>
                    <div style="margin-top:8px; display:flex; gap:12px; align-items:center;">
                        ${partner.link_proposta_drive ? `
                        <a href="${partner.link_proposta_drive}" target="_blank" style="font-size:11px; color:var(--primary); text-decoration:none;"><i class="fas fa-external-link-alt"></i> Proposta no Drive</a>
                        ` : ''}
                        ${contrato && contrato.arquivo_url ? `
                        <a href="${contrato.arquivo_url}" target="_blank" style="font-size:11px; color:#22c55e; text-decoration:none;"><i class="fas fa-file-contract"></i> Contrato Assinado</a>
                        ` : ''}
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
                    ${statusBadge}
                </div>
            `;
            partnersList.appendChild(card);
        });
    }

    async function renderLegalModule() {
        let parceiros, documentos;
        try {
            ({ parceiros, documentos } = await loadParceriasData());
        } catch (error) {
            console.error('[GED] Não foi possível carregar os dados jurídicos:', error);
            const auditoriaTbody = document.querySelector('#auditoria-parcerias-table tbody');
            if (auditoriaTbody) auditoriaTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--danger);">Não foi possível carregar as propostas do Supabase.</td></tr>';
            return;
        }
        const auditoriaTbody = document.querySelector('#auditoria-parcerias-table tbody');
        if (auditoriaTbody) {
            auditoriaTbody.innerHTML = '';
            
            const parceriasAguardando = parceiros.filter(p => !['Contrato Ativo', 'Encerrado', 'Arquivado'].includes(p.status_funil));
            
            if (parceriasAguardando.length === 0) {
                auditoriaTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">Nenhuma parceria pendente de contrato no momento.</td></tr>';
            } else {
                parceriasAguardando.forEach(partner => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><b>${partner.nome_empresa}</b></td>
                        <td>${partner.tipo_parceria}</td>
                        <td>
                            ${partner.link_proposta_drive ? `
                            <a href="${partner.link_proposta_drive}" target="_blank" style="color:var(--primary); text-decoration:none;">
                                <i class="fas fa-file-alt"></i> Visualizar Proposta
                            </a>
                            ` : `<span style="color:var(--text-muted);">S/ Link</span>`}
                        </td>
                        <td><span class="badge badge-warning">${partner.status_funil}</span></td>
                        <td>
                            <button class="btn btn-sm btn-primary btn-detail-partner" data-partner-id="${partner.id}" style="padding: 4px 8px; font-size: 11px;">
                                <i class="fas fa-eye"></i> Detalhes
                            </button>
                        </td>
                    `;
                    auditoriaTbody.appendChild(tr);
                });

                // Attach click listeners to detail buttons
                auditoriaTbody.querySelectorAll('.btn-detail-partner').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-partner-id');
                        openPartnerDetailModal(id);
                    });
                });
            }
        }

        // GED documents table
        const gedTbody = document.querySelector('#ged-table tbody');
        if (gedTbody) {
            gedTbody.innerHTML = '';
            documentos.forEach(doc => {
                const partner = parceiros.find(p => p.id === doc.parceiro_id);
                const tr = document.createElement('tr');
                
                tr.innerHTML = `
                    <td><b>${doc.titulo}</b></td>
                    <td><span class="badge badge-secondary">${doc.tipo_documento}</span></td>
                    <td>${partner ? partner.nome_empresa : 'Geral'}</td>
                    <td>
                        ${doc.arquivo_url ? `
                            <a href="${doc.arquivo_url}" target="_blank" style="color:var(--primary); text-decoration:none;">
                                <i class="fas fa-external-link-alt"></i> Visualizar (Google Drive)
                            </a>
                        ` : `
                            <span style="color:var(--danger); font-style:italic;">Sem link anexo</span>
                        `}
                    </td>
                    <td>${doc.data_vencimento || 'N/A'}</td>
                `;
                gedTbody.appendChild(tr);
            });
        }

        // Populate dropdown in doc upload form
        const partnerSelect = document.getElementById('doc-partner-select');
        if (partnerSelect) {
            partnerSelect.innerHTML = '<option value="">Parceiro Geral...</option>';
            parceiros.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.innerText = p.nome_empresa;
                partnerSelect.appendChild(opt);
            });
        }
    }

    // PARTNER DETAIL MODAL LOGIC (Jurídico Read/Write)
    async function openPartnerDetailModal(partnerId) {
        const { data: partner, error } = await supabase
            .from('parceiros_patrocinadores')
            .select('*')
            .eq('id', partnerId)
            .single();
        if (error) {
            reportError('Não foi possível carregar os detalhes da parceria', error);
            return;
        }

        document.getElementById('detail-partner-id').value = partner.id;
        document.getElementById('detail-partner-name').value = partner.nome_empresa;
        document.getElementById('detail-partner-type').value = partner.tipo_parceria;

        const proposalContainer = document.getElementById('detail-partner-proposal-container');
        if (partner.link_proposta_drive) {
            proposalContainer.innerHTML = `
                <a href="${partner.link_proposta_drive}" target="_blank" style="color:var(--primary); text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:6px;">
                    <i class="fas fa-external-link-alt"></i> Visualizar Proposta no Drive
                </a>
            `;
        } else {
            proposalContainer.innerHTML = `<span style="color:var(--text-muted); font-style:italic;">Sem link de proposta cadastrado</span>`;
        }

        // Populate status dropdown: excluding Contrato Ativo as per RN-JUR-01
        const statusSelect = document.getElementById('detail-partner-status');
        statusSelect.innerHTML = `
            <option value="Prospecção">Prospecção</option>
            <option value="Negociação">Negociação</option>
            <option value="Aguardando Contrato">Aguardando Contrato</option>
            <option value="Encerrado">Encerrado</option>
            <option value="Arquivado">Arquivado</option>
        `;

        if (![...statusSelect.options].some(option => option.value === partner.status_funil)) {
            const currentStatusOption = document.createElement('option');
            currentStatusOption.value = partner.status_funil;
            currentStatusOption.textContent = partner.status_funil;
            statusSelect.appendChild(currentStatusOption);
        }

        if (partner.status_funil === 'Contrato Ativo') {
            const opt = document.createElement('option');
            opt.value = 'Contrato Ativo';
            opt.textContent = 'Contrato Ativo';
            opt.disabled = true;
            statusSelect.appendChild(opt);
            statusSelect.value = 'Contrato Ativo';
            statusSelect.disabled = true;
        } else {
            statusSelect.value = partner.status_funil;
            statusSelect.disabled = false;
        }

        // Check write permission for mod-legal (resolved via window.canWrite RBAC)
        const isWriteable = window.canWrite ? window.canWrite('mod-legal') : false;
        const saveBtn = document.getElementById('btn-save-partner-detail');
        if (isWriteable) {
            if (partner.status_funil !== 'Contrato Ativo') {
                statusSelect.disabled = false;
            }
            if (saveBtn) saveBtn.style.display = '';
        } else {
            statusSelect.disabled = true;
            if (saveBtn) saveBtn.style.display = 'none';
        }

        document.getElementById('partner-detail-overlay').classList.add('active');
    }

    function closePartnerDetailModal() {
        document.getElementById('partner-detail-overlay').classList.remove('active');
    }

    // Registra Listeners e Event Handlers
    // Event Handler: Create Partner
    const formCreatePartner = document.getElementById('form-create-partner');
    if (formCreatePartner) {
        formCreatePartner.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nome = document.getElementById('partner-nome').value.trim();
            const tipo = document.getElementById('partner-tipo').value.trim();
            const link = document.getElementById('partner-proposta-url').value.trim();
            const submitButton = formCreatePartner.querySelector('button[type="submit"]');
            if (submitButton) submitButton.disabled = true;
            try {
                const { error } = await supabase.from('parceiros_patrocinadores').insert({
                    nome_empresa: nome,
                    tipo_parceria: tipo,
                    status_funil: STATUS_PROPOSTA,
                    link_proposta_drive: link
                });
                if (error) throw error;

                logSQL(`INSERT INTO parceiros_patrocinadores (nome_empresa, tipo_parceria, status_funil, link_proposta_drive) VALUES ('${nome}', '${tipo}', '${STATUS_PROPOSTA}', '${link}');`, 'query');
                formCreatePartner.reset();
                await renderParceriasModule();
                await renderLegalModule();
                alert('Proposta enviada ao Jurídico com sucesso.');
            } catch (error) {
                reportError('Não foi possível salvar a proposta de parceria', error);
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
            return;

            { const DB = getDB();
            const currentUser = getCurrentUser();
            const nome = document.getElementById('partner-nome').value;
            const tipo = document.getElementById('partner-tipo').value;
            const link = document.getElementById('partner-proposta-url').value;
            
            const newId = 'par_' + Date.now();
            DB.parceiros_patrocinadores.push({
                id: newId,
                nome_empresa: nome,
                tipo_parceria: tipo,
                status_funil: 'Aguardando Contrato',
                link_proposta_drive: link
            });
            
            const alertEmail = window.getNotificationEmail('NOVA_PARCERIA');
            supabase.from('logs_notificacoes').insert([{
                usuario_id: currentUser ? currentUser.id : 'u1',
                tipo_notificacao: 'Sistema',
                gatilho_regra: 'NOVA_PARCERIA',
                destinatario_email: alertEmail,
                status_entrega: 'ENVIADO',
                data_envio: new Date().toISOString().replace('T', ' ').substring(0, 16),
                lida: false
            }]).then();
            
            logSQL(`INSERT INTO parceiros_patrocinadores (nome_empresa, tipo_parceria, status_funil, link_proposta_drive) VALUES ('${nome}', '${tipo}', 'Aguardando Contrato', '${link}');`, 'query');
            logSQL(`Notificação disparada para Diretoria Jurídica sobre nova proposta de parceria: ${nome}.`, 'success');
            
            formCreatePartner.reset();
            refreshAllUI();
            }
        });
    }

    // Modal Close Listeners
    const btnCloseDetail = document.getElementById('btn-close-partner-detail');
    if (btnCloseDetail) btnCloseDetail.addEventListener('click', closePartnerDetailModal);

    const btnCancelDetail = document.getElementById('btn-cancel-partner-detail');
    if (btnCancelDetail) btnCancelDetail.addEventListener('click', closePartnerDetailModal);

    // Modal Save Listener
    const btnSaveDetail = document.getElementById('btn-save-partner-detail');
    if (btnSaveDetail) {
        btnSaveDetail.addEventListener('click', async () => {
            const partnerId = document.getElementById('detail-partner-id').value;
            const newStatus = document.getElementById('detail-partner-status').value;
            btnSaveDetail.disabled = true;
            try {
                const { error } = await supabase
                    .from('parceiros_patrocinadores')
                    .update({ status_funil: newStatus })
                    .eq('id', partnerId);
                if (error) throw error;

                logSQL(`UPDATE parceiros_patrocinadores SET status_funil = '${newStatus}' WHERE id = '${partnerId}';`, 'query');
                closePartnerDetailModal();
                await renderParceriasModule();
                await renderLegalModule();
                alert('Status da parceria atualizado com sucesso.');
            } catch (error) {
                reportError('Não foi possível atualizar o status da parceria', error);
            } finally {
                btnSaveDetail.disabled = false;
            }
            return;

            { const DB = getDB();
            const currentUser = getCurrentUser();
            const partnerId = document.getElementById('detail-partner-id').value;
            const newStatus = document.getElementById('detail-partner-status').value;

            const partner = DB.parceiros_patrocinadores.find(p => p.id === partnerId);
            if (!partner) return;

            const oldStatus = partner.status_funil;
            if (oldStatus !== newStatus) {
                partner.status_funil = newStatus;

                logSQL(`UPDATE parceiros_patrocinadores SET status_funil = '${newStatus}' WHERE id = '${partnerId}';`, 'query');
                logSQL(`Status da parceria '${partner.nome_empresa}' atualizado de '${oldStatus}' para '${newStatus}' pelo Jurídico.`, 'success');

                const alertEmail = window.getNotificationEmail('STATUS_PARCERIA_JURIDICO');
                supabase.from('logs_notificacoes').insert([{
                    usuario_id: currentUser ? currentUser.id : 'u5',
                    tipo_notificacao: 'System',
                    gatilho_regra: 'STATUS_PARCERIA_JURIDICO',
                    destinatario_email: alertEmail,
                    status_entrega: 'ENVIADO',
                    data_envio: new Date().toISOString().replace('T', ' ').substring(0, 16),
                    lida: false
                }]).then();
            }

            closePartnerDetailModal();
            refreshAllUI();
            }
        });
    }

    // Event Handler: Upload document link to GED
    const btnAddDoc = document.getElementById('btn-add-document');
    if (btnAddDoc) {
        btnAddDoc.addEventListener('click', async () => {
            const title = document.getElementById('doc-title').value.trim();
            const type = document.getElementById('doc-type').value;
            const url = document.getElementById('doc-url').value.trim();
            const expiry = document.getElementById('doc-expiry').value;
            const partnerId = document.getElementById('doc-partner-select').value;

            if (!title || !url) {
                alert('Preencha os dados do documento: título e URL são obrigatórios.');
                return;
            }

            btnAddDoc.disabled = true;
            try {
                const { error: documentError } = await supabase.from('documentos_contratos').insert({
                    titulo: title,
                    tipo_documento: type,
                    arquivo_url: url,
                    data_vencimento: expiry || null,
                    parceiro_id: partnerId || null
                });
                if (documentError) throw documentError;

                if (type === 'Contrato' && partnerId) {
                    const { error: partnershipError } = await supabase
                        .from('parceiros_patrocinadores')
                        .update({ status_funil: STATUS_CONTRATO_ANEXADO })
                        .eq('id', partnerId);
                    if (partnershipError) throw partnershipError;
                }

                logSQL(`INSERT INTO documentos_contratos (titulo, tipo_documento, arquivo_url, data_vencimento, parceiro_id) VALUES ('${title}', '${type}', '${url}', '${expiry}', '${partnerId}');`, 'query');
                if (type === 'Contrato' && partnerId) logSQL(`UPDATE parceiros_patrocinadores SET status_funil = '${STATUS_CONTRATO_ANEXADO}' WHERE id = '${partnerId}';`, 'query');
                document.getElementById('form-upload-doc').reset();
                await renderParceriasModule();
                await renderLegalModule();
                alert(type === 'Contrato' && partnerId ? 'Contrato gerado e parceria enviada para assinatura.' : 'Documento salvo no GED com sucesso.');
            } catch (error) {
                reportError('Não foi possível salvar o documento no GED', error);
            } finally {
                btnAddDoc.disabled = false;
            }
            return;

            { const DB = getDB();
            const title = document.getElementById('doc-title').value;
            const type = document.getElementById('doc-type').value;
            const url = document.getElementById('doc-url').value;
            const expiry = document.getElementById('doc-expiry').value;
            const partnerId = document.getElementById('doc-partner-select').value;

            if (!title || !url) {
                alert('Preencha os dados do documento (título e URL do Drive são obrigatórios)!');
                return;
            }

            const newId = 'dc_' + Date.now();
            DB.documentos_contratos.push({
                id: newId,
                titulo: title,
                tipo_documento: type,
                arquivo_url: url,
                data_vencimento: expiry || null,
                parceiro_id: partnerId || null
            });

            logSQL(`INSERT INTO documentos_contratos (titulo, tipo_documento, arquivo_url, data_vencimento, parceiro_id) VALUES ('${title}', '${type}', '${url}', '${expiry}', '${partnerId}');`, 'query');
            logSQL(`GED: Arquivo de texto simples anexado com sucesso para auditoria e conciliação jurídica de parceria.`, 'success');
            
            if (type === 'Contrato' && partnerId) {
                const partner = DB.parceiros_patrocinadores.find(p => p.id === partnerId);
                if (partner && partner.status_funil !== 'Contrato Ativo') {
                    partner.status_funil = 'Contrato Ativo';
                    logSQL(`UPDATE parceiros_patrocinadores SET status_funil='Contrato Ativo' WHERE id='${partnerId}';`, 'query');
                    logSQL(`Parceria ${partner.nome_empresa} ativada automaticamente após vínculo do Contrato no GED!`, 'success');
                }
            }

            document.getElementById('doc-title').value = '';
            document.getElementById('doc-url').value = '';
            refreshAllUI();
            }
        });
    }

    // Expor API Pública do módulo
    window.GEDModule = {
        renderParceriasModule,
        renderLegalModule,
        openPartnerDetailModal,
        closePartnerDetailModal
    };
};
