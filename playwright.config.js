// playwright.config.js
// Configuração da infraestrutura de testes E2E para o projeto Atlética LUP.
// Todos os testes rodam localmente contra o servidor de arquivos estáticos,
// sem dependência de internet ou do banco de dados de produção.

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  // Diretório raiz onde os arquivos de teste estão localizados
  testDir: './tests',

  // Timeout por teste (60s — suficiente para carregar o monolito local)
  timeout: 60_000,

  // Número de workers paralelos. Definido como 1 para garantir
  // isolamento total de estado entre os testes nesta fase inicial.
  workers: 1,

  // Relatório HTML gerado em ./playwright-report após cada execução
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    // URL base do servidor local de desenvolvimento.
    // O Playwright servirá o index.html através de um servidor embutido.
    baseURL: 'http://localhost:5500',

    // Captura screenshot apenas em caso de falha (facilita debugging)
    screenshot: 'only-on-failure',

    // Captura vídeo apenas em caso de falha
    video: 'retain-on-failure',

    // Captura trace em caso de falha (permite re-execução passo a passo no Playwright UI)
    trace: 'retain-on-failure',

    // Headless por padrão. Altere para `false` para depurar visualmente.
    headless: true,
  },

  // Projetos: executamos somente Chromium nesta fase inicial
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Servidor web embutido: o Playwright sobe um servidor local automaticamente
  // antes de executar os testes. Aponta para a raiz do projeto (index.html).
  webServer: {
    // Usa o binário local do serve (instalado como devDependency) — sem download na hora
    command: 'node node_modules/serve/build/main.js . --listen 5500 --no-clipboard',
    url: 'http://localhost:5500',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
