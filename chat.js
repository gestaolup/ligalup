// ============================================================================
// CHAT.JS â€” MÃ³dulo de ComunicaÃ§Ã£o Interna (Chat + Realtime) â€” LIGA-LUP
//
// Responsabilidade: toda a lÃ³gica de chat: estado, renderizaÃ§Ã£o de conversas,
// envio/recepÃ§Ã£o de mensagens (Supabase Realtime/WebSocket), modal de nova
// conversa e exposiÃ§Ã£o da API pÃºblica window.ChatModule.
//
// DependÃªncias recebidas via window (expostas pelo app.js antes do DOMContentLoaded):
//   - window.supabase  â†’ cliente Supabase jÃ¡ instanciado
//   - window.DB        â†’ banco de dados em memÃ³ria (sincronizado via syncDBFromSupabase)
//   - window.currentUser â†’ usuÃ¡rio autenticado (pode ser null antes do login)
//   - window.syncDBFromSupabase â†’ sincroniza DB com o Supabase
//
// API PÃºblica exposta (usada pelo app.js e index.html):
//   - window.ChatModule.init()
//   - window.ChatModule.destroy()
//   - window.ChatModule.openConversation(id)
//   - window.ChatModule.sendMessage()
//   - window.ChatModule.renderContextualCommentPanel(entityType, entityId, container)
// ============================================================================

// â”€â”€ 1. ESTADO INTERNO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let chatState = {
  selectedConversationId: null,
  conversations: [],
  filteredConversations: [],
};

let newChatState = { 
  selectedUserId: null,
  isGroupMode: false,
  selectedUserIds: []
};

// â”€â”€ 2. BUILDER DE DADOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildChatFromDB() {
    const DB = window.DB;
    if (!DB || !window.currentUser) return [];

    DB.chat_grupos = DB.chat_grupos || [];
    DB.chat_membros_grupo = DB.chat_membros_grupo || [];
    DB.chat_conversations = DB.chat_conversations || [];

    const myConvIds = new Set(
        (DB.chat_participants || [])
            .filter(p => p.user_id === window.currentUser.id)
            .map(p => p.conversation_id)
    );
    const visibleConvs = DB.chat_conversations.filter(conv =>
        conv.type === 'Grupo' || myConvIds.has(conv.id)
    );

    const myGroupIds = new Set(
        DB.chat_membros_grupo
            .filter(m => m.user_id === window.currentUser.id)
            .map(m => m.grupo_id)
    );
    const newGroups = DB.chat_grupos.filter(g => myGroupIds.has(g.id));

    const unifiedList = [
        ...visibleConvs.map(c => ({ id: c.id, name: c.name, type: c.type, dbType: 'legacy' })),
        ...newGroups.map(g => ({ id: g.id, name: g.nome, type: 'Grupo', dbType: 'new' }))
    ];

    return unifiedList.map(item => {
        const msgs = (DB.chat_messages || []).filter(m => m.conversation_id === item.id || m.grupo_id === item.id)
            .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
            .map(m => {
                const isMe = window.currentUser && m.sender_id === window.currentUser.id;
                const senderUser = DB.usuarios.find(u => u.id === m.sender_id);
                return {
                    id: m.id,
                    senderId: isMe ? 'me' : m.sender_id,
                    senderName: isMe ? 'Eu' : (senderUser ? senderUser.nome : 'UsuÃ¡rio'),
                    text: m.body,
                    time: new Date(m.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    rawTimestamp: new Date(m.sent_at).getTime()
                };
            });
        const lastMsg = msgs[msgs.length - 1];
        return {
            id: item.id,
            name: item.name,
            role: item.type,
            dbType: item.dbType,
            avatar: null,
            lastMessage: lastMsg ? lastMsg.text : 'Sem mensagens',
            timestamp: lastMsg ? lastMsg.time : '',
            sortValue: lastMsg ? lastMsg.rawTimestamp : 0,
            unread: 0,
            messages: msgs
        };
    }).sort((a, b) => b.sortValue - a.sortValue);
}

// â”€â”€ 3. INICIALIZAÃ‡ÃƒO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initChatModule() {
  chatState.conversations = buildChatFromDB();
  chatState.filteredConversations = [...chatState.conversations];

  // Gerenciamento correto do ciclo de vida do canal
  if (window._chatChannel) {
      window.supabaseClient.removeChannel(window._chatChannel);
      window._chatChannel = null;
      console.log('[Chat Realtime Lifecycle] Canal anterior removido para evitar duplicidade.');
  }

  window._chatChannel = window.supabaseClient.channel('chat-realtime')

    // â”€â”€ Novas mensagens â”€â”€
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        const newMsg = payload.new;
        const DB = window.DB;
        if (DB.chat_messages.find(m => m.id === newMsg.id)) return; // Failsafe deduplication

        console.log('[Chat Realtime] Nova mensagem recebida:', newMsg.id);
        DB.chat_messages.push(newMsg);
        chatState.conversations = buildChatFromDB();
        chatState.filteredConversations = [...chatState.conversations];

        if (chatState.selectedConversationId) {
            openConversation(chatState.selectedConversationId);
        } else {
            renderConversationList(chatState.filteredConversations);
        }
    })

    // â”€â”€ Novas conversas (recebimento passivo) â”€â”€
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_conversations' }, payload => {
        const newConv = payload.new;
        const DB = window.DB;
        if (!DB.chat_conversations.find(c => c.id === newConv.id)) {
            console.log('[Chat Realtime] Nova conversa detectada:', newConv.id);
            DB.chat_conversations.push(newConv);
            chatState.conversations = buildChatFromDB();
            chatState.filteredConversations = [...chatState.conversations];
            renderConversationList(chatState.filteredConversations);
        }
    })

    // â”€â”€ Novo participante (gatilho de consistÃªncia) â”€â”€
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_participants' }, async payload => {
        const newPart = payload.new;
        const DB = window.DB;
        const exists = DB.chat_participants.find(
            p => p.conversation_id === newPart.conversation_id && p.user_id === newPart.user_id
        );
        if (!exists) {
            console.log('[Chat Realtime] Novo participante detectado:', newPart.user_id);
            (DB.chat_participants = DB.chat_participants || []).push(newPart);
        }

        // Self-healing: Se o participante for o usuÃ¡rio atual, garante que temos a conversa em memÃ³ria
        if (window.currentUser && newPart.user_id === window.currentUser.id) {
            const convExists = DB.chat_conversations.find(c => c.id === newPart.conversation_id);
            if (!convExists) {
                console.warn('[Chat Consistency] Recebeu participante mas a conversa ainda nÃ£o chegou. Buscando fallback...');
                const { data } = await window.supabaseClient.from('chat_conversations').select('*').eq('id', newPart.conversation_id).single();
                if (data && !DB.chat_conversations.find(c => c.id === data.id)) {
                    DB.chat_conversations.push(data);
                }
            }
            chatState.conversations = buildChatFromDB();
            chatState.filteredConversations = [...chatState.conversations];
            renderConversationList(chatState.filteredConversations);
        }
    })
    // â”€â”€ Novo grupo (recebimento passivo) â”€â”€
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_grupos' }, payload => {
        const DB = window.DB;
        DB.chat_grupos = DB.chat_grupos || [];
        if (!DB.chat_grupos.find(g => g.id === payload.new.id)) {
            DB.chat_grupos.push(payload.new);
        }
    })
    // â”€â”€ Novo membro de grupo â”€â”€
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_membros_grupo' }, payload => {
        const DB = window.DB;
        DB.chat_membros_grupo = DB.chat_membros_grupo || [];
        if (!DB.chat_membros_grupo.find(m => m.grupo_id === payload.new.grupo_id && m.user_id === payload.new.user_id)) {
            DB.chat_membros_grupo.push(payload.new);
        }
        if (window.currentUser && payload.new.user_id === window.currentUser.id) {
            chatState.conversations = buildChatFromDB();
            chatState.filteredConversations = [...chatState.conversations];
            renderConversationList(chatState.filteredConversations);
        }
    })

    // â”€â”€ Auditoria de Lifecycle do Realtime â”€â”€
    .subscribe((status, err) => {
        console.log(`[Chat Realtime Lifecycle] TransiÃ§Ã£o de estado: ${status}`, err ? err : '');
        if (status === 'SUBSCRIBED') {
            console.log('[Chat Realtime Lifecycle] âœ… ConexÃ£o estabelecida. Escutando eventos de forma atÃ´mica.');
        } else if (status === 'CHANNEL_ERROR') {
            console.error('[Chat Realtime Lifecycle] âŒ Erro de canal. O motor do Supabase recusou a conexÃ£o (Verifique RLS/Publication).');
        } else if (status === 'CLOSED') {
            console.warn('[Chat Realtime Lifecycle] ðŸ”Œ Canal fechado.');
        } else if (status === 'TIMED_OUT') {
            console.warn('[Chat Realtime Lifecycle] â³ ConexÃ£o expirou. O SupabaseJS iniciarÃ¡ reconnect automÃ¡tico.');
        }
    });

  renderConversationList(chatState.filteredConversations);
  bindChatEvents();
  bindNewChatModalEvents();
}

// â”€â”€ 4. RENDER DA LISTA DE CONVERSAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderConversationList(conversations) {
  const loadingEl  = document.getElementById('chat-loading-state');
  const emptyEl    = document.getElementById('chat-empty-state');
  const listEl     = document.getElementById('conversations-list');

  // Guarda defensiva: se elementos nÃ£o existem, o mÃ³dulo nÃ£o estÃ¡ ativo
  if (!listEl) return;

  // Oculta o loading spinner
  if (loadingEl) loadingEl.style.display = 'none';

  if (!conversations || conversations.length === 0) {
    listEl.style.display  = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  listEl.style.display = 'block';

  listEl.innerHTML = conversations.map(conv => {
    const initials  = (conv.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const isActive  = conv.id === chatState.selectedConversationId;
    const unreadBadge = conv.unread > 0
      ? `<span class="conv-unread-badge">${conv.unread}</span>`
      : '';

    return `
      <li
        class="conversation-item ${isActive ? 'active' : ''}"
        data-conv-id="${conv.id}"
        role="button"
        tabindex="0"
        aria-label="Conversa com ${conv.name}"
      >
        <div class="conv-avatar">${initials}</div>
        <div class="conv-info">
          <div class="conv-top">
            <span class="conv-name">${conv.name ?? 'UsuÃ¡rio'}</span>
            <span class="conv-time">${conv.timestamp ?? ''}</span>
          </div>
          <div class="conv-bottom">
            <span class="conv-last-msg">${conv.lastMessage ?? ''}</span>
            ${unreadBadge}
          </div>
        </div>
      </li>
    `;
  }).join('');
}

// â”€â”€ 5. ABRIR CONVERSA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function openConversation(conversationId) {
    console.log('[CHAT] openConversation chamada:', conversationId);
  // Busca com seguranÃ§a
  const conv = chatState.conversations.find(c => c.id === conversationId);

  if (!conv) {
    console.error('[Chat] openConversation: conversa nÃ£o encontrada â†’', conversationId);
    return;
  }

  // Atualiza estado
  chatState.selectedConversationId = conversationId;

  // Marca conversa como lida
  conv.unread = 0;

  // Re-renderiza a lista para atualizar o item ativo e remover badge
  renderConversationList(chatState.filteredConversations);

  // ReferÃªncias aos elementos do painel direito
  const noSelectionEl = document.getElementById('chat-no-selection');
  const activeAreaEl  = document.getElementById('chat-active-area');
  const headerBarEl   = document.getElementById('chat-header-bar');
  const messagesBodyEl = document.getElementById('chat-messages-body');

    console.log('[CHAT] Elementos encontrados:', {
      noSelectionEl,
      activeAreaEl,
      headerBarEl,
      messagesBodyEl
});

  // Guarda defensiva: verifica se todos os elementos existem
  if (!noSelectionEl || !activeAreaEl || !headerBarEl || !messagesBodyEl) {
    console.error('[Chat] openConversation: elementos do DOM nÃ£o encontrados. Verifique os IDs no HTML.');
    return;
  }

  // Alterna visibilidade: oculta placeholder, mostra Ã¡rea de chat
  noSelectionEl.style.display = 'none';
  activeAreaEl.style.display  = 'flex';

console.log('[CHAT] Displays apÃ³s alteraÃ§Ã£o:', {
  noSelection: noSelectionEl.style.display,
  activeArea: activeAreaEl.style.display
});

  // Renderiza o header da conversa
  const initials = (conv.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  headerBarEl.innerHTML = `
    <div class="chat-header-info">
      <div class="conv-avatar conv-avatar--sm">${initials}</div>
      <div class="chat-header-text">
        <strong>${conv.name ?? 'UsuÃ¡rio'}</strong>
        <small>${conv.role ?? ''}</small>
      </div>
    </div>
    <div class="chat-header-actions">
      <button class="btn-icon btn-chat-options" id="btn-chat-options" title="Mais opÃ§Ãµes"><i class="fas fa-ellipsis-v"></i></button>
    </div>
  `;

    // Listener do botÃ£o "..." â€” menu de opÃ§Ãµes da conversa
  const optBtn = document.getElementById('btn-chat-options');
  if (optBtn) {
    optBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var existingMenu = document.getElementById('chat-options-menu');
      if (existingMenu) { existingMenu.remove(); return; }
      var menu = document.createElement('div');
      menu.id = 'chat-options-menu';
      menu.className = 'chat-options-menu';
      menu.innerHTML =
        '<button class="chat-option-item" data-action="clear"><i class="fas fa-trash-alt"></i> Limpar conversa</button>' +
        '<button class="chat-option-item" data-action="mute"><i class="fas fa-bell-slash"></i> Silenciar notificaÃ§Ãµes</button>';
      var rect = optBtn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top  = (rect.bottom + 6) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      document.body.appendChild(menu);
      menu.querySelector('[data-action="clear"]').addEventListener('click', function() {
        var c = chatState.conversations.find(function(x) { return x.id === chatState.selectedConversationId; });
        if (c) { c.messages = []; c.lastMessage = ''; }
        menu.remove();
        openConversation(chatState.selectedConversationId);
        renderConversationList(chatState.filteredConversations);
      });
      menu.querySelector('[data-action="mute"]').addEventListener('click', function() {
        menu.remove();
        var toast = document.createElement('div');
        toast.className = 'chat-toast';
        toast.textContent = 'NotificaÃ§Ãµes silenciadas (simulado).';
        document.body.appendChild(toast);
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2500);
      });
      setTimeout(function() {
        document.addEventListener('click', function closeMenu() {
          var m = document.getElementById('chat-options-menu');
          if (m) m.remove();
          document.removeEventListener('click', closeMenu);
        });
      }, 50);
    });
  }

  // Renderiza mensagens com optional chaining e fallback de array vazio
  const messages = conv?.messages ?? [];

  // Limpa o container antes de construir novo conteÃºdo
  messagesBodyEl.innerHTML = '';

  if (messages.length === 0) {
    // Estado vazio: usa HTML estÃ¡tico sem dados do usuÃ¡rio â€” seguro sem textContent
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'chat-empty-messages';
    emptyDiv.innerHTML = '<i class="fas fa-comment-dots"></i><p>Nenhuma mensagem ainda. Inicie a conversa!</p>';
    messagesBodyEl.appendChild(emptyDiv);
  } else {
    const isGroup = conv.role === 'Grupo';
    messages.forEach(msg => {
      const wrapper = document.createElement('div');
      wrapper.className = `chat-msg ${msg.senderId === 'me' ? 'msg-sent' : 'msg-received'}`;

      if (isGroup && msg.senderId !== 'me') {
          const senderLabel = document.createElement('div');
          senderLabel.className = 'msg-sender-name';
          senderLabel.textContent = msg.senderName;
          senderLabel.style.fontSize = '10px';
          senderLabel.style.fontWeight = 'bold';
          senderLabel.style.color = 'var(--accent)';
          senderLabel.style.marginBottom = '4px';
          wrapper.appendChild(senderLabel);
      }

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      
      const textNode = document.createTextNode(msg.text ?? '');
      bubble.appendChild(textNode);

      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = msg.time ?? '';

      wrapper.appendChild(bubble);
      wrapper.appendChild(time);
      messagesBodyEl.appendChild(wrapper);
    });
  }

  // Scroll automÃ¡tico para a Ãºltima mensagem
  messagesBodyEl.scrollTop = messagesBodyEl.scrollHeight;
}

// â”€â”€ 6. ENVIAR MENSAGEM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function sendMessage() {
  const inputEl = document.getElementById('chat-input-field');
  const sendBtn = document.getElementById('btn-send-message');
  const text    = inputEl?.value?.trim();

  if (!text) return;
  if (!chatState.selectedConversationId) {
      console.warn('[Chat Event] Tentativa de envio sem conversa selecionada.');
      return;
  }
  if (!window.currentUser) {
      console.warn('[Chat Event] UsuÃ¡rio nÃ£o autenticado.');
      return;
  }

  const targetConv = chatState.conversations.find(c => c.id === chatState.selectedConversationId);
  const isNewGroup = targetConv && targetConv.dbType === 'new';

  const newMsg = {
    id: crypto.randomUUID(),
    sender_id: window.currentUser.id,
    body: text,
    sent_at: new Date().toISOString()
  };
  
  if (isNewGroup) {
      newMsg.grupo_id = chatState.selectedConversationId;
  } else {
      newMsg.conversation_id = chatState.selectedConversationId;
  }

  // Limpa o input e bloqueia envio adicional para prevenir double-click
  inputEl.value = '';
  if (sendBtn) sendBtn.disabled = true;

  const { data, error } = await window.supabaseClient.from('chat_messages').insert(newMsg).select();

  if (sendBtn) sendBtn.disabled = false;

  if (error) {
      console.error('[Chat Event] âŒ Falha ao persistir mensagem:', error);
      alert('Erro ao enviar mensagem. Tente novamente.');
      inputEl.value = text; // Rollback: devolve o texto ao input
  } else {
      console.log('[Chat Event] âœ… Mensagem salva. Aguardando eco do Realtime:', data?.[0]?.id);
  }
}

// â”€â”€ 7. BIND DE EVENTOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function bindChatEvents() {
  // DelegaÃ§Ã£o de evento na lista (evita rebind em cada render)
  const listEl = document.getElementById('conversations-list');
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const item = e.target.closest('.conversation-item');
      if (item) {
        openConversation(item.dataset.convId);
      }
    });

    // Acessibilidade: Enter/Space tambÃ©m abre
    listEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const item = e.target.closest('.conversation-item');
        if (item) {
          e.preventDefault();
          openConversation(item.dataset.convId);
        }
      }
    });
  }

  // BotÃ£o enviar
  const sendBtn = document.getElementById('btn-send-message');
  if (sendBtn) {
      // Remove listener anterior clonando o node para evitar acÃºmulo de binds no SPA
      const newSendBtn = sendBtn.cloneNode(true);
      sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
      newSendBtn.addEventListener('click', sendMessage);
  }

  // Enter no input
  const inputField = document.getElementById('chat-input-field');
  if (inputField) {
      const newInputField = inputField.cloneNode(true);
      inputField.parentNode.replaceChild(newInputField, inputField);
      newInputField.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
          }
      });
  }

  // Busca de conversas
  const searchInput = document.getElementById('chat-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      chatState.filteredConversations = chatState.conversations.filter(c =>
        c.name.toLowerCase().includes(query) ||
        (c.lastMessage ?? '').toLowerCase().includes(query)
      );
      renderConversationList(chatState.filteredConversations);
    });
  }
}

// ================================================================
// MÃ“DULO: NOVA CONVERSA â€” Modal de seleÃ§Ã£o de usuÃ¡rio
// ================================================================
// Arquitetura isolada para futura integraÃ§Ã£o Supabase.
// Para integrar, substitua apenas createConversation() por:
//   const { data } = await supabase
//     .from('chat_conversations')
//     .insert({ participant_a: currentUser.id, participant_b: targetUser.id })
//     .select().single();

function openNewChatModal() {
  newChatState.selectedUserId = null;
  newChatState.selectedUserIds = [];
  newChatState.isGroupMode = false;
  
  const typePriv = document.getElementById('btn-chat-type-private');
  const typeGrp = document.getElementById('btn-chat-type-group');
  const nameWrap = document.getElementById('new-group-name-wrapper');
  const nameInput = document.getElementById('new-group-name');
  
  if (typePriv && typeGrp) {
      typePriv.style.borderColor = 'var(--accent)';
      typePriv.style.color = 'var(--accent)';
      typeGrp.style.borderColor = 'transparent';
      typeGrp.style.color = '';
  }
  if (nameWrap) nameWrap.style.display = 'none';
  if (nameInput) nameInput.value = '';

  const overlay  = document.getElementById('new-chat-overlay');
  const searchEl = document.getElementById('new-chat-search');
  const startBtn = document.getElementById('btn-start-conversation');
  if (!overlay) return;
  if (searchEl) searchEl.value = '';
  if (startBtn) {
      startBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Iniciar Conversa';
      startBtn.disabled = true;
  }
  renderNewChatUserList('');
  overlay.classList.add('active');
  setTimeout(function() { if (searchEl) searchEl.focus(); }, 80);
}

function closeNewChatModal() {
  const overlay = document.getElementById('new-chat-overlay');
  if (overlay) overlay.classList.remove('active');
  newChatState.selectedUserId = null;
}

function renderNewChatUserList(query) {
  const listEl  = document.getElementById('new-chat-user-list');
  const emptyEl = document.getElementById('new-chat-empty');
  if (!listEl) return;

  const q = (query || '').toLowerCase().trim();
  // Usa window.DB / window.currentUser para garantir acesso independente de escopo
  var _DB = window.DB;
  var _currentUser = window.currentUser;
  const users = (_DB.usuarios || []).filter(function(u) {
    if (!u.status) return false;
    if (_currentUser && u.id === _currentUser.id) return false;
    if (!q) return true;
    return (
      u.nome.toLowerCase().indexOf(q) !== -1 ||
      u.cargo.toLowerCase().indexOf(q) !== -1 ||
      u.diretoria.toLowerCase().indexOf(q) !== -1
    );
  });

  if (users.length === 0) {
    listEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  listEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = users.map(function(u) {
    const existingConv = chatState.conversations.find(function(c) { return c.participantId === u.id; });
    const parts = u.nome.split(' ');
    const initials = parts.slice(0, 2).map(function(w) { return w[0] || ''; }).join('');
    const isSelected = newChatState.isGroupMode 
        ? newChatState.selectedUserIds.includes(u.id) 
        : newChatState.selectedUserId === u.id;
    const diretoriaLabel = u.diretoria !== 'Nenhuma' ? u.diretoria : 'Geral';
    const existingBadge = (!newChatState.isGroupMode && existingConv)
      ? '<span class="new-chat-badge-existing"><i class="fas fa-comments"></i> Existente</span>'
      : (isSelected ? '<span class="new-chat-badge-existing" style="background:var(--accent);color:#000;"><i class="fas fa-check"></i> Selecionado</span>' : '');
    return (
      '<div class="new-chat-user-item' + (isSelected ? ' selected' : '') + '"' +
        ' data-user-id="' + u.id + '" tabindex="0" role="option" aria-selected="' + isSelected + '">' +
        '<div class="new-chat-avatar">' + initials + '</div>' +
        '<div class="new-chat-user-info">' +
          '<span class="new-chat-user-name">' + u.nome + '</span>' +
          '<span class="new-chat-user-meta">' + u.cargo + ' Â· ' + diretoriaLabel + '</span>' +
        '</div>' +
        existingBadge +
      '</div>'
    );
  }).join('');

  listEl.querySelectorAll('.new-chat-user-item').forEach(function(item) {
    function selectUser() {
      const uId = item.dataset.userId;
      if (newChatState.isGroupMode) {
          const idx = newChatState.selectedUserIds.indexOf(uId);
          if (idx > -1) newChatState.selectedUserIds.splice(idx, 1);
          else newChatState.selectedUserIds.push(uId);
      } else {
          newChatState.selectedUserId = uId;
      }
      
      renderNewChatUserList(document.getElementById('new-chat-search')?.value);
      
      const startBtn = document.getElementById('btn-start-conversation');
      if (startBtn) {
          startBtn.disabled = newChatState.isGroupMode 
              ? newChatState.selectedUserIds.length === 0 
              : !newChatState.selectedUserId;
      }
    }
    item.addEventListener('click', selectUser);
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectUser(); }
    });
  });
}

// â”€â”€ createConversation: criaÃ§Ã£o atÃ´mica via Stored Procedure (RPC) â”€â”€
async function createConversation(targetUser) {
  if (!window.currentUser) return null;

  const DB = window.DB;

  // Verifica duplicata localmente primeiro para evitar request de rede atoa
  const myConvIds = new Set(
      (DB.chat_participants || [])
          .filter(p => p.user_id === window.currentUser.id)
          .map(p => p.conversation_id)
  );
  const theirConvIds = new Set(
      (DB.chat_participants || [])
          .filter(p => p.user_id === targetUser.id)
          .map(p => p.conversation_id)
  );
  const existingId = [...myConvIds].find(id => {
      const conv = DB.chat_conversations.find(c => c.id === id);
      return conv && conv.type === 'Privado' && theirConvIds.has(id);
  });
  if (existingId) {
      console.log('[Chat RPC] Reutilizando conversa privada existente (Local Cache):', existingId);
      return existingId;
  }

  console.log('[Chat RPC] Iniciando transaÃ§Ã£o atÃ´mica para criaÃ§Ã£o de conversa...');

  // Executa RPC AtÃ´mica. O Supabase farÃ¡ tudo num Ãºnico bloco BEGIN/COMMIT.
  const { data: convId, error } = await window.supabaseClient.rpc('create_private_conversation', {
      user1_id: window.currentUser.id,
      user2_id: targetUser.id,
      user1_name: window.currentUser.nome,
      user2_name: targetUser.nome
  });

  if (error) {
      console.error('[Chat RPC] âŒ Falha crÃ­tica na transaÃ§Ã£o:', error);
      alert('NÃ£o foi possÃ­vel iniciar a conversa devido a um erro de integridade do sistema.');
      return null;
  }

  console.log('[Chat RPC] âœ… TransaÃ§Ã£o concluÃ­da. Conversa:', convId);

  // ForÃ§a uma resincronizaÃ§Ã£o do DB local para garantir que possuÃ­mos a
  // conversa e os participantes recÃ©m criados antes de tentar renderizar a interface
  // (caso o Realtime ainda nÃ£o tenha processado em background).
  await window.syncDBFromSupabase();

  chatState.conversations = buildChatFromDB();
  chatState.filteredConversations = [...chatState.conversations];

  return convId;
}

// â”€â”€ bindNewChatModalEvents: registra todos os listeners do modal â”€â”€
function bindNewChatModalEvents() {
  var typePriv = document.getElementById('btn-chat-type-private');
  var typeGrp = document.getElementById('btn-chat-type-group');
  var nameWrap = document.getElementById('new-group-name-wrapper');
  var startBtn = document.getElementById('btn-start-conversation');
  var searchEl = document.getElementById('new-chat-search');

  if (typePriv && typeGrp) {
      typePriv.addEventListener('click', function() {
          newChatState.isGroupMode = false;
          typePriv.style.borderColor = 'var(--accent)';
          typePriv.style.color = 'var(--accent)';
          typeGrp.style.borderColor = 'transparent';
          typeGrp.style.color = '';
          if (nameWrap) nameWrap.style.display = 'none';
          newChatState.selectedUserIds = [];
          newChatState.selectedUserId = null;
          renderNewChatUserList(searchEl?.value);
          if (startBtn) {
              startBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Iniciar Conversa';
              startBtn.disabled = true;
          }
      });
      typeGrp.addEventListener('click', function() {
          newChatState.isGroupMode = true;
          typeGrp.style.borderColor = 'var(--accent)';
          typeGrp.style.color = 'var(--accent)';
          typePriv.style.borderColor = 'transparent';
          typePriv.style.color = '';
          if (nameWrap) nameWrap.style.display = 'block';
          newChatState.selectedUserIds = [];
          newChatState.selectedUserId = null;
          renderNewChatUserList(searchEl?.value);
          if (startBtn) {
              startBtn.innerHTML = '<i class="fas fa-users"></i> Criar Grupo';
              startBtn.disabled = true;
          }
      });
  }

  var btnNew = document.getElementById('btn-new-chat');
  if (btnNew) btnNew.addEventListener('click', openNewChatModal);

  var btnClose = document.getElementById('btn-close-new-chat');
  if (btnClose) btnClose.addEventListener('click', closeNewChatModal);

  var btnCancel = document.getElementById('btn-cancel-new-chat');
  if (btnCancel) btnCancel.addEventListener('click', closeNewChatModal);

  var overlay = document.getElementById('new-chat-overlay');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeNewChatModal();
    });
  }

  var searchEl = document.getElementById('new-chat-search');
  if (searchEl) {
    searchEl.addEventListener('input', function(e) {
      renderNewChatUserList(e.target.value);
    });
  }

  var btnStart = document.getElementById('btn-start-conversation');
  if (btnStart) {
    btnStart.addEventListener('click', async function() {
      if (newChatState.isGroupMode) {
          var groupName = document.getElementById('new-group-name')?.value?.trim();
          if (!groupName) return alert('Digite o nome do grupo.');
          if (newChatState.selectedUserIds.length === 0) return;
          
          btnStart.disabled = true;
          btnStart.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Criando...';
          
          try {
              var newGroup = {
                  id: crypto.randomUUID(),
                  nome: groupName,
                  criador_id: window.currentUser.id,
                  created_at: new Date().toISOString()
              };
              await window.supabaseClient.from('chat_grupos').insert(newGroup);
              
              var members = newChatState.selectedUserIds.map(function(uId) {
                  return { grupo_id: newGroup.id, user_id: uId, papel: 'Membro' };
              });
              members.push({ grupo_id: newGroup.id, user_id: window.currentUser.id, papel: 'Admin' });
              await window.supabaseClient.from('chat_membros_grupo').insert(members);
              
              await window.syncDBFromSupabase();
              chatState.conversations = buildChatFromDB();
              chatState.filteredConversations = [...chatState.conversations];
              
              closeNewChatModal();
              renderConversationList(chatState.filteredConversations);
              openConversation(newGroup.id);
          } catch (err) {
              console.error('[Chat] Erro ao criar grupo:', err);
          } finally {
              btnStart.disabled = false;
              btnStart.innerHTML = '<i class="fas fa-users"></i> Criar Grupo';
          }
      } else {
          if (!newChatState.selectedUserId) return;
          var targetUser = window.DB.usuarios.find(u => u.id === newChatState.selectedUserId);
          if (!targetUser) return;

          btnStart.disabled = true;
          const originalText = btnStart.innerText;
          btnStart.innerText = 'Iniciando...';

          try {
            const convId = await createConversation(targetUser);
            if (!convId) return;

            closeNewChatModal();
            renderConversationList(chatState.filteredConversations);
            openConversation(convId);
          } catch (err) {
            console.error('[Chat] Erro ao criar conversa:', err);
          } finally {
            btnStart.disabled = false;
            btnStart.innerText = originalText;
          }
      }
    });
  }
}

// ================================================================
// API PÃšBLICA â€” window.ChatModule
// Contrato mantido idÃªntico ao original para retrocompatibilidade
// com app.js (ChatModule.init/destroy) e index.html.
// ================================================================
window.ChatModule = {
  init() {
    initChatModule();
  },

  destroy() {
    // Remove o canal do Supabase corretamente (evita vazamento de memÃ³ria e subscriptions Ã³rfÃ£s)
    if (window._chatChannel) {
        window.supabaseClient.removeChannel(window._chatChannel);
        window._chatChannel = null;
        console.log('[Chat Realtime Lifecycle] Canal removido ao sair do mÃ³dulo (Cleanup).');
    }
    chatState.selectedConversationId = null;
  },

  openConversation,

  sendMessage() {
    sendMessage();
  },

  async renderContextualCommentPanel(entityType, entityId, container) {
    if (!container) return;

    container.innerHTML = `
      <div class="ctx-comments-panel">
        <h4>ComentÃ¡rios</h4>
        <p>Funcionalidade em desenvolvimento.</p>
      </div>
    `;
  }
};

// ExpÃµe funÃ§Ãµes do chat ao escopo global (garante acesso independente de closure)
window._chatState = chatState;
window.openNewChatModal = openNewChatModal;
window.closeNewChatModal = closeNewChatModal;
window.renderConversationList = renderConversationList;
window.openConversation = openConversation;

// Os listeners do modal Nova Conversa sÃ£o registrados no initChatModule


