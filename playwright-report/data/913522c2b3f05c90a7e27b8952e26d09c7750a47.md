# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: modules.spec.js >> Testes de Regressão de Módulos Auxiliares >> 03 — Sanidade: Gestão de Acessos (Usuários) e GED (Documentos) renderizam sem exceções
- Location: tests\modules.spec.js:176:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#app-wrapper')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#app-wrapper')
    7 × locator resolved to <div id="app-wrapper" class="app-wrapper">…</div>
      - unexpected value "hidden"

```

```yaml
- img "Logo LUP"
- heading "Atlética LUP" [level=1]
- paragraph: Plataforma de Gestão Estratégica
- text: E-mail Institucional
- textbox "E-mail Institucional":
  - /placeholder: presidencia@atleticalup.com.br
  - text: presidencia@atleticalup.com.br
- text: Senha
- textbox "Senha":
  - /placeholder: ••••••••••••
  - text: lup123_strategy
- button "Mostrar/ocultar senha"
- button "Autenticando..." [disabled]
- paragraph: Acesso exclusivo para membros da Diretoria LUP
- paragraph: Acesso Rápido (Demo)
- button "Presidência (Master)"
- button "Diretoria de Parcerias"
- button "Jurídico & GED"
- button "Tesouraria"
- heading "Ação não permitida" [level=3]
- paragraph: Você não tem permissão para realizar esta ação.
- button "Entendi"
- heading "Detalhes da Parceria" [level=3]
- button
- text: Nome da Empresa / Parceiro
- textbox [disabled]
- text: Tipo de Parceria
- textbox [disabled]
- text: Proposta de Parceria (Google Drive) Status da Parceria
- combobox
- button "Cancelar"
- button "Salvar Alterações"
```

# Test source

```ts
  30  |     { id: 'doc-001', titulo: 'Contrato de Patrocínio Ambev', tipo_documento: 'Contrato', parceiro_id: 'part-001', arquivo_url: 'https://drive.google.com/mock-doc', data_vencimento: '2027-12-31' }
  31  |   ],
  32  |   parceiros_patrocinadores: [
  33  |     { id: 'part-001', nome_empresa: 'Ambev LUP', tipo_parceria: 'Patrocínio Financeiro', status: 'Contrato Ativo' }
  34  |   ],
  35  |   // Tabelas restantes exigidas pelo syncDBFromSupabase
  36  |   eventos: [],
  37  |   tarefas_logistica: [],
  38  |   modalidades: [],
  39  |   atletas: [],
  40  |   calendario_editorial: [],
  41  |   cronograma_postagens: [],
  42  |   escalacoes: [],
  43  |   participantes_evento: [],
  44  |   logs_notificacoes: [],
  45  |   fornecedores: [],
  46  |   pedidos_compra: []
  47  | };
  48  | 
  49  | // Seletores comuns e de navegação dos módulos
  50  | const SELECTORS = {
  51  |   emailInput: '#login-email',
  52  |   passwordInput: '#login-password',
  53  |   loginButton: '#btn-login',
  54  |   
  55  |   // Abas de Navegação Principal (Sidebar)
  56  |   navFinanceiro: '.nav-item[data-target="mod-financeiro"]',
  57  |   navProdutos: '.nav-item[data-target="mod-produtos"]',
  58  |   navAcessos: '.nav-item[data-target="mod-acessos"]',
  59  |   navLegal: '.nav-item[data-target="mod-legal"]',
  60  | };
  61  | 
  62  | test.describe('Testes de Regressão de Módulos Auxiliares', () => {
  63  | 
  64  |   test.beforeEach(async ({ page }) => {
  65  |     // 1. Mock do arquivo JavaScript do Supabase
  66  |     await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', async (route) => {
  67  |       const localPath = path.join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd/supabase.js');
  68  |       await route.fulfill({
  69  |         status: 200,
  70  |         contentType: 'application/javascript',
  71  |         body: fs.readFileSync(localPath, 'utf8'),
  72  |       });
  73  |     });
  74  | 
  75  |     // 2. Bloqueio de CDNs e fontes externas
  76  |     await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', async (route) => {
  77  |       await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  78  |     });
  79  |     await page.route('https://fonts.googleapis.com/**', async (route) => {
  80  |       await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  81  |     });
  82  |     await page.route('https://fonts.gstatic.com/**', async (route) => {
  83  |       await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  84  |     });
  85  | 
  86  |     // 3. Mock da API de login do Supabase (Success 200)
  87  |     await page.route('**/auth/v1/token*', async (route) => {
  88  |       await route.fulfill({
  89  |         status: 200,
  90  |         contentType: 'application/json',
  91  |         body: JSON.stringify({
  92  |           access_token: 'mock-jwt-token-modules',
  93  |           token_type: 'bearer',
  94  |           expires_in: 3600,
  95  |           refresh_token: 'mock-refresh-token-modules',
  96  |           user: {
  97  |             id: 'test-user-presidencia-001',
  98  |             email: 'presidencia@atleticalup.com.br',
  99  |             email_confirmed_at: new Date().toISOString(),
  100 |           }
  101 |         }),
  102 |       });
  103 |     });
  104 | 
  105 |     // 4. Mock da API REST do Supabase retornando nossa fixture
  106 |     await page.route('**/rest/v1/**', async (route) => {
  107 |       const url = route.request().url();
  108 |       const tableName = url.split('/rest/v1/')[1]?.split('?')[0];
  109 | 
  110 |       if (tableName && MOCK_MODULES_DATA[tableName]) {
  111 |         await route.fulfill({
  112 |           status: 200,
  113 |           contentType: 'application/json',
  114 |           body: JSON.stringify(MOCK_MODULES_DATA[tableName]),
  115 |         });
  116 |       } else {
  117 |         await route.fulfill({
  118 |           status: 200,
  119 |           contentType: 'application/json',
  120 |           body: JSON.stringify([]),
  121 |         });
  122 |       }
  123 |     });
  124 | 
  125 |     // 5. Login automático para acessar a área administrativa
  126 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  127 |     await page.fill(SELECTORS.emailInput, 'presidencia@atleticalup.com.br');
  128 |     await page.fill(SELECTORS.passwordInput, 'lup123_strategy');
  129 |     await page.click(SELECTORS.loginButton);
> 130 |     await expect(page.locator('#app-wrapper')).toBeVisible();
      |                                                ^ Error: expect(locator).toBeVisible() failed
  131 |   });
  132 | 
  133 |   test('01 — Financeiro (Livro Caixa) exibe os lançamentos e calcula balanço e KPIs formatados', async ({ page }) => {
  134 |     // Acessa o módulo de Tesouraria
  135 |     await page.click(SELECTORS.navFinanceiro);
  136 | 
  137 |     // Assert: Verifica se a tabela do livro de lançamentos possui as duas linhas populadas
  138 |     const rows = page.locator('#ledger-table tbody tr');
  139 |     await expect(rows).toHaveCount(2);
  140 | 
  141 |     // Assert: Valida a descrição/categoria e os valores na tabela
  142 |     await expect(rows.first()).toContainText('Patrocínio Master');
  143 |     await expect(rows.first()).toContainText('R$ 2500.50');
  144 |     await expect(rows.nth(1)).toContainText('Compra de Uniformes');
  145 |     await expect(rows.nth(1)).toContainText('R$ 1200.00');
  146 | 
  147 |     // Assert: Valida se os cards de KPI de balanço consolidaram e formataram os valores corretamente
  148 |     // Entradas: R$ 2500.50, Saídas: R$ 1200.00, Resultado Líquido: R$ 1300.50
  149 |     await expect(page.locator('#ledger-inflow')).toHaveText('R$ 2500.50');
  150 |     await expect(page.locator('#ledger-outflow')).toHaveText('R$ 1200.00');
  151 |     await expect(page.locator('#ledger-total')).toHaveText('R$ 1300.50');
  152 |   });
  153 | 
  154 |   test('02 — Produtos e Estoque exibe listagem de inventário e produtos cadastrados', async ({ page }) => {
  155 |     // Acessa o módulo de Produtos e Estoque
  156 |     await page.click(SELECTORS.navProdutos);
  157 | 
  158 |     // 1. Verifica Aba de Estoque / Inventário (Aba ativa por padrão)
  159 |     const inventoryRows = page.locator('#inventory-table tbody tr');
  160 |     await expect(inventoryRows).toHaveCount(1);
  161 |     await expect(inventoryRows.first()).toContainText('Camiseta Oficial 2026');
  162 |     await expect(inventoryRows.first()).toContainText('M');
  163 |     await expect(inventoryRows.first()).toContainText('15 un');
  164 | 
  165 |     // 2. Acessa a Aba de Cadastro de Produtos
  166 |     await page.click('.tab-btn[data-tab="prod-tab-produtos"]');
  167 | 
  168 |     // Verifica se o produto está listado na tabela de administração de produtos
  169 |     const productListRows = page.locator('#produtos-list-table tbody tr');
  170 |     await expect(productListRows).toHaveCount(1);
  171 |     await expect(productListRows.first()).toContainText('Camiseta Oficial 2026');
  172 |     await expect(productListRows.first()).toContainText('R$ 25.00'); // Preço custo
  173 |     await expect(productListRows.first()).toContainText('R$ 50.00'); // Preço venda
  174 |   });
  175 | 
  176 |   test('03 — Sanidade: Gestão de Acessos (Usuários) e GED (Documentos) renderizam sem exceções', async ({ page }) => {
  177 |     // 1. Teste de Sanidade: Módulo de Acessos
  178 |     await page.click(SELECTORS.navAcessos);
  179 |     
  180 |     // Verifica se os usuários da diretoria estão listados
  181 |     const userRows = page.locator('#users-table tbody tr');
  182 |     await expect(userRows).toHaveCount(2);
  183 |     await expect(userRows.first()).toContainText('Ed Carlos Teste');
  184 |     await expect(userRows.nth(1)).toContainText('Renata LUP');
  185 | 
  186 |     // 2. Teste de Sanidade: Módulo Jurídico & GED
  187 |     await page.click(SELECTORS.navLegal);
  188 |     
  189 |     // Acessa sub-aba GED — Documentos
  190 |     await page.click('.tab-btn[data-tab="jur-tab-ged"]');
  191 | 
  192 |     // Verifica se os documentos do GED estão listados
  193 |     const docRows = page.locator('#ged-table tbody tr');
  194 |     await expect(docRows).toHaveCount(1);
  195 |     await expect(docRows.first()).toContainText('Contrato de Patrocínio Ambev');
  196 |     await expect(docRows.first()).toContainText('Ambev LUP');
  197 |   });
  198 | 
  199 | });
  200 | 
```