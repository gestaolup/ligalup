// tests/sync.spec.js
// PASSO 3 — Testes de Sincronização e Estado (window.DB)
//
// Objetivo: Validar que a função global syncDBFromSupabase() popula corretamente a memória local
// da aplicação (window.DB) com os dados estruturados recebidos das tabelas do Supabase.
// Toda a comunicação REST do Supabase é mockada localmente no nível de rede para garantir velocidade e isolamento.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Conjunto de dados de teste (Mocks controlados para validação de integridade)
const MOCK_SYNC_DATA = {
  usuarios: [
    { id: 'usr-1', nome: 'Alice Silva', email: 'alice@atleticalup.com.br', status: true },
    { id: 'usr-2', nome: 'Bob Souza', email: 'bob@atleticalup.com.br', status: true },
    { id: 'usr-3', nome: 'Charlie Oliveira', email: 'charlie@atleticalup.com.br', status: false }
  ],
  usuario_diretorias: [],
  chat_conversations: [
    { id: 'conv-1', name: 'Geral LUP', type: 'Grupo' }, // Conversa padrão (evita duplicar com seed)
    { id: 'conv-2', name: 'Diretoria LUP', type: 'Grupo' }
  ],
  chat_messages: [
    { id: 'msg-1', conversation_id: 'conv-1', sender_id: 'usr-1', body: 'Olá Geral!', sent_at: new Date().toISOString() },
    { id: 'msg-2', conversation_id: 'conv-1', sender_id: 'usr-2', body: 'Tudo bem?', sent_at: new Date().toISOString() },
    { id: 'msg-3', conversation_id: 'conv-2', sender_id: 'usr-1', body: 'Mensagem privada diretoria', sent_at: new Date().toISOString() }
  ],
  eventos: [
    { id: 'evt-1', nome: 'InterLUP 2026', tipo: 'Jogos', status_aprovacao: 'Aprovado' }
  ]
};

test.describe('Testes de Sincronização e Estado Global — window.DB', () => {

  test.beforeEach(async ({ page }) => {
    // 1. Mock local do script Supabase-js para execução instantânea offline
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', async (route) => {
      const localPath = path.join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd/supabase.js');
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: fs.readFileSync(localPath, 'utf8'),
      });
    });

    // 2. Bloqueio de CDNs e fontes externas
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.gstatic.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });

    // 3. Interceptação da REST API do Supabase
    // Ao receber qualquer chamada GET para rest/v1, devolvemos a fixture controlada se existir,
    // caso contrário, devolvemos uma lista vazia.
    await page.route('**/rest/v1/**', async (route) => {
      const url = route.request().url();
      const tableName = url.split('/rest/v1/')[1]?.split('?')[0];

      if (tableName && MOCK_SYNC_DATA[tableName]) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_SYNC_DATA[tableName]),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    });
  });

  test('01 — Execução do syncDBFromSupabase popula o estado global window.DB com precisão', async ({ page }) => {
    // Navega para a página inicial (tela de login)
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // ESTRETÉGIA DE INSPEÇÃO DO ESTADO GLOBAL:
    // Como a variável DB é declarada na raiz de app.js (DOMContentLoaded), ela pode não ser acessível
    // no escopo de testes diretamente a menos que esteja exposta em `window`. No nosso caso,
    // app.js expõe explicitamente como (window.DB || DB) em algumas interações ou mantemos
    // a referência no escopo de window para auditoria. Vamos inspecionar o objeto global.
    
    // Executa a função global de sincronização
    console.log('[Sync Test] Acionando window.syncDBFromSupabase() no contexto do navegador...');
    await page.evaluate(async () => {
      await window.syncDBFromSupabase();
    });

    // Recupera o valor de window.DB serializado de dentro do contexto do browser
    const localDbState = await page.evaluate(() => {
      return window.DB;
    });

    // Validações de Integridade dos Dados Sincronizados
    expect(localDbState).toBeDefined();

    // 1. Tabela: usuarios
    expect(localDbState.usuarios).toBeDefined();
    expect(localDbState.usuarios).toHaveLength(3);
    expect(localDbState.usuarios[0].nome).toBe('Alice Silva');
    expect(localDbState.usuarios[2].email).toBe('charlie@atleticalup.com.br');

    // 2. Tabela: chat_conversations
    expect(localDbState.chat_conversations).toBeDefined();
    expect(localDbState.chat_conversations).toHaveLength(2);
    expect(localDbState.chat_conversations[1].name).toBe('Diretoria LUP');

    // 3. Tabela: chat_messages
    expect(localDbState.chat_messages).toBeDefined();
    expect(localDbState.chat_messages).toHaveLength(3);
    expect(localDbState.chat_messages[0].body).toBe('Olá Geral!');

    // 4. Tabela: eventos
    expect(localDbState.eventos).toBeDefined();
    expect(localDbState.eventos).toHaveLength(1);
    expect(localDbState.eventos[0].nome).toBe('InterLUP 2026');
  });

});
