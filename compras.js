// ============================================================================
// COMPRAS.JS — Módulo de Supply Chain / Pedidos de Compra — LIGA-LUP
// Sprint 4 — v1.2 (ERP Supply Chain)
//
// Responsabilidade:
//   • Renderização da tabela de Pedidos de Compra com badges de status e
//     alertas de SLA (atraso).
//   • KPIs de Supply Chain (Aguardando Aprovação, Em Atraso, Volume Aprovado).
//   • Modal #1 (Novo Pedido / Editar Rascunho): grid multi-item dinâmico,
//     cálculo de subtotal em tempo real, salvar como Rascunho ou Enviar
//     para Aprovação.
//   • Modal #2 (Registrar Entrega): baixas parciais ou totais por item,
//     histórico de recebimentos, validação de saldo.
//   • Aprovação e Cancelamento de pedidos com RBAC client-side.
//
// Contrato de API:
//   window.initComprasModule(deps) é chamado pelo app.js após toda a
//   infraestrutura de estado (DB, syncDBFromSupabase) estar pronta.
//   window.renderPedidosCompra() é exposto para chamada pelo refreshAllUI().
// ============================================================================

window.initComprasModule = function(deps) {
    const {
        supabase,
        getDB,
        getCurrentUser,
        logSQL,
        refreshAllUI
    } = deps;

    // -----------------------------------------------------------------------
    // HELPERS DE STATUS (badges e cores)
    // -----------------------------------------------------------------------
    const STATUS_BADGE = {
        'Rascunho':              { color: '#6b7280', bg: 'rgba(107,114,128,0.15)', icon: 'fa-pencil-alt' },
        'Aguardando Aprovação':  { color: '#eab308', bg: 'rgba(234,179,8,0.15)',   icon: 'fa-hourglass-half' },
        'Aprovado':              { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',  icon: 'fa-check-circle' },
        'Parcialmente Recebido': { color: '#f97316', bg: 'rgba(249,115,22,0.15)', icon: 'fa-box-open' },
        'Concluído':             { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   icon: 'fa-check-double' },
        'Cancelado':             { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   icon: 'fa-times-circle' },
    };

    function badgeHtml(status) {
        const s = STATUS_BADGE[status] || { color: '#9ca3af', bg: 'rgba(156,163,175,0.1)', icon: 'fa-circle' };
        return `<span style="display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:600; color:${s.color}; background:${s.bg}; white-space:nowrap;">
                    <i class="fas ${s.icon}" style="font-size:10px;"></i> ${status}
                </span>`;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function formatCurrency(val) {
        const n = parseFloat(val) || 0;
        return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function isOverdue(pedido) {
        if (!pedido.data_prevista_entrega) return false;
        if (['Concluído', 'Cancelado'].includes(pedido.status)) return false;
        return new Date(pedido.data_prevista_entrega) < new Date();
    }

    // -----------------------------------------------------------------------
    // RBAC CLIENT-SIDE
    // -----------------------------------------------------------------------
    function canAprovar() {
        const u = getCurrentUser();
        if (!u) return false;
        if (window.isExecutiveAdmin && window.isExecutiveAdmin(u)) return true;
        // Verifica Tesouraria
        if (u.diretoria && (u.diretoria.includes('Tesouraria'))) return true;
        // Verifica permissão dinâmica
        const DB = getDB();
        if (!DB.permissoes || !DB.diretorias) return false;
        const userDirIds = Array.isArray(u.diretorias_ids) && u.diretorias_ids.length > 0
            ? u.diretorias_ids
            : (u.diretoria_id ? [u.diretoria_id] : []);
        return DB.permissoes.some(p =>
            p.concedida && p.acao_sistema === 'aprovar_pedido_compra' && userDirIds.includes(p.diretoria_id)
        );
    }

    function canCriar() {
        const u = getCurrentUser();
        if (!u) return false;
        if (window.isExecutiveAdmin && window.isExecutiveAdmin(u)) return true;
        const DB = getDB();
        if (!DB.permissoes) return false;
        const userDirIds = Array.isArray(u.diretorias_ids) && u.diretorias_ids.length > 0
            ? u.diretorias_ids : (u.diretoria_id ? [u.diretoria_id] : []);
        return DB.permissoes.some(p =>
            p.concedida &&
            ['criar_pedido_compra', 'mod-produtos', 'mod-produtos:create'].includes(p.acao_sistema) &&
            userDirIds.includes(p.diretoria_id)
        );
    }

    function canReceber() {
        const u = getCurrentUser();
        if (!u) return false;
        if (window.isExecutiveAdmin && window.isExecutiveAdmin(u)) return true;
        const DB = getDB();
        if (!DB.permissoes) return false;
        const userDirIds = Array.isArray(u.diretorias_ids) && u.diretorias_ids.length > 0
            ? u.diretorias_ids : (u.diretoria_id ? [u.diretoria_id] : []);
        return DB.permissoes.some(p =>
            p.concedida &&
            ['receber_pedido_compra', 'mod-produtos'].includes(p.acao_sistema) &&
            userDirIds.includes(p.diretoria_id)
        );
    }

    // -----------------------------------------------------------------------
    // KPIs
    // -----------------------------------------------------------------------
    function renderKPIsCompras() {
        const DB = getDB();
        const pedidos = DB.pedidos_compra || [];
        const hoje = new Date();

        const aguardando = pedidos.filter(p => p.status === 'Aguardando Aprovação').length;
        const atrasados  = pedidos.filter(p => isOverdue(p)).length;
        const volume     = pedidos
            .filter(p => p.status === 'Aprovado')
            .reduce((acc, p) => acc + parseFloat(p.valor_total || 0), 0);

        const elAg  = document.getElementById('kpi-pedidos-aguardando');
        const elAt  = document.getElementById('kpi-pedidos-atraso');
        const elVol = document.getElementById('kpi-pedidos-volume');

        if (elAg)  elAg.textContent  = aguardando;
        if (elAt)  elAt.textContent  = atrasados;
        if (elVol) elVol.textContent = formatCurrency(volume);
    }

    // -----------------------------------------------------------------------
    // TABELA PRINCIPAL
    // -----------------------------------------------------------------------
    function renderPedidosCompra() {
        renderKPIsCompras();

        const DB    = getDB();
        const tbody = document.querySelector('#orders-table tbody');
        if (!tbody) return;

        const pedidos    = DB.pedidos_compra      || [];
        const itens      = DB.pedidos_compra_itens || [];
        const fornecedores = DB.fornecedores       || [];

        if (pedidos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-secondary);">
                <i class="fas fa-clipboard-list" style="font-size:28px; display:block; margin-bottom:8px; opacity:.3;"></i>
                Nenhum pedido de compra registrado. Clique em <strong>Novo Pedido</strong> para começar.
            </td></tr>`;
            return;
        }

        // Ordena: mais recentes primeiro
        const sorted = [...pedidos].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        tbody.innerHTML = sorted.map(p => {
            const forn    = fornecedores.find(f => f.id === p.fornecedor_id);
            const nForn   = forn ? forn.nome : '—';
            const nItens  = itens.filter(i => i.pedido_id === p.id).length;
            const overdue = isOverdue(p);
            const rowStyle = overdue ? 'border-left: 3px solid #ef4444;' : '';

            // Ações baseadas em status e RBAC
            let acoes = '';

            // Botão Ver / Editar (Rascunho)
            if (p.status === 'Rascunho') {
                acoes += `<button class="btn" style="padding:4px 8px; font-size:11px; margin:2px;" onclick="window.Compras.openModalNovoPedido('${p.id}')" title="Editar rascunho"><i class="fas fa-edit"></i></button>`;
            } else {
                acoes += `<button class="btn btn-secondary" style="padding:4px 8px; font-size:11px; margin:2px; opacity:.6;" onclick="window.Compras.viewPedido('${p.id}')" title="Ver detalhes"><i class="fas fa-eye"></i></button>`;
            }

            // Botão Aprovar (apenas se Aguardando Aprovação e tem permissão)
            if (p.status === 'Aguardando Aprovação' && canAprovar()) {
                acoes += `<button class="btn btn-accent" style="padding:4px 8px; font-size:11px; margin:2px;" onclick="window.Compras.aprovarPedido('${p.id}')" title="Aprovar pedido"><i class="fas fa-thumbs-up"></i></button>`;
            }

            // Botão Registrar Entrega (Aprovado ou Parcialmente Recebido e tem permissão)
            if (['Aprovado', 'Parcialmente Recebido'].includes(p.status) && canReceber()) {
                acoes += `<button class="btn" style="padding:4px 8px; font-size:11px; margin:2px; background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff; border:none;" onclick="window.Compras.openModalRecebimento('${p.id}')" title="Registrar recebimento"><i class="fas fa-truck-loading"></i></button>`;
            }

            // Botão Cancelar
            if (['Rascunho', 'Aguardando Aprovação'].includes(p.status)) {
                acoes += `<button class="btn" style="padding:4px 8px; font-size:11px; margin:2px; background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3);" onclick="window.Compras.cancelarPedido('${p.id}')" title="Cancelar pedido"><i class="fas fa-times"></i></button>`;
            }

            return `<tr style="${rowStyle}">
                <td>
                    <span style="font-weight:600; color:var(--text-primary);">${nForn}</span>
                    ${overdue ? '<br><span style="font-size:10px; color:#ef4444; font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Em Atraso</span>' : ''}
                </td>
                <td style="color:var(--text-secondary); font-size:13px;">${formatDate(p.data_emissao || p.created_at)}</td>
                <td style="color:var(--text-secondary); font-size:13px; ${overdue ? 'color:#ef4444; font-weight:600;' : ''}">${formatDate(p.data_prevista_entrega)}</td>
                <td style="text-align:center; font-size:13px; color:var(--text-secondary);">${nItens}</td>
                <td style="text-align:right; font-weight:600; color:var(--text-primary);">${formatCurrency(p.valor_total)}</td>
                <td style="text-align:center;">${badgeHtml(p.status)}</td>
                <td style="text-align:center; white-space:nowrap;">${acoes}</td>
            </tr>`;
        }).join('');
    }

    // Expõe globalmente para refreshAllUI()
    window.renderPedidosCompra = renderPedidosCompra;

    // -----------------------------------------------------------------------
    // MODAL #1 — NOVO PEDIDO / EDITAR RASCUNHO
    // -----------------------------------------------------------------------
    let _itemRowCounter = 0;

    function openModalNovoPedido(pedidoId = null) {
        const DB  = getDB();
        const overlay = document.getElementById('modal-pedido-compra-overlay');
        if (!overlay) return;

        // Reset
        document.getElementById('modal-pedido-id').value          = pedidoId || '';
        document.getElementById('modal-pedido-titulo').textContent = pedidoId ? 'Editar Rascunho' : 'Novo Pedido de Compra';
        document.getElementById('modal-pedido-data-entrega').value = '';
        document.getElementById('modal-pedido-itens-tbody').innerHTML = '';
        document.getElementById('modal-pedido-total').textContent  = 'R$ 0,00';
        _itemRowCounter = 0;

        // Popula fornecedores
        const selForn = document.getElementById('modal-pedido-fornecedor');
        selForn.innerHTML = '<option value="">Selecione um fornecedor…</option>' +
            (DB.fornecedores || []).map(f => `<option value="${f.id}">${f.nome}</option>`).join('');

        // Se edição de rascunho, preenche dados existentes
        if (pedidoId) {
            const pedido = (DB.pedidos_compra || []).find(p => p.id === pedidoId);
            if (pedido) {
                selForn.value = pedido.fornecedor_id || '';
                if (pedido.data_prevista_entrega) {
                    document.getElementById('modal-pedido-data-entrega').value =
                        pedido.data_prevista_entrega.split('T')[0];
                }
                // Carrega itens existentes
                const itens = (DB.pedidos_compra_itens || []).filter(i => i.pedido_id === pedidoId);
                itens.forEach(item => addItemRow(item));
            }
        } else {
            addItemRow();
        }

        overlay.style.display = 'flex';
    }

    function addItemRow(existingItem = null) {
        const DB   = getDB();
        const tbody = document.getElementById('modal-pedido-itens-tbody');
        if (!tbody) return;

        _itemRowCounter++;
        const idx = _itemRowCounter;

        // Opções de produtos
        const prodOptions = '<option value="">Selecione…</option>' +
            (DB.produtos || []).map(p => `<option value="${p.id}" data-custo="${p.preco_custo}">${p.nome}</option>`).join('');

        // Opções de variantes (dinâmico por produto selecionado)
        const varOptions = '<option value="">Selecione o produto primeiro</option>';

        const qtd    = existingItem ? existingItem.quantidade_solicitada : '';
        const preco  = existingItem ? existingItem.preco_unitario : '';
        const sub    = existingItem ? formatCurrency(existingItem.subtotal || 0) : 'R$ 0,00';
        const prodId = existingItem ? existingItem.produto_id : '';
        const varId  = existingItem ? existingItem.variante_id : '';

        const tr = document.createElement('tr');
        tr.dataset.rowIdx = idx;
        tr.id = `item-row-${idx}`;
        tr.innerHTML = `
            <td style="padding:8px;">
                <select class="form-control" id="item-prod-${idx}" style="font-size:12px; padding:6px 8px;" onchange="window.Compras._onProdChange(${idx})" data-row="${idx}">
                    ${prodOptions}
                </select>
            </td>
            <td style="padding:8px;">
                <select class="form-control" id="item-var-${idx}" style="font-size:12px; padding:6px 8px;" data-row="${idx}">
                    ${varOptions}
                </select>
            </td>
            <td style="padding:8px; text-align:center;">
                <input type="number" class="form-control" id="item-qty-${idx}" value="${qtd}" min="1" style="font-size:12px; padding:6px 8px; text-align:center; width:70px;" oninput="window.Compras._recalcRow(${idx})">
            </td>
            <td style="padding:8px; text-align:right;">
                <input type="number" class="form-control" id="item-preco-${idx}" value="${preco}" min="0" step="0.01" style="font-size:12px; padding:6px 8px; text-align:right; width:90px;" oninput="window.Compras._recalcRow(${idx})">
            </td>
            <td style="padding:8px; text-align:right; font-weight:600; color:var(--text-primary); font-size:13px; white-space:nowrap;" id="item-sub-${idx}">${sub}</td>
            <td style="padding:8px; text-align:center;">
                <button type="button" onclick="window.Compras._removeRow(${idx})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:14px; padding:4px;" title="Remover item"><i class="fas fa-trash-alt"></i></button>
            </td>
        `;
        tbody.appendChild(tr);

        // Se editando item existente, seleciona produto e carrega variantes
        if (prodId) {
            const selProd = document.getElementById(`item-prod-${idx}`);
            if (selProd) {
                selProd.value = prodId;
                _loadVariantes(idx, prodId, varId);
            }
        }
    }

    function _onProdChange(idx) {
        const selProd = document.getElementById(`item-prod-${idx}`);
        const prodId  = selProd ? selProd.value : '';
        // Preenche preço de custo como sugestão de preço unitário
        const opt = selProd ? selProd.querySelector(`option[value="${prodId}"]`) : null;
        const custo = opt ? parseFloat(opt.dataset.custo || 0) : 0;
        const inpPreco = document.getElementById(`item-preco-${idx}`);
        if (inpPreco && !inpPreco.value) inpPreco.value = custo.toFixed(2);

        _loadVariantes(idx, prodId, null);
        _recalcRow(idx);
    }

    function _loadVariantes(idx, prodId, selectedVarId) {
        const DB   = getDB();
        const selVar = document.getElementById(`item-var-${idx}`);
        if (!selVar) return;

        const variantes = (DB.produto_variantes || []).filter(v => v.produto_id === prodId);
        if (variantes.length === 0) {
            selVar.innerHTML = '<option value="">Sem variantes cadastradas</option>';
        } else {
            selVar.innerHTML = '<option value="">Selecione…</option>' +
                variantes.map(v =>
                    `<option value="${v.id}" ${v.id === selectedVarId ? 'selected' : ''}>
                        ${v.tamanho} (Estoque: ${v.estoque_atual})
                    </option>`
                ).join('');
        }
    }

    function _recalcRow(idx) {
        const qty   = parseFloat(document.getElementById(`item-qty-${idx}`)?.value || 0);
        const preco = parseFloat(document.getElementById(`item-preco-${idx}`)?.value || 0);
        const sub   = qty * preco;
        const elSub = document.getElementById(`item-sub-${idx}`);
        if (elSub) elSub.textContent = formatCurrency(sub);
        _recalcTotal();
    }

    function _recalcTotal() {
        const tbody = document.getElementById('modal-pedido-itens-tbody');
        if (!tbody) return;
        let total = 0;
        tbody.querySelectorAll('tr').forEach(tr => {
            const idx   = tr.dataset.rowIdx;
            const qty   = parseFloat(document.getElementById(`item-qty-${idx}`)?.value || 0);
            const preco = parseFloat(document.getElementById(`item-preco-${idx}`)?.value || 0);
            total += qty * preco;
        });
        const elTotal = document.getElementById('modal-pedido-total');
        if (elTotal) elTotal.textContent = formatCurrency(total);
    }

    function _removeRow(idx) {
        const tr = document.getElementById(`item-row-${idx}`);
        if (tr) tr.remove();
        _recalcTotal();
    }

    // -----------------------------------------------------------------------
    // SALVAR PEDIDO (Rascunho ou Aguardando Aprovação)
    // -----------------------------------------------------------------------
    async function savePedido(targetStatus) {
        const currentUser = getCurrentUser();
        if (!currentUser) return;

        const pedidoId    = document.getElementById('modal-pedido-id').value;
        const fornecedorId = document.getElementById('modal-pedido-fornecedor').value;
        const dataEntrega  = document.getElementById('modal-pedido-data-entrega').value;

        if (!fornecedorId) {
            alert('Selecione um fornecedor para o pedido.');
            return;
        }

        // Coleta linhas de itens
        const tbody = document.getElementById('modal-pedido-itens-tbody');
        const rows  = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];
        const itens = rows.map(tr => {
            const idx  = tr.dataset.rowIdx;
            return {
                produto_id:           document.getElementById(`item-prod-${idx}`)?.value || null,
                variante_id:          document.getElementById(`item-var-${idx}`)?.value  || null,
                quantidade_solicitada: parseInt(document.getElementById(`item-qty-${idx}`)?.value || 0),
                preco_unitario:        parseFloat(document.getElementById(`item-preco-${idx}`)?.value || 0),
            };
        }).filter(i => i.produto_id && i.quantidade_solicitada > 0);

        if (itens.length === 0) {
            alert('Adicione pelo menos um item com produto e quantidade.');
            return;
        }

        const btnRasc = document.getElementById('btn-salvar-rascunho');
        const btnAprov = document.getElementById('btn-enviar-aprovacao');
        [btnRasc, btnAprov].forEach(b => { if (b) { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; } });

        try {
            let capId = pedidoId;

            if (!pedidoId) {
                // INSERT nova capa
                const capData = {
                    fornecedor_id:        fornecedorId,
                    comprador_id:         currentUser.id,
                    data_prevista_entrega: dataEntrega || null,
                    status:               targetStatus,
                    valor_total:          0,
                };
                const { data: newCap, error: capErr } = await supabase
                    .from('pedidos_compra')
                    .insert([capData])
                    .select()
                    .single();
                if (capErr) throw capErr;
                capId = newCap.id;
                logSQL(`INSERT pedidos_compra: ${capId} (${targetStatus})`);
            } else {
                // UPDATE capa existente (rascunho → novo status)
                const { error: updErr } = await supabase
                    .from('pedidos_compra')
                    .update({
                        fornecedor_id:        fornecedorId,
                        data_prevista_entrega: dataEntrega || null,
                        status:               targetStatus,
                    })
                    .eq('id', pedidoId);
                if (updErr) throw updErr;
                logSQL(`UPDATE pedidos_compra: ${pedidoId} → ${targetStatus}`);

                // Remove itens antigos (reescrita completa)
                await supabase.from('pedidos_compra_itens').delete().eq('pedido_id', pedidoId);
            }

            // INSERT itens (um por um para acionar a trigger de valor_total)
            for (const item of itens) {
                const { error: itemErr } = await supabase
                    .from('pedidos_compra_itens')
                    .insert([{ ...item, pedido_id: capId }]);
                if (itemErr) throw itemErr;
            }
            logSQL(`INSERT ${itens.length} pedidos_compra_itens para pedido ${capId}`);

            closeModalPedido();
            await window.syncDBFromSupabase();
            renderPedidosCompra();

            const msg = targetStatus === 'Rascunho'
                ? '✅ Rascunho salvo! Edite quando quiser antes de enviar para aprovação.'
                : '📨 Pedido enviado para aprovação! Aguarde a autorização da Tesouraria.';
            alert(msg);

        } catch (err) {
            console.error('[Compras] Erro ao salvar pedido:', err);
            alert(`Erro ao salvar pedido: ${err.message || 'Verifique o console para detalhes.'}`);
        } finally {
            if (btnRasc)  { btnRasc.disabled  = false; btnRasc.innerHTML  = '<i class="fas fa-save"></i> Salvar Rascunho'; }
            if (btnAprov) { btnAprov.disabled = false; btnAprov.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar para Aprovação'; }
        }
    }

    function closeModalPedido() {
        const overlay = document.getElementById('modal-pedido-compra-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // -----------------------------------------------------------------------
    // APROVAR PEDIDO
    // -----------------------------------------------------------------------
    async function aprovarPedido(pedidoId) {
        if (!canAprovar()) {
            alert('Você não possui permissão para aprovar pedidos de compra.\nRequer alçada da Tesouraria ou Executivo.');
            return;
        }

        const DB     = getDB();
        const pedido = (DB.pedidos_compra || []).find(p => p.id === pedidoId);
        if (!pedido) return;

        const confirmMsg = `Confirmar aprovação do pedido de ${
            (DB.fornecedores || []).find(f => f.id === pedido.fornecedor_id)?.nome || '—'
        } no valor de ${formatCurrency(pedido.valor_total)}?\n\n` +
        `Um lançamento de Saída será gerado automaticamente no Livro Caixa (não conciliado).`;

        if (!confirm(confirmMsg)) return;

        try {
            const { error } = await supabase
                .from('pedidos_compra')
                .update({ status: 'Aprovado' })
                .eq('id', pedidoId);
            if (error) throw error;

            logSQL(`UPDATE pedidos_compra: ${pedidoId} → Aprovado (Trigger: lançamento financeiro gerado)`, 'trigger');
            await window.syncDBFromSupabase();
            renderPedidosCompra();
            alert('✅ Pedido aprovado! Lançamento financeiro de Saída criado automaticamente na Tesouraria (não conciliado).');

        } catch (err) {
            console.error('[Compras] Erro ao aprovar pedido:', err);
            alert(`Erro ao aprovar: ${err.message || 'Verifique suas permissões.'}`);
        }
    }

    // -----------------------------------------------------------------------
    // CANCELAR PEDIDO
    // -----------------------------------------------------------------------
    async function cancelarPedido(pedidoId) {
        if (!confirm('Tem certeza que deseja cancelar este pedido?\nEsta ação não pode ser desfeita.')) return;

        try {
            const { error } = await supabase
                .from('pedidos_compra')
                .update({ status: 'Cancelado' })
                .eq('id', pedidoId);
            if (error) throw error;

            logSQL(`UPDATE pedidos_compra: ${pedidoId} → Cancelado`);
            await window.syncDBFromSupabase();
            renderPedidosCompra();

        } catch (err) {
            console.error('[Compras] Erro ao cancelar pedido:', err);
            alert(`Erro ao cancelar: ${err.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // VIEW PEDIDO (modo leitura — qualquer status não editável)
    // -----------------------------------------------------------------------
    function viewPedido(pedidoId) {
        // Abre o modal em modo somente-leitura (botões de ação ocultos)
        openModalNovoPedido(pedidoId);
        document.getElementById('modal-pedido-titulo').textContent = 'Detalhes do Pedido';
        document.getElementById('modal-pedido-subtitulo').textContent = 'Visualização somente-leitura';
        document.getElementById('btn-salvar-rascunho').style.display  = 'none';
        document.getElementById('btn-enviar-aprovacao').style.display = 'none';
        document.getElementById('btn-add-item-row').style.display     = 'none';
    }

    // -----------------------------------------------------------------------
    // MODAL #2 — REGISTRAR ENTREGA / BAIXA
    // -----------------------------------------------------------------------
    async function openModalRecebimento(pedidoId) {
        const DB      = getDB();
        const overlay = document.getElementById('modal-recebimento-overlay');
        if (!overlay) return;

        const pedido  = (DB.pedidos_compra || []).find(p => p.id === pedidoId);
        const forn    = pedido ? (DB.fornecedores || []).find(f => f.id === pedido.fornecedor_id) : null;

        document.getElementById('modal-receb-pedido-id').value    = pedidoId;
        document.getElementById('modal-receb-titulo').textContent = `Recebimento — ${forn ? forn.nome : 'Pedido'}`;
        document.getElementById('modal-receb-subtitulo').textContent =
            `Status: ${pedido ? pedido.status : '—'} | Previsão: ${pedido ? formatDate(pedido.data_prevista_entrega) : '—'}`;

        // Carrega itens do pedido
        const itens = (DB.pedidos_compra_itens || []).filter(i => i.pedido_id === pedidoId);
        const produtos  = DB.produtos || [];
        const variantes = DB.produto_variantes || [];

        const tbody = document.getElementById('modal-receb-itens-tbody');
        if (tbody) {
            tbody.innerHTML = itens.map(item => {
                const prod = produtos.find(p => p.id === item.produto_id);
                const vari = variantes.find(v => v.id === item.variante_id);
                const saldo = (item.quantidade_solicitada || 0) - (item.quantidade_recebida || 0);
                const nomeProd = [prod?.nome, vari ? `(${vari.tamanho})` : ''].filter(Boolean).join(' ');

                return `<tr>
                    <td style="padding:10px 12px; font-size:13px; color:var(--text-primary);">${nomeProd}</td>
                    <td style="padding:10px 12px; text-align:center; font-size:13px;">${item.quantidade_solicitada}</td>
                    <td style="padding:10px 12px; text-align:center; font-size:13px; color:#22c55e;">${item.quantidade_recebida}</td>
                    <td style="padding:10px 12px; text-align:center; font-size:13px; font-weight:600; color:${saldo > 0 ? 'var(--text-primary)' : '#9ca3af'};">${saldo}</td>
                    <td style="padding:8px 12px; text-align:center;">
                        ${saldo > 0
                            ? `<input type="number" class="form-control" data-item-id="${item.id}" data-saldo="${saldo}"
                                  min="0" max="${saldo}" value="0"
                                  style="width:70px; text-align:center; font-size:12px; padding:5px;">`
                            : '<span style="font-size:11px; color:#9ca3af;">Concluído</span>'
                        }
                    </td>
                </tr>`;
            }).join('');
        }

        // Carrega histórico de recebimentos (do DB em memória ou via REST)
        await renderHistoricoRecebimentos(pedidoId, itens);

        overlay.style.display = 'flex';
    }

    async function renderHistoricoRecebimentos(pedidoId, itens) {
        const el = document.getElementById('modal-receb-historico');
        if (!el) return;

        const itemIds = itens.map(i => i.id);
        if (itemIds.length === 0) {
            el.innerHTML = '<p style="font-size:12px; color:var(--text-secondary);">Nenhum recebimento registrado ainda.</p>';
            return;
        }

        // Busca log_recebimentos via REST (não cached no DB em memória por padrão)
        const DB = getDB();
        let logs = (DB.log_recebimentos || []).filter(l => itemIds.includes(l.item_id));

        // Se não há dados no cache, busca direto via REST
        if (logs.length === 0) {
            const { data } = await supabase
                .from('log_recebimentos')
                .select('*')
                .in('item_id', itemIds)
                .order('created_at', { ascending: false });
            logs = data || [];
        }

        if (logs.length === 0) {
            el.innerHTML = '<p style="font-size:12px; color:var(--text-secondary); font-style:italic;">Nenhum recebimento registrado ainda.</p>';
            return;
        }

        const usuarios = DB.usuarios || [];
        const produtos  = DB.produtos || [];
        const variantes = DB.produto_variantes || [];

        el.innerHTML = `<div style="overflow-x:auto; border-radius:8px; border:1px solid var(--border-glass);">
            <table style="width:100%; font-size:12px;">
                <thead>
                    <tr style="background:rgba(255,255,255,0.04);">
                        <th style="padding:8px 10px; color:var(--text-secondary); font-weight:600; text-align:left;">Data</th>
                        <th style="padding:8px 10px; color:var(--text-secondary); font-weight:600; text-align:left;">Item</th>
                        <th style="padding:8px 10px; color:var(--text-secondary); font-weight:600; text-align:center;">Qtd Baixada</th>
                        <th style="padding:8px 10px; color:var(--text-secondary); font-weight:600; text-align:left;">Recebedor</th>
                        <th style="padding:8px 10px; color:var(--text-secondary); font-weight:600; text-align:center;">SLA</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.map(log => {
                        const item = itens.find(i => i.id === log.item_id);
                        const prod = item ? produtos.find(p => p.id === item.produto_id) : null;
                        const vari = item ? variantes.find(v => v.id === item.variante_id) : null;
                        const user = usuarios.find(u => u.id === log.recebedor_id);
                        const nomeProd = [prod?.nome, vari ? `(${vari.tamanho})` : ''].filter(Boolean).join(' ');

                        // SLA: compara data prevista com data real
                        let slaHtml = '—';
                        if (log.data_prevista_original && log.data_recebimento_real) {
                            const prev = new Date(log.data_prevista_original);
                            const real = new Date(log.data_recebimento_real);
                            const diff = Math.round((real - prev) / (1000 * 60 * 60 * 24));
                            if (diff <= 0) {
                                slaHtml = `<span style="color:#22c55e; font-weight:600;">✅ No Prazo</span>`;
                            } else {
                                slaHtml = `<span style="color:#ef4444; font-weight:600;">⚠ ${diff}d atraso</span>`;
                            }
                        }

                        return `<tr>
                            <td style="padding:8px 10px; color:var(--text-secondary);">${formatDate(log.data_recebimento_real)}</td>
                            <td style="padding:8px 10px; color:var(--text-primary);">${nomeProd || '—'}</td>
                            <td style="padding:8px 10px; text-align:center; font-weight:600;">${log.quantidade_baixada}</td>
                            <td style="padding:8px 10px; color:var(--text-secondary);">${user?.nome || 'Usuário'}</td>
                            <td style="padding:8px 10px; text-align:center;">${slaHtml}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
    }

    async function registrarEntrega() {
        const currentUser = getCurrentUser();
        if (!currentUser) return;

        const pedidoId = document.getElementById('modal-receb-pedido-id').value;
        if (!pedidoId) return;

        const inputs = document.querySelectorAll('#modal-receb-itens-tbody input[data-item-id]');
        const baixas = [];

        inputs.forEach(inp => {
            const qty  = parseInt(inp.value || 0);
            const saldo = parseInt(inp.dataset.saldo || 0);
            if (qty > 0) {
                if (qty > saldo) {
                    throw new Error(`Quantidade ${qty} excede o saldo disponível de ${saldo}.`);
                }
                baixas.push({ item_id: inp.dataset.itemId || inp.dataset['item-id'] || inp.getAttribute('data-item-id'), quantidade_baixada: qty });
            }
        });

        if (baixas.length === 0) {
            alert('Informe ao menos uma quantidade a receber.');
            return;
        }

        const btnConf = document.getElementById('btn-confirmar-recebimento');
        if (btnConf) { btnConf.disabled = true; btnConf.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando…'; }

        try {
            for (const baixa of baixas) {
                const { error } = await supabase
                    .from('log_recebimentos')
                    .insert([{
                        item_id:           baixa.item_id,
                        quantidade_baixada: baixa.quantidade_baixada,
                        recebedor_id:      currentUser.id,
                    }]);
                if (error) throw error;
                logSQL(`INSERT log_recebimentos: item ${baixa.item_id} → ${baixa.quantidade_baixada} unidades (Trigger: estoque + status atualizados)`, 'trigger');
            }

            closeModalRecebimento();
            await window.syncDBFromSupabase();
            renderPedidosCompra();
            alert(`✅ Recebimento registrado com sucesso!\nEstoque e status do pedido atualizados automaticamente.`);

        } catch (err) {
            console.error('[Compras] Erro ao registrar entrega:', err);
            alert(`Erro ao registrar recebimento: ${err.message}`);
        } finally {
            if (btnConf) { btnConf.disabled = false; btnConf.innerHTML = '<i class="fas fa-check-circle"></i> Confirmar Recebimento'; }
        }
    }

    function closeModalRecebimento() {
        const overlay = document.getElementById('modal-recebimento-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // -----------------------------------------------------------------------
    // EVENT LISTENERS
    // -----------------------------------------------------------------------
    function bindEvents() {
        // Botão Novo Pedido
        const btnNovo = document.getElementById('btn-novo-pedido-compra');
        if (btnNovo) {
            btnNovo.addEventListener('click', () => openModalNovoPedido());
        }

        // Botão Adicionar Item no Modal
        const btnAddItem = document.getElementById('btn-add-item-row');
        if (btnAddItem) {
            btnAddItem.addEventListener('click', () => addItemRow());
        }

        // Botões de salvar/enviar no Modal Pedido
        const btnRasc  = document.getElementById('btn-salvar-rascunho');
        const btnAprov = document.getElementById('btn-enviar-aprovacao');
        if (btnRasc)  btnRasc.addEventListener('click',  () => savePedido('Rascunho'));
        if (btnAprov) btnAprov.addEventListener('click', () => savePedido('Aguardando Aprovação'));

        // Fechar Modal Pedido
        const btnClosePedido = document.getElementById('btn-close-modal-pedido');
        if (btnClosePedido) btnClosePedido.addEventListener('click', closeModalPedido);
        const overlayPedido  = document.getElementById('modal-pedido-compra-overlay');
        if (overlayPedido) {
            overlayPedido.addEventListener('click', e => {
                if (e.target === overlayPedido) closeModalPedido();
            });
        }

        // Botão Confirmar Recebimento
        const btnConf = document.getElementById('btn-confirmar-recebimento');
        if (btnConf) btnConf.addEventListener('click', registrarEntrega);

        // Fechar Modal Recebimento
        const btnCloseReceb   = document.getElementById('btn-close-modal-recebimento');
        const btnCancelReceb  = document.getElementById('btn-cancelar-modal-recebimento');
        if (btnCloseReceb)  btnCloseReceb.addEventListener('click', closeModalRecebimento);
        if (btnCancelReceb) btnCancelReceb.addEventListener('click', closeModalRecebimento);
        const overlayReceb = document.getElementById('modal-recebimento-overlay');
        if (overlayReceb) {
            overlayReceb.addEventListener('click', e => {
                if (e.target === overlayReceb) closeModalRecebimento();
            });
        }
    }

    // -----------------------------------------------------------------------
    // NAMESPACE PÚBLICO (referenciado pelos onclick embutidos no HTML gerado)
    // -----------------------------------------------------------------------
    window.Compras = {
        openModalNovoPedido,
        openModalRecebimento,
        aprovarPedido,
        cancelarPedido,
        viewPedido,
        _onProdChange,
        _recalcRow,
        _removeRow,
    };

    // Inicialização
    bindEvents();
    renderPedidosCompra();

    console.log('[Compras] Módulo Supply Chain v1.2 inicializado.');
};
