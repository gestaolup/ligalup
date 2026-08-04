# Diretrizes — Estado Atual do Sistema

Atualizado em 04/08/2026.

## Visão geral

A plataforma LIGA-LUP é uma SPA em Vanilla JavaScript integrada ao Supabase. O estado de interface é mantido em `window.DB` e é sincronizado com o banco. A tela principal e a maior parte das regras ficam em `app.js`; módulos especializados ficam em `auth.js`, `finance.js`, `compras.js` e `ged_docs.js`.

## Correções já aplicadas

### Identificadores UUID

- A criação de eventos passou a enviar um UUID no cliente.
- A criação de postagens de marketing passou a enviar um UUID no cliente.
- Foram criadas migrações para garantir valores padrão de UUID no banco:
  - `database/migracao_eventos_uuid.sql`
  - `database/migracao_cronograma_postagens_uuid.sql`

### Produtos e Tesouraria

- Exclusão de produtos persiste no Supabase, trata erro de vínculo com pedidos e atualiza a tela.
- Exclusão de lançamentos financeiros persiste no Supabase.
- Os botões de exclusão usam delegação de eventos para continuar funcionando após renderizações dinâmicas.
- A conciliação financeira atualiza `status_conciliacao` no Supabase.
- Lançamentos conciliados são exibidos como conciliados e não mostram o botão de exclusão.
- A conciliação possui atualização otimista: a UI muda primeiro e faz rollback se a sincronização falhar.

### Estoque e vendas

- A venda consulta o estoque atual da variante no Supabase antes de prosseguir.
- Vendas acima do saldo disponível são bloqueadas.
- A baixa de estoque é persistida em `produto_variantes.estoque_atual`.
- O lançamento financeiro da venda continua sendo criado.
- Se o lançamento financeiro falhar após a baixa, o saldo da variante é restaurado como compensação.

### Compras e recebimento fracionado (Sprint 4 — Supply Chain v1.2)

- Pedidos em `Rascunho` e `Aguardando Aprovação` podem ser editados.
- Pedidos aprovados, parcialmente recebidos, concluídos ou cancelados ficam em modo leitura.
- O recebimento abre um fluxo separado para informar a quantidade recebida por item.
- A migração `database/migracao_recebimento_fracionado.sql` permite que o recebimento atualize somente `quantidade_recebida`, mantendo bloqueadas alterações de produtos, preços e quantidade solicitada.
- O status de recebimento segue os nomes atuais do banco: `Parcialmente Recebido` e `Concluído`.
- O botão "Novo Pedido" funciona corretamente. A função `openModalNovoPedido` está exposta globalmente em `window.openModalNovoPedido` e em `window.Compras.openModalNovoPedido`.
- RBAC: `canCriar()` retorna `true` para `isExecutiveAdmin` ou para usuários com permissão `criar_pedido_compra` / `mod-produtos` / `mod-produtos:create`.
- Aprovação de pedidos restrita à Tesouraria e `isExecutiveAdmin` (`canAprovar()`).
- A aprovação gera automaticamente lançamento financeiro de "Saída" (orçado/não conciliado) em `lancamentos_financeiros`.
- A coluna de data de entrega no banco se chama `data_prevista_entrega` (não `data_previsao`). Toda referência no código deve usar esse nome.

### Sessão e login

- Foi adicionada uma tela neutra de carregamento (`#app-loading`).
- Login e painel permanecem ocultos até a verificação da sessão no Supabase.
- O fluxo elimina o flash da tela de login ao recarregar a página.
- **Fix crítico:** `openApp()` agora esconde `#app-loading` antes de exibir `#app-wrapper`. Sem isso, a tela de carregamento bloqueava o painel indefinidamente após login bem-sucedido.

### Correção de encoding e compatibilidade Supabase JS

- O `app.js` deve ser mantido em encoding **UTF-8** (sem BOM).
- O `supabase.from().upsert()` retorna um `PostgrestBuilder` (thenable), não uma `Promise` nativa. A chamada `.catch()` direta foi substituída por `.then(function(r){ if(r.error) ... })` para evitar o console error `upsert(...).catch is not a function`.

### Testes automatizados (Playwright)

- **5/5 testes passando** (chat.spec.js + modules.spec.js).
- Testes: Chat Realtime (envio + recepção via WebSocket), Financeiro (Livro Caixa), Produtos/Estoque, Acessos e GED.

## Migrações pendentes no Supabase

Execute no SQL Editor do Supabase, nesta ordem:

1. `database/migracao_eventos_uuid.sql` — UUID automático na tabela `eventos`
2. `database/migracao_cronograma_postagens_uuid.sql` — UUID automático em `cronograma_postagens`
3. `database/migracao_recebimento_fracionado.sql` — Trigger que bloqueia edição estrutural de itens em pedidos aprovados (sem ela, o recebimento parcial retorna erro 409)
4. `database/migracao_coordenador_modalidades.sql` — Cria a tabela `coordenador_modalidades` (sem ela, o sync loga 404 no console, mas não trava o app)

## Próximos passos prioritários

1. Aplicar e validar as migrações no ambiente Supabase de produção.
2. Criar uma função RPC/transação no banco para registrar venda e lançamento financeiro de forma atômica.
3. Completar o padrão de UI otimista, com rollback, nos demais formulários:
   - lançamento financeiro manual;
   - cadastro de atletas;
   - cadastro e edição de produtos;
   - vendas de estoque.
4. Padronizar todos os UUIDs no banco com `gen_random_uuid()` e remover dependências legadas de `uuid_generate_v4()`.
5. Adicionar testes automatizados de integração para criação, exclusão, conciliação, venda e recebimento parcial.
6. Validar as políticas RLS para garantir que as operações de inserir, atualizar e excluir usadas pela interface tenham autorização adequada.

## Convenções técnicas

- Nunca considerar uma alteração concluída apenas com atualização de `window.DB`; ações críticas devem ser persistidas no Supabase.
- Após operações persistidas, sincronizar o estado local e renderizar os módulos afetados.
- Para tabelas renderizadas dinamicamente, preferir delegação de eventos.
- Operações financeiras e de estoque devem priorizar consistência. Quando duas gravações dependem uma da outra, preferir RPC/transaction no Supabase.
- Erros do banco devem ser exibidos de forma amigável; erros técnicos completos permanecem no console para diagnóstico.
- O `app.js` deve ser mantido em encoding **UTF-8** (sem BOM). Não usar `git checkout` direto para restaurar — o arquivo rastreado está em UTF-16. Usar `git cat-file -p <blob-hash>` e converter com Python.
- O Supabase JS v2 retorna `PostgrestBuilder` (thenable), não `Promise` nativa. Não usar `.catch()` diretamente; usar `.then(function(r){ if(r.error)... })` ou `await` com try/catch.
- A coluna de data de entrega nos pedidos de compra chama-se `data_prevista_entrega`. Não usar o nome legado `data_previsao` em queries REST.
- Toda nova tela/painel deve garantir que `#app-loading` seja escondido antes de ser exibido. O padrão correto em `openApp()` é: (1) hide `#app-loading`, (2) hide `#login-screen`, (3) show `#app-wrapper`.
