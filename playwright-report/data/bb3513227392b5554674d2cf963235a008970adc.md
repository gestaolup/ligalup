# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat.spec.js >> Testes de Chat e Sincronização Realtime (WebSockets) >> 01 — Envio de mensagem dispara requisição POST e aguarda eco do WebSocket para renderizar
- Location: tests\chat.spec.js:121:3

# Error details

```
Test timeout of 60000ms exceeded while running "beforeEach" hook.
```

```
Error: page.waitForSelector: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('.conversation-item[data-conv-id="conv-1"]') to be visible
    136 × locator resolved to hidden <li tabindex="0" role="button" data-conv-id="conv-1" class="conversation-item " aria-label="Conversa com Geral LUP">…</li>

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - img "LUP Logo" [ref=e7]
          - generic [ref=e8]:
            - heading "Atlética LUP" [level=1] [ref=e9]
            - generic [ref=e10]: L. U. Pitágoras
        - list [ref=e11]:
          - listitem [ref=e12] [cursor=pointer]: Dashboard Executivo
          - listitem [ref=e13] [cursor=pointer]: Gestão de Acessos
          - listitem [ref=e14] [cursor=pointer]: Configurações Globais
          - listitem [ref=e15] [cursor=pointer]: Diretoria de Eventos
          - listitem [ref=e16] [cursor=pointer]: Diretoria de Marketing
          - listitem [ref=e17] [cursor=pointer]: Produtos & Estoque
          - listitem [ref=e18] [cursor=pointer]: Esportes & Atletas
          - listitem [ref=e19] [cursor=pointer]: Tesouraria & Caixa
          - listitem [ref=e20] [cursor=pointer]: Diretoria de Parcerias
          - listitem [ref=e21] [cursor=pointer]: Jurídico & GED
          - listitem [ref=e22] [cursor=pointer]: Comunicação
      - generic [ref=e23]:
        - generic [ref=e25]:
          - generic [ref=e26]: Ed Carlos Teste
          - generic [ref=e27]: Presidente
          - generic [ref=e28]: Dir. de Presidência
        - button "Sair" [ref=e29] [cursor=pointer]: Sair
    - main [ref=e30]:
      - generic [ref=e31]:
        - generic [ref=e32]:
          - heading "Atlética LUP" [level=2] [ref=e33]
          - paragraph [ref=e34]: Sistema de Gestão
        - generic [ref=e35]:
          - generic "Banco de Dados Conectado" [ref=e36]
          - generic "Notificações"
          - generic "Minhas Configurações" [ref=e38] [cursor=pointer]:
            - img "Avatar" [ref=e39]
        - generic [ref=e40]:
          - generic [ref=e41]:
            - generic [ref=e42]: Notificações
            - button [ref=e43] [cursor=pointer]
          - generic [ref=e45]: Nenhuma notificação no momento.
      - text: Registro de todas as notificações e alertas enviados pelo sistema. Este histórico é permanente e não pode ser apagado. Ao aprovar um evento, o sistema registra automaticamente o orçamento previsto como saída no caixa. Apenas a Tesouraria e a Presidência podem aprovar eventos. Somente eventos já aprovados pela Tesouraria ou Presidência aparecem nesta lista. Controle de estoque por produto e tamanho. O estoque é atualizado automaticamente a cada venda ou recebimento de pedido. Cada venda registrada desconta automaticamente do estoque disponível do produto e tamanho selecionados. Cadastre aqui os produtos vendidos pela Atlética. Para controle de tamanhos e estoque, acesse a aba Estoque. Crie e gerencie pedidos de compra multi-item. O estoque é atualizado automaticamente ao registrar cada recebimento. Lista todos os atletas inscritos. A validação dos documentos é realizada pelo Jurídico. Apenas atletas com status Aprovado podem competir. Selecione um evento de Competição já aprovado e uma modalidade para definir os atletas escalados. Só atletas com documentação Aprovada podem ser incluídos. Registro de todas as entradas e saídas financeiras. Itens que foram conciliados não podem ser alterados ou excluídos. Registre aqui parceiros e patrocinadores. O Jurídico será notificado para avaliar a proposta e redigir o contrato. Para ativar uma parceria (Contrato Ativo), o Jurídico precisa vincular um contrato assinado no GED. Analise a proposta de parceria e, quando o contrato for assinado, vincule-o no GED para aprovar. Vincular um 'Contrato' a uma parceria alterará automaticamente o seu status para 'Contrato Ativo'. Todos os documentos vinculados a parcerias estão listados aqui. Certifique-se de que os links do Google Drive estão acessíveis. Atualize seus dados individuais de acesso e personalize sua foto de perfil.
  - generic:
    - generic:
      - generic:
        - heading "Ação não permitida" [level=3]
        - paragraph: Você não tem permissão para realizar esta ação.
      - generic:
        - button "Entendi": Entendi
  - generic:
    - generic:
      - generic:
        - heading "Detalhes da Parceria" [level=3]: Detalhes da Parceria
        - button
      - generic:
        - generic:
          - generic: Nome da Empresa / Parceiro
          - textbox [disabled]
        - generic:
          - generic: Tipo de Parceria
          - textbox [disabled]
        - generic:
          - generic: Proposta de Parceria (Google Drive)
        - generic:
          - generic: Status da Parceria
          - combobox
      - generic:
        - button "Cancelar"
        - button "Salvar Alterações": Salvar Alterações
```

# Test source

```ts
  16  | const SELECTORS = {
  17  |   emailInput: '#login-email',
  18  |   passwordInput: '#login-password',
  19  |   loginButton: '#btn-login',
  20  |   navComunicacao: '.nav-item[data-target="mod-comunicacao"]',
  21  |   conversationItem: '.conversation-item[data-conv-id="conv-1"]',
  22  |   chatInput: '#chat-input-field',
  23  |   sendButton: '#btn-send-message',
  24  |   messagesBody: '#chat-messages-body',
  25  |   msgBubble: '.msg-bubble',
  26  | };
  27  | 
  28  | test.describe('Testes de Chat e Sincronização Realtime (WebSockets)', () => {
  29  | 
  30  |   test.beforeEach(async ({ page }) => {
  31  |     // 1. Injeta script no navegador para interceptar a criação do WebSocket nativo.
  32  |     // Guardamos o objeto WebSocket criado no escopo de `window` do navegador para podermos
  33  |     // despachar eventos simulados (frames de dados) diretamente nele durante o teste.
  34  |     await page.addInitScript(() => {
  35  |       window.capturedWebSockets = [];
  36  |       const OriginalWebSocket = window.WebSocket;
  37  |       window.WebSocket = function(url, protocols) {
  38  |         const ws = new OriginalWebSocket(url, protocols);
  39  |         window.capturedWebSockets.push(ws);
  40  |         return ws;
  41  |       };
  42  |       Object.assign(window.WebSocket, OriginalWebSocket);
  43  |     });
  44  | 
  45  |     // 2. Mock do script Supabase-js local
  46  |     await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', async (route) => {
  47  |       const localPath = path.join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd/supabase.js');
  48  |       await route.fulfill({
  49  |         status: 200,
  50  |         contentType: 'application/javascript',
  51  |         body: fs.readFileSync(localPath, 'utf8'),
  52  |       });
  53  |     });
  54  | 
  55  |     // 3. Bloqueio de CDNs e fontes externas
  56  |     await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', async (route) => {
  57  |       await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  58  |     });
  59  |     await page.route('https://fonts.googleapis.com/**', async (route) => {
  60  |       await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  61  |     });
  62  |     await page.route('https://fonts.gstatic.com/**', async (route) => {
  63  |       await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  64  |     });
  65  | 
  66  |     // 4. Mock da API de login do Supabase (Success 200)
  67  |     await page.route('**/auth/v1/token*', async (route) => {
  68  |       await route.fulfill({
  69  |         status: 200,
  70  |         contentType: 'application/json',
  71  |         body: JSON.stringify({
  72  |           access_token: 'mock-jwt-token-abcdef',
  73  |           token_type: 'bearer',
  74  |           expires_in: 3600,
  75  |           refresh_token: 'mock-refresh-token-123456',
  76  |           user: {
  77  |             id: 'test-user-presidencia-001', // UUID correspondente ao Ed Carlos no db.json
  78  |             email: 'presidencia@atleticalup.com.br',
  79  |             email_confirmed_at: new Date().toISOString(),
  80  |           }
  81  |         }),
  82  |       });
  83  |     });
  84  | 
  85  |     // 5. Mock da API REST do Supabase
  86  |     await page.route('**/rest/v1/**', async (route) => {
  87  |       const url = route.request().url();
  88  |       const tableName = url.split('/rest/v1/')[1]?.split('?')[0];
  89  | 
  90  |       if (tableName && mockDb[tableName]) {
  91  |         await route.fulfill({
  92  |           status: 200,
  93  |           contentType: 'application/json',
  94  |           body: JSON.stringify(mockDb[tableName]),
  95  |         });
  96  |       } else {
  97  |         await route.fulfill({
  98  |           status: 200,
  99  |           contentType: 'application/json',
  100 |           body: JSON.stringify([]),
  101 |         });
  102 |       }
  103 |     });
  104 | 
  105 |     // 6. Login automático e navegação para o Chat
  106 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  107 |     await page.fill(SELECTORS.emailInput, 'presidencia@atleticalup.com.br');
  108 |     await page.fill(SELECTORS.passwordInput, 'lup123_strategy');
  109 |     await page.click(SELECTORS.loginButton);
  110 | 
  111 |     // Clica no menu de comunicação (Chat)
  112 |     await page.waitForSelector(SELECTORS.navComunicacao, { state: 'visible' });
  113 |     await page.click(SELECTORS.navComunicacao);
  114 |     
  115 |     // Seleciona a conversa "Geral LUP" no menu esquerdo
> 116 |     await page.waitForSelector(SELECTORS.conversationItem, { state: 'visible' });
      |                ^ Error: page.waitForSelector: Test timeout of 60000ms exceeded.
  117 |     await page.click(SELECTORS.conversationItem);
  118 | 
  119 |   });
  120 | 
  121 |   test('01 — Envio de mensagem dispara requisição POST e aguarda eco do WebSocket para renderizar', async ({ page }) => {
  122 |     const textMsg = 'Enviando mensagem de teste E2E!';
  123 |     let postRequestCaptured = false;
  124 | 
  125 |     // Monitora a inserção (POST) da mensagem na tabela chat_messages
  126 |     await page.route('**/rest/v1/chat_messages*', async (route) => {
  127 |       if (route.request().method() === 'POST') {
  128 |         const payload = route.request().postDataJSON();
  129 |         
  130 |         // Valida que o payload contém o texto digitado e o id gerado localmente
  131 |         expect(payload.body).toBe(textMsg);
  132 |         expect(payload.id).toBeDefined();
  133 | 
  134 |         postRequestCaptured = true;
  135 |         await route.fulfill({
  136 |           status: 201,
  137 |           contentType: 'application/json',
  138 |           body: JSON.stringify([payload]),
  139 |         });
  140 |       } else {
  141 |         await route.continue();
  142 |       }
  143 |     });
  144 | 
  145 |     // Digita a mensagem no campo correspondente
  146 |     await page.fill(SELECTORS.chatInput, textMsg);
  147 | 
  148 |     // Dispara o envio
  149 |     await page.click(SELECTORS.sendButton);
  150 | 
  151 |     // Verifica se a chamada HTTP POST ao Supabase de fato ocorreu
  152 |     expect(postRequestCaptured).toBe(true);
  153 | 
  154 |     // Como o sistema é puramente Event-Driven, a bolha da mensagem enviada ainda não deve
  155 |     // estar visível no DOM até que o WebSocket receba o evento de confirmação ("eco" do servidor).
  156 |     const messageBubbles = page.locator(SELECTORS.msgBubble);
  157 |     await expect(messageBubbles).toBeHidden();
  158 | 
  159 |     // ── SIMULAÇÃO DE ECO DO WEBSOCKET ──
  160 |     // Injetamos um frame de mensagem Phoenix na conexão capturada simulando a inserção da nossa própria mensagem.
  161 |     await page.evaluate((text) => {
  162 |       const ws = window.capturedWebSockets[0];
  163 |       if (!ws) throw new Error('WebSocket Realtime não encontrado.');
  164 | 
  165 |       // Phoenix protocol: [join_ref, ref, topic, event, payload]
  166 |       const frame = [
  167 |         null,
  168 |         null,
  169 |         "realtime:chat-realtime",
  170 |         "postgres_changes",
  171 |         {
  172 |           event: "INSERT",
  173 |           schema: "public",
  174 |           table: "chat_messages",
  175 |           new: {
  176 |             id: "msg-eco-send-123",
  177 |             conversation_id: "conv-1",
  178 |             sender_id: "test-user-presidencia-001",
  179 |             body: text,
  180 |             sent_at: new Date().toISOString()
  181 |           }
  182 |         }
  183 |       ];
  184 | 
  185 |       // Despacha o evento de rede na conexão WebSocket local
  186 |       ws.dispatchEvent(new MessageEvent('message', {
  187 |         data: JSON.stringify(frame)
  188 |       }));
  189 |     }, textMsg);
  190 | 
  191 |     // Assert: Após o eco do WebSocket, a bolha de mensagem agora deve estar visível e com o texto correto
  192 |     await expect(messageBubbles).toBeVisible();
  193 |     await expect(messageBubbles).toHaveText(textMsg);
  194 |   });
  195 | 
  196 |   test('02 — Recepção passiva de mensagem via WebSocket renderiza bolha na tela em tempo real', async ({ page }) => {
  197 |     const inboundText = 'Olá! Esta é uma mensagem externa via Realtime WebSocket.';
  198 | 
  199 |     // Valida que o container de chat inicialmente não tem mensagens (bolha deve estar oculta/inexistente)
  200 |     const messageBubbles = page.locator(SELECTORS.msgBubble);
  201 |     await expect(messageBubbles).toBeHidden();
  202 | 
  203 |     // ── SIMULAÇÃO DE MENSAGEM DO OUTRO USUÁRIO ──
  204 |     // Injetamos o frame Phoenix na conexão WebSocket simulando a inserção de uma mensagem do usuário "Jurídico Teste".
  205 |     await page.evaluate((text) => {
  206 |       const ws = window.capturedWebSockets[0];
  207 |       if (!ws) throw new Error('WebSocket Realtime não encontrado.');
  208 | 
  209 |       const frame = [
  210 |         null,
  211 |         null,
  212 |         "realtime:chat-realtime",
  213 |         "postgres_changes",
  214 |         {
  215 |           event: "INSERT",
  216 |           schema: "public",
```