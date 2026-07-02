// ============================================================================
// FINANCE.JS — Módulo Financeiro e Tesouraria — LIGA-LUP
//
// Responsabilidade: toda a lógica financeira: cálculo de saldos, renderização
// de tabelas do livro caixa, controle de participantes de eventos e confirmações
// de pagamentos, além de estornos e exclusão de lançamentos.
//
// Contrato de API:
//   window.initFinance(deps) é chamada pelo app.js após toda a infraestrutura
//   de estado (DB, DB_Engine) estar pronta.
// ============================================================================

window.initFinance = function(deps) {
    const {
        getDB,
        getDBEngine,
        getCurrentUser,
        logSQL,
        refreshAllUI,
        formatCurrency = function(val) {
            return 'R$ ' + parseFloat(val).toFixed(2);
        }
    } = deps;

    // Estado local do módulo
    let selectedFinanceEventId = '';

    // RENDER 5: TREASURY (FINANCE MODULE)
    function renderFinanceModule() {
        const DB = getDB();
        const DB_Engine = getDBEngine();
        const financeTbody = document.querySelector('#ledger-table tbody');
        if (financeTbody) {
            financeTbody.innerHTML = '';
            
            let netInflow = 0;
            let netOutflow = 0;

            DB.lancamentos_financeiros.forEach(record => {
                const tr = document.createElement('tr');
                
                if (record.tipo === 'Entrada') netInflow += record.valor;
                else netOutflow += record.valor;

                tr.innerHTML = `
                    <td><code>${record.id}</code></td>
                    <td>${record.data_competencia}</td>
                    <td>
                        <span class="badge ${record.tipo === 'Entrada' ? 'badge-success' : 'badge-danger'}">
                            ${record.tipo}
                        </span>
                    </td>
                    <td><b>${record.categoria}</b></td>
                    <td>${formatCurrency(record.valor)}</td>
                    <td>
                        <span class="badge ${record.status_conciliacao ? 'badge-success' : 'badge-secondary'}">
                            ${record.status_conciliacao ? '<i class="fas fa-lock"></i> Conciliado' : '<i class="fas fa-clock"></i> Pendente'}
                        </span>
                    </td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            ${!record.status_conciliacao ? `
                                <button class="btn btn-secondary btn-reconcile" data-lf-id="${record.id}" style="padding:4px 8px; font-size:11px; background:var(--accent-glow); color:var(--accent);">
                                    Conciliar
                                </button>
                            ` : `
                                <button class="btn btn-secondary btn-estorno-row" data-lf-id="${record.id}" style="padding:4px 8px; font-size:11px; border-color:var(--danger); color:var(--danger);">
                                    Estornar
                                </button>
                            `}
                            <button class="btn btn-secondary btn-delete-lf" data-lf-id="${record.id}" style="padding:4px 8px; font-size:11px;">
                                Excluir
                            </button>
                        </div>
                    </td>
                `;
                financeTbody.appendChild(tr);
            });

            // Balance Summary Cards update
            const netTotal = netInflow - netOutflow;
            document.getElementById('ledger-inflow').innerText = formatCurrency(netInflow);
            document.getElementById('ledger-outflow').innerText = formatCurrency(netOutflow);
            document.getElementById('ledger-total').innerText = formatCurrency(netTotal);
            
            if (netTotal < 0) {
                document.getElementById('ledger-total').className = 'badge badge-danger';
            } else {
                document.getElementById('ledger-total').className = 'badge badge-success';
            }

            // Reconcile trigger button click (renders record imutável)
            document.querySelectorAll('.btn-reconcile').forEach(btn => {
                btn.addEventListener('click', () => {
                    const lfId = btn.getAttribute('data-lf-id');
                    DB_Engine.mutateFinanceRecord(lfId, 'update', { status_conciliacao: true });
                });
            });

            // Inline Estornar trigger button click
            document.querySelectorAll('.btn-estorno-row').forEach(btn => {
                btn.addEventListener('click', () => {
                    const lfId = btn.getAttribute('data-lf-id');
                    if (confirm(`Tem certeza de que deseja realizar o estorno automático para o lançamento conciliado '${lfId}'? Isso gerará uma transação oposta de compensação.`)) {
                        performEstorno(lfId);
                    }
                });
            });

            // Delete record button click (tests RN-FIN-01 lock)
            document.querySelectorAll('.btn-delete-lf').forEach(btn => {
                btn.addEventListener('click', () => {
                    const lfId = btn.getAttribute('data-lf-id');
                    if (confirm('Tem certeza de que deseja excluir este lançamento financeiro? Esta ação é irreversível.')) {
                        DB_Engine.mutateFinanceRecord(lfId, 'delete');
                    }
                });
            });
        }

        // Render phase 4 event participants section
        renderEventParticipants();
    }

    // --- FUNCTION: RENDER EVENT PARTICIPANTS (Fase 4) ---
    function renderEventParticipants() {
        const DB = getDB();
        const DB_Engine = getDBEngine();
        const finEvtSelect = document.getElementById('fin-evento-select');
        const filterSelect = document.getElementById('part-filter-select');
        if (!finEvtSelect) return;

        // Populate event select with approved Social/Misto events
        const prevSelectValue = selectedFinanceEventId;
        finEvtSelect.innerHTML = '<option value="">Selecione um Evento...</option>';
        
        const eligibleEvents = DB.eventos.filter(e => e.status_aprovacao === 'Aprovado' && (e.tipo === 'Social' || e.tipo === 'Misto'));
        eligibleEvents.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.innerText = `${e.nome} (${e.tipo})`;
            finEvtSelect.appendChild(opt);
        });

        if (prevSelectValue && eligibleEvents.some(e => e.id === prevSelectValue)) {
            finEvtSelect.value = prevSelectValue;
            selectedFinanceEventId = prevSelectValue;
        } else {
            finEvtSelect.value = '';
            selectedFinanceEventId = '';
        }

        // Setup event listener once
        if (!finEvtSelect.dataset.listener) {
            finEvtSelect.addEventListener('change', (e) => {
                selectedFinanceEventId = e.target.value;
                const event = DB.eventos.find(evt => evt.id === selectedFinanceEventId);
                const partValInput = document.getElementById('part-valor');
                if (event && partValInput) {
                    partValInput.value = event.valor_taxa_base.toFixed(2);
                }
                renderEventParticipants();
            });
            finEvtSelect.dataset.listener = 'true';
        }

        if (filterSelect && !filterSelect.dataset.listener) {
            filterSelect.addEventListener('change', () => {
                renderEventParticipants();
            });
            filterSelect.dataset.listener = 'true';
        }

        const interfaceDiv = document.getElementById('fin-participants-interface');
        const placeholderDiv = document.getElementById('fin-participants-no-selection');

        if (!selectedFinanceEventId) {
            if (interfaceDiv) interfaceDiv.style.display = 'none';
            if (placeholderDiv) placeholderDiv.style.display = 'block';
            return;
        }

        if (interfaceDiv) interfaceDiv.style.display = 'block';
        if (placeholderDiv) placeholderDiv.style.display = 'none';

        const event = DB.eventos.find(e => e.id === selectedFinanceEventId);

        // Fetch participants for this event
        const allPart = DB.participantes_evento.filter(p => p.evento_id === selectedFinanceEventId);
        
        // Calculate KPIs
        const totalCount = allPart.length;
        const totalPaid = allPart.filter(p => p.status_pagamento === 'Pago').reduce((sum, p) => sum + p.valor_cobrado, 0);
        const totalPending = allPart.filter(p => p.status_pagamento === 'Pendente').reduce((sum, p) => sum + p.valor_cobrado, 0);
        const netProfit = totalPaid - event.orcamento_previsto;

        document.getElementById('evt-kpi-total-part').innerText = totalCount;
        document.getElementById('evt-kpi-arrecadado').innerText = formatCurrency(totalPaid);
        document.getElementById('evt-kpi-a-receber').innerText = formatCurrency(totalPending);
        
        const netProfitEl = document.getElementById('evt-kpi-liquido');
        netProfitEl.innerText = formatCurrency(netProfit);
        if (netProfit < 0) {
            netProfitEl.style.color = '#ef4444';
        } else {
            netProfitEl.style.color = '#10b981';
        }

        // Render table
        const tbody = document.querySelector('#fin-part-table tbody');
        if (tbody) {
            tbody.innerHTML = '';
            
            const filterVal = filterSelect ? filterSelect.value : 'Todos';
            const filteredPart = allPart.filter(p => {
                if (filterVal === 'Todos') return true;
                return p.status_pagamento === filterVal;
            });

            if (filteredPart.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">Nenhum participante correspondente a este filtro.</td></tr>';
            } else {
                filteredPart.forEach(part => {
                    const tr = document.createElement('tr');
                    
                    let statusBadge = '';
                    if (part.status_pagamento === 'Pago') {
                        statusBadge = `<span class="badge badge-success"><i class="fas fa-check-circle"></i> Pago</span>`;
                    } else if (part.status_pagamento === 'Isento') {
                        statusBadge = `<span class="badge badge-secondary"><i class="fas fa-gift"></i> Isento</span>`;
                    } else {
                        statusBadge = `<span class="badge badge-warning"><i class="fas fa-clock"></i> Pendente</span>`;
                    }

                    tr.innerHTML = `
                        <td>
                            <b>${part.nome}</b>
                            ${part.ra_matricula ? `<br><code style="font-size:10px; color:var(--text-secondary);">${part.ra_matricula}</code>` : ''}
                        </td>
                        <td>
                            ${formatCurrency(part.valor_cobrado)}
                            <button class="btn btn-secondary btn-edit-part-price" data-part-id="${part.id}" style="padding: 2px 4px; font-size: 9px; margin-left: 6px;" title="Editar Valor">
                                <i class="fas fa-pencil-alt"></i>
                            </button>
                            ${part.obs ? `<br><span style="font-size: 10px; color: var(--text-secondary); font-style: italic;">Obs: ${part.obs}</span>` : ''}
                        </td>
                        <td>${statusBadge}</td>
                        <td>${part.forma_pagamento || '<span style="color:var(--text-muted);">—</span>'}</td>
                        <td>
                            <div style="display:flex; gap:6px;">
                                ${part.status_pagamento === 'Pendente' ? `
                                    <button class="btn btn-secondary btn-pay-part" data-part-id="${part.id}" style="padding:4px 8px; font-size:11px; background:var(--success-glow); color:var(--success);">
                                        Confirmar Pago
                                    </button>
                                    <button class="btn btn-secondary btn-exempt-part" data-part-id="${part.id}" style="padding:4px 8px; font-size:11px;">
                                        Isentar
                                    </button>
                                ` : `
                                    <button class="btn btn-secondary btn-pend-part" data-part-id="${part.id}" style="padding:4px 8px; font-size:11px; background:var(--danger-glow); color:var(--danger);">
                                        Reverter
                                    </button>
                                `}
                                <button class="btn btn-secondary btn-delete-part" data-part-id="${part.id}" style="padding:4px 8px; font-size:11px; background:rgba(239,68,68,0.1); color:#ef4444;">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                // Attach button listeners
                tbody.querySelectorAll('.btn-edit-part-price').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-part-id');
                        const pObj = DB.participantes_evento.find(p => p.id === id);
                        if (!pObj) return;

                        const newValStr = prompt(`Digite o novo valor cobrado para ${pObj.nome}:`, pObj.valor_cobrado.toFixed(2));
                        if (newValStr === null) return;
                        const newVal = parseFloat(newValStr);
                        if (isNaN(newVal) || newVal < 0) {
                            alert('Valor inválido!');
                            return;
                        }
                        const newObs = prompt('Motivo da alteração de valor (desconto, cortesia, etc.):', pObj.obs || '');
                        DB_Engine.updateParticipanteEventoValor(id, newVal, newObs || '');
                    });
                });

                tbody.querySelectorAll('.btn-pay-part').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-part-id');
                        const forma = prompt('Digite a forma de pagamento (Pix, Dinheiro, Cartão):', 'Pix');
                        if (forma === null) return;
                        DB_Engine.updateParticipanteEventoStatus(id, 'Pago', forma || 'Pix');
                    });
                });

                tbody.querySelectorAll('.btn-exempt-part').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-part-id');
                        DB_Engine.updateParticipanteEventoStatus(id, 'Isento', 'Isento');
                    });
                });

                tbody.querySelectorAll('.btn-pend-part').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-part-id');
                        if (confirm('Deseja realmente reverter este pagamento para Pendente? Lançamentos automáticos no caixa não serão excluídos para manter a conciliação manual.')) {
                            DB_Engine.updateParticipanteEventoStatus(id, 'Pendente', '');
                        }
                    });
                });

                tbody.querySelectorAll('.btn-delete-part').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-part-id');
                        if (confirm('Deseja realmente remover este participante? Esta ação é irreversível.')) {
                            DB_Engine.deleteParticipanteEvento(id);
                        }
                    });
                });
            }
        }
    }

    // Função auxiliar para performar o estorno
    function performEstorno(idToEstorno) {
        const DB = getDB();
        const record = DB.lancamentos_financeiros.find(r => r.id === idToEstorno);
        if (!record) {
            alert("Lançamento não localizado!");
            return;
        }

        const estornoId = 'lf_' + Date.now();
        const estornoVal = record.valor;
        const estornoTipo = record.tipo === 'Entrada' ? 'Saída' : 'Entrada';
        
        DB.lancamentos_financeiros.push({
            id: estornoId,
            tipo: estornoTipo,
            categoria: `ESTORNO do lançamento [ID: ${record.id}] - ${record.categoria}`,
            valor: estornoVal,
            data_competencia: new Date().toISOString().split('T')[0],
            status_conciliacao: false, // O estorno entra pendente
            evento_id: record.evento_id,
            produto_id: record.produto_id
        });

        logSQL(`INSERT INTO lancamentos_financeiros (tipo, categoria, valor, status_conciliacao) VALUES ('${estornoTipo}', 'ESTORNO [${record.id}]', ${estornoVal}, FALSE);`, 'query');
        logSQL(`Compensação atômica realizada. Estorno injetado com sucesso no caixa geral para anular o lançamento imutável [ID: ${record.id}].`, 'success');
        refreshAllUI();
    }

    // Registrar Listeners
    // Event Handler: Register Participant
    const formAddParticipant = document.getElementById('form-add-participant');
    if (formAddParticipant) {
        formAddParticipant.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!selectedFinanceEventId) {
                alert('Selecione um evento primeiro!');
                return;
            }
            const DB = getDB();
            const DB_Engine = getDBEngine();
            const nome = document.getElementById('part-nome').value;
            const ra = document.getElementById('part-ra').value;
            const valor = parseFloat(document.getElementById('part-valor').value) || 0;
            const status = document.getElementById('part-status').value;
            const forma = document.getElementById('part-forma').value;
            const obs = document.getElementById('part-obs').value;

            DB_Engine.insertParticipanteEvento(selectedFinanceEventId, nome, ra, valor, status, forma, obs);
            
            // Reset input values
            document.getElementById('part-nome').value = '';
            document.getElementById('part-ra').value = '';
            document.getElementById('part-obs').value = '';
            
            // Set value back to default
            const event = DB.eventos.find(evt => evt.id === selectedFinanceEventId);
            if (event) {
                document.getElementById('part-valor').value = event.valor_taxa_base.toFixed(2);
            }
        });
    }

    // Event Handler: Add Lançamento Manual
    const btnAddFinance = document.getElementById('btn-add-finance');
    if (btnAddFinance) {
        btnAddFinance.addEventListener('click', () => {
            const DB = getDB();
            const tipo = document.getElementById('fin-type').value;
            const cat = document.getElementById('fin-category').value;
            const val = parseFloat(document.getElementById('fin-val').value) || 0;
            const date = document.getElementById('fin-date').value || new Date().toISOString().split('T')[0];

            if (!cat || val <= 0) {
                alert('Preencha os campos de categoria e valor corretamente!');
                return;
            }

            const newId = 'lf_' + Date.now();
            DB.lancamentos_financeiros.push({
                id: newId,
                tipo: tipo,
                categoria: cat,
                valor: val,
                data_competencia: date,
                status_conciliacao: false,
                evento_id: null,
                produto_id: null
            });

            logSQL(`INSERT INTO lancamentos_financeiros (tipo, categoria, valor, data_competencia, status_conciliacao) VALUES ('${tipo}', '${cat}', ${val}, '${date}', FALSE);`, 'query');
            logSQL(`Lançamento manual inserido no caixa em estado 'Pendente'.`, 'success');

            document.getElementById('fin-category').value = '';
            document.getElementById('fin-val').value = '';
            refreshAllUI();
        });
    }

    // Event Handler: Lançamento de Estorno (Forçando correção manual - RN-FIN-01)
    const btnEstornoFinance = document.getElementById('btn-estorno-finance');
    if (btnEstornoFinance) {
        btnEstornoFinance.addEventListener('click', () => {
            const idToEstorno = prompt("Digite o nome ou ID do Lançamento Conciliado que deseja estornar (ex: 'lf1'):");
            if (!idToEstorno) return;
            performEstorno(idToEstorno);
        });
    }

    // Expor API Pública do módulo
    window.FinanceModule = {
        renderFinanceModule,
        renderEventParticipants,
        performEstorno
    };
};
