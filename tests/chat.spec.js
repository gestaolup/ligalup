// tests/chat.spec.js
// PASSO 4 — Testes de Chat e Realtime
//
// Objetivo: Validar os fluxos de (1) Envio de Mensagens e (2) Recepção via Supabase Realtime (WebSockets).
// Toda a comunicação (REST e WebSocket) é interceptada e simulada localmente.
// O teste é 100% autônomo, rápido e não consome recursos de rede externos.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Carrega os dados de mock locais para sincronização
const mockDb = JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks/db.json'), 'utf8'));

// Seletores do módulo de chat
const SELECTORS = {
  emailInput: '#login-email',
  passwordInput: '#login-password',
  loginButton: '#btn-login',
  navComunicacao: '.nav-item[data-target="mod-comunicacao"]',
  conversationItem: '.conversation-item[data-conv-id="conv-1"]',
  chatInput: '#chat-input-field',
  sendButton: '#btn-send-message',
  messagesBody: '#chat-messages-body',
  msgBubble: '.msg-bubble',
};

test.describe('Testes de Chat e Sincronização Realtime (WebSockets)', () => {

  test.beforeEach(async ({ page }) => {
    // 1. Injeta script no navegador para interceptar a criação do WebSocket nativo.
    // Guardamos o objeto WebSocket criado no escopo de `window` do navegador para podermos
    // despachar eventos simulados (frames de dados) diretamente nele durante o teste.
    await page.addInitScript(() => {
      window.capturedWebSockets = [];
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        const ws = new OriginalWebSocket(url, protocols);
        window.capturedWebSockets.push(ws);
        return ws;
      };
      Object.assign(window.WebSocket, OriginalWebSocket);
    });

    // 2. Mock do script Supabase-js local
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', async (route) => {
      const localPath = path.join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd/supabase.js');
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: fs.readFileSync(localPath, 'utf8'),
      });
    });

    // 3. Bloqueio de CDNs e fontes externas
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.gstatic.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });

    // 4. Mock da API de login do Supabase (Success 200)
    await page.route('**/auth/v1/token*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-jwt-token-abcdef',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token-123456',
          user: {
            id: 'test-user-presidencia-001', // UUID correspondente ao Ed Carlos no db.json
            email: 'presidencia@atleticalup.com.br',
            email_confirmed_at: new Date().toISOString(),
          }
        }),
      });
    });

    // 5. Mock da API REST do Supabase
    await page.route('**/rest/v1/**', async (route) => {
      const url = route.request().url();
      const tableName = url.split('/rest/v1/')[1]?.split('?')[0];

      if (tableName && mockDb[tableName]) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockDb[tableName]),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    });

    // 6. Login automático e navegação para o Chat
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.fill(SELECTORS.emailInput, 'presidencia@atleticalup.com.br');
    await page.fill(SELECTORS.passwordInput, 'lup123_strategy');
    await page.click(SELECTORS.loginButton);

    // Clica no menu de comunicação (Chat)
    await page.waitForSelector(SELECTORS.navComunicacao, { state: 'visible' });
    await page.click(SELECTORS.navComunicacao);
    
    // Seleciona a conversa "Geral LUP" no menu esquerdo
    await page.waitForSelector(SELECTORS.conversationItem, { state: 'visible' });
    await page.click(SELECTORS.conversationItem);

  });

  test('01 — Envio de mensagem dispara requisição POST e aguarda eco do WebSocket para renderizar', async ({ page }) => {
    const textMsg = 'Enviando mensagem de teste E2E!';
    let postRequestCaptured = false;

    // Monitora a inserção (POST) da mensagem na tabela chat_messages
    await page.route('**/rest/v1/chat_messages*', async (route) => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON();
        
        // Valida que o payload contém o texto digitado e o id gerado localmente
        expect(payload.body).toBe(textMsg);
        expect(payload.id).toBeDefined();

        postRequestCaptured = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify([payload]),
        });
      } else {
        await route.continue();
      }
    });

    // Digita a mensagem no campo correspondente
    await page.fill(SELECTORS.chatInput, textMsg);

    // Dispara o envio
    await page.click(SELECTORS.sendButton);

    // Verifica se a chamada HTTP POST ao Supabase de fato ocorreu
    expect(postRequestCaptured).toBe(true);

    // Como o sistema é puramente Event-Driven, a bolha da mensagem enviada ainda não deve
    // estar visível no DOM até que o WebSocket receba o evento de confirmação ("eco" do servidor).
    const messageBubbles = page.locator(SELECTORS.msgBubble);
    await expect(messageBubbles).toBeHidden();

    // ── SIMULAÇÃO DE ECO DO WEBSOCKET ──
    // Injetamos um frame de mensagem Phoenix na conexão capturada simulando a inserção da nossa própria mensagem.
    await page.evaluate((text) => {
      const ws = window.capturedWebSockets[0];
      if (!ws) throw new Error('WebSocket Realtime não encontrado.');

      // Phoenix protocol: [join_ref, ref, topic, event, payload]
      const frame = [
        null,
        null,
        "realtime:chat-realtime",
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          new: {
            id: "msg-eco-send-123",
            conversation_id: "conv-1",
            sender_id: "test-user-presidencia-001",
            body: text,
            sent_at: new Date().toISOString()
          }
        }
      ];

      // Despacha o evento de rede na conexão WebSocket local
      ws.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify(frame)
      }));
    }, textMsg);

    // Assert: Após o eco do WebSocket, a bolha de mensagem agora deve estar visível e com o texto correto
    await expect(messageBubbles).toBeVisible();
    await expect(messageBubbles).toHaveText(textMsg);
  });

  test('02 — Recepção passiva de mensagem via WebSocket renderiza bolha na tela em tempo real', async ({ page }) => {
    const inboundText = 'Olá! Esta é uma mensagem externa via Realtime WebSocket.';

    // Valida que o container de chat inicialmente não tem mensagens (bolha deve estar oculta/inexistente)
    const messageBubbles = page.locator(SELECTORS.msgBubble);
    await expect(messageBubbles).toBeHidden();

    // ── SIMULAÇÃO DE MENSAGEM DO OUTRO USUÁRIO ──
    // Injetamos o frame Phoenix na conexão WebSocket simulando a inserção de uma mensagem do usuário "Jurídico Teste".
    await page.evaluate((text) => {
      const ws = window.capturedWebSockets[0];
      if (!ws) throw new Error('WebSocket Realtime não encontrado.');

      const frame = [
        null,
        null,
        "realtime:chat-realtime",
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          new: {
            id: "msg-inbound-realtime-456",
            conversation_id: "conv-1",
            sender_id: "test-user-juridico-002", // ID do outro usuário (Jurídico no db.json)
            body: text,
            sent_at: new Date().toISOString()
          }
        }
      ];

      ws.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify(frame)
      }));
    }, inboundText);

    // Assert: O app reage ao evento WebSocket renderizando a bolha do outro usuário instantaneamente
    await expect(messageBubbles).toBeVisible();
    await expect(messageBubbles).toHaveText(inboundText);

    // Assert: A mensagem recebida do outro usuário deve ter a classe de estilo correspondente
    const receivedMsg = page.locator('.chat-msg.msg-received');
    await expect(receivedMsg).toBeVisible();
  });

});
