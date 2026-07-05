// tests/modules.spec.js
// PASSO 5 — Testes de Regressão de Módulos (Financeiro, Produtos, Documentos e Usuários)
//
// Objetivo: Validar a renderização e sanidade dos módulos auxiliares da plataforma LIGA-LUP.
// Garante que, ao carregar dados do Supabase para as tabelas correspondentes, a UI atualiza e exibe
// as informações formatadas corretas sem quebrar a execução ou gerar exceções em tela.
// Toda a infraestrutura de rede externa é mockada.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Dados mockados locais específicos para os testes de módulos
const MOCK_MODULES_DATA = {
  usuarios: [
    { id: 'test-user-presidencia-001', nome: 'Ed Carlos Teste', email: 'presidencia@atleticalup.com.br', cargo: 'Master', diretoria: 'Presidência', status: true },
    { id: 'usr-fin-001', nome: 'Renata LUP', email: 'financeiro@atletica.com', cargo: 'Diretor', diretoria: 'Financeiro', status: true }
  ],
  permissoes: [],
  notificacoes_config: [],
  lancamentos_financeiros: [
    { id: 'fin-001', data_competencia: '2026-06-01', tipo: 'Entrada', categoria: 'Patrocínio Master', valor: 2500.50, status_conciliacao: true },
    { id: 'fin-002', data_competencia: '2026-06-05', tipo: 'Saída', categoria: 'Compra de Uniformes', valor: 1200.00, status_conciliacao: false }
  ],
  produtos: [
    { id: 'prod-001', nome: 'Camiseta Oficial 2026', preco_custo: 25.00, preco_venda: 50.00 }
  ],
  produto_variantes: [
    { id: 'var-001', produto_id: 'prod-001', tamanho: 'M', preco_custo: 25.00, preco_venda: 50.00, estoque_atual: 15 }
  ],
  documentos_contratos: [
    { id: 'doc-001', titulo: 'Contrato de Patrocínio Ambev', tipo_documento: 'Contrato', parceiro_id: 'part-001', arquivo_url: 'https://drive.google.com/mock-doc', data_vencimento: '2027-12-31' }
  ],
  parceiros_patrocinadores: [
    { id: 'part-001', nome_empresa: 'Ambev LUP', tipo_parceria: 'Patrocínio Financeiro', status: 'Contrato Ativo' }
  ],
  // Tabelas restantes exigidas pelo syncDBFromSupabase
  eventos: [],
  tarefas_logistica: [],
  modalidades: [],
  atletas: [],
  calendario_editorial: [],
  cronograma_postagens: [],
  escalacoes: [],
  participantes_evento: [],
  logs_notificacoes: [],
  fornecedores: [],
  pedidos_compra: []
};

// Seletores comuns e de navegação dos módulos
const SELECTORS = {
  emailInput: '#login-email',
  passwordInput: '#login-password',
  loginButton: '#btn-login',
  
  // Abas de Navegação Principal (Sidebar)
  navFinanceiro: '.nav-item[data-target="mod-financeiro"]',
  navProdutos: '.nav-item[data-target="mod-produtos"]',
  navAcessos: '.nav-item[data-target="mod-acessos"]',
  navLegal: '.nav-item[data-target="mod-legal"]',
};

test.describe('Testes de Regressão de Módulos Auxiliares', () => {

  test.beforeEach(async ({ page }) => {
    // 1. Mock do arquivo JavaScript do Supabase
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

    // 3. Mock da API de login do Supabase (Success 200)
    await page.route('**/auth/v1/token*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-jwt-token-modules',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token-modules',
          user: {
            id: 'test-user-presidencia-001',
            email: 'presidencia@atleticalup.com.br',
            email_confirmed_at: new Date().toISOString(),
          }
        }),
      });
    });

    // 4. Mock da API REST do Supabase retornando nossa fixture
    await page.route('**/rest/v1/**', async (route) => {
      const url = route.request().url();
      const tableName = url.split('/rest/v1/')[1]?.split('?')[0];

      if (tableName && MOCK_MODULES_DATA[tableName]) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_MODULES_DATA[tableName]),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    });

    // 5. Login automático para acessar a área administrativa
    page.on('pageerror', err => console.log('PAGE ERROR: ' + err.toString()));
    page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE ERROR: ' + msg.text()); });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.fill(SELECTORS.emailInput, 'presidencia@atleticalup.com.br');
    await page.fill(SELECTORS.passwordInput, 'lup123_strategy');
    await page.click(SELECTORS.loginButton);
    await expect(page.locator('#app-wrapper')).toBeVisible();
  });

  test('01 — Financeiro (Livro Caixa) exibe os lançamentos e calcula balanço e KPIs formatados', async ({ page }) => {
    // Acessa o módulo de Tesouraria
    await page.click(SELECTORS.navFinanceiro);

    // Assert: Verifica se a tabela do livro de lançamentos possui as duas linhas populadas
    const rows = page.locator('#ledger-table tbody tr');
    await expect(rows).toHaveCount(2);

    // Assert: Valida a descrição/categoria e os valores na tabela
    await expect(rows.first()).toContainText('Patrocínio Master');
    await expect(rows.first()).toContainText('R$ 2500.50');
    await expect(rows.nth(1)).toContainText('Compra de Uniformes');
    await expect(rows.nth(1)).toContainText('R$ 1200.00');

    // Assert: Valida se os cards de KPI de balanço consolidaram e formataram os valores corretamente
    // Entradas: R$ 2500.50, Saídas: R$ 1200.00, Resultado Líquido: R$ 1300.50
    await expect(page.locator('#ledger-inflow')).toHaveText('R$ 2500.50');
    await expect(page.locator('#ledger-outflow')).toHaveText('R$ 1200.00');
    await expect(page.locator('#ledger-total')).toHaveText('R$ 1300.50');
  });

  test('02 — Produtos e Estoque exibe listagem de inventário e produtos cadastrados', async ({ page }) => {
    // Acessa o módulo de Produtos e Estoque
    await page.click(SELECTORS.navProdutos);

    // 1. Verifica Aba de Estoque / Inventário (Aba ativa por padrão)
    const inventoryRows = page.locator('#inventory-table tbody tr');
    await expect(inventoryRows).toHaveCount(1);
    await expect(inventoryRows.first()).toContainText('Camiseta Oficial 2026');
    await expect(inventoryRows.first()).toContainText('M');
    await expect(inventoryRows.first()).toContainText('15 un');

    // 2. Acessa a Aba de Cadastro de Produtos
    await page.click('.tab-btn[data-tab="prod-tab-produtos"]');

    // Verifica se o produto está listado na tabela de administração de produtos
    const productListRows = page.locator('#produtos-list-table tbody tr');
    await expect(productListRows).toHaveCount(1);
    await expect(productListRows.first()).toContainText('Camiseta Oficial 2026');
    await expect(productListRows.first()).toContainText('R$ 25.00'); // Preço custo
    await expect(productListRows.first()).toContainText('R$ 50.00'); // Preço venda
  });

  test('03 — Sanidade: Gestão de Acessos (Usuários) e GED (Documentos) renderizam sem exceções', async ({ page }) => {
    // 1. Teste de Sanidade: Módulo de Acessos
    await page.click(SELECTORS.navAcessos);
    
    // Verifica se os usuários da diretoria estão listados
    const userRows = page.locator('#users-table tbody tr');
    await expect(userRows).toHaveCount(2);
    await expect(userRows.first()).toContainText('Ed Carlos Teste');
    await expect(userRows.nth(1)).toContainText('Renata LUP');

    // 2. Teste de Sanidade: Módulo Jurídico & GED
    await page.click(SELECTORS.navLegal);
    
    // Acessa sub-aba GED — Documentos
    await page.click('.tab-btn[data-tab="jur-tab-ged"]');

    // Verifica se os documentos do GED estão listados
    const docRows = page.locator('#ged-table tbody tr');
    await expect(docRows).toHaveCount(1);
    await expect(docRows.first()).toContainText('Contrato de Patrocínio Ambev');
    await expect(docRows.first()).toContainText('Ambev LUP');
  });

});
