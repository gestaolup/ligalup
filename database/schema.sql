-- ============================================================================
-- PLATAFORMA SAAS DE GESTÃO ESTRATÉGICA - ATLÉTICA UNIVERSITÁRIA
-- SCHEMA DO BANCO DE DADOS (POSTGRESQL) - MVP v2.0
-- ============================================================================

-- Extensão para geração de UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Enums e Tipos customizados
-- ----------------------------------------------------------------------------
CREATE TYPE tipo_cargo AS ENUM (
    'Master', 'Presidente', 'Vice-Presidente', 'Diretor', 'Coordenador', 'Apoio'
);

CREATE TYPE tipo_diretoria AS ENUM (
    'Presidência', 'Vice-Presidência', 'Tesouraria', 'Esportes', 
    'Marketing', 'Produtos', 'Jurídico', 'Relações Externas', 'Nenhuma'
);

CREATE TYPE status_evento AS ENUM ('Rascunho', 'Aguardando Tesouraria', 'Aprovado', 'Cancelado');

CREATE TYPE status_tarefa AS ENUM ('Pendente', 'Em Andamento', 'Concluído');

CREATE TYPE tipo_lancamento AS ENUM ('Entrada', 'Saída');

CREATE TYPE status_atleta AS ENUM ('Pendente', 'Aprovado', 'Rejeitado');

CREATE TYPE status_funil_parceria AS ENUM (
    'Prospecção', 'Proposta', 'Proposta Gerada', 'Negociação',
    'Contrato Anexado / Em Assinatura', 'Contrato Ativo', 'Arquivado'
);

CREATE TYPE tipo_plataforma AS ENUM ('Instagram', 'WhatsApp', 'LinkedIn', 'Outra');

-- ----------------------------------------------------------------------------
-- Tabelas base do sistema
-- ----------------------------------------------------------------------------

-- 1. Usuários
CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    cargo tipo_cargo NOT NULL,
    diretoria tipo_diretoria NOT NULL DEFAULT 'Nenhuma',
    status BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Eventos
CREATE TABLE eventos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL,
    data_evento TIMESTAMP WITH TIME ZONE NOT NULL,
    local VARCHAR(255) NOT NULL,
    orcamento_previsto DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    status_aprovacao status_evento NOT NULL DEFAULT 'Rascunho',
    tipo VARCHAR(100) NOT NULL DEFAULT 'Institucional',
    valor_taxa_base DECIMAL(12, 2) DEFAULT 0.00,
    criador_id UUID NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tarefas de Logística
CREATE TABLE tarefas_logistica (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    descricao TEXT NOT NULL,
    data_prazo TIMESTAMP WITH TIME ZONE NOT NULL,
    responsavel_id UUID NOT NULL REFERENCES usuarios(id),
    status status_tarefa NOT NULL DEFAULT 'Pendente',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Modalidades Esportivas
CREATE TABLE modalidades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL,
    coordenador_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Vínculo N:N entre coordenadores/apoios e modalidades esportivas
CREATE TABLE coordenador_modalidades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    modalidade_id UUID NOT NULL REFERENCES modalidades(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT coordenador_modalidades_usuario_modalidade_key UNIQUE (usuario_id, modalidade_id)
);

-- 5. Atletas
CREATE TABLE atletas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL,
    ra_matricula VARCHAR(50) UNIQUE NOT NULL,
    contato VARCHAR(50),
    email VARCHAR(255),
    modalidade_id UUID NOT NULL REFERENCES modalidades(id) ON DELETE CASCADE,
    status_documentacao status_atleta NOT NULL DEFAULT 'Pendente',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Parceiros e Patrocinadores
CREATE TABLE parceiros_patrocinadores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome_empresa VARCHAR(255) NOT NULL,
    tipo_parceria VARCHAR(100) NOT NULL, -- Ex: Financeiro, Material, Divulgação
    status_funil status_funil_parceria NOT NULL DEFAULT 'Prospecção',
    link_proposta_drive VARCHAR(1024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Documentos e Contratos
CREATE TABLE documentos_contratos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    titulo VARCHAR(255) NOT NULL,
    tipo_documento VARCHAR(100) NOT NULL, -- Ex: Contrato, Termo de Parceria, Ofício
    arquivo_url VARCHAR(1024) NOT NULL, -- Link de texto simples (Google Drive) - C-07
    data_vencimento TIMESTAMP WITH TIME ZONE,
    parceiro_id UUID REFERENCES parceiros_patrocinadores(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Produtos (Tabela Pai revisada - C-02)
CREATE TABLE produtos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL,
    preco_custo DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    preco_venda DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Variantes de Produtos (Tabela Filha nova - C-02)
CREATE TABLE produto_variantes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    tamanho VARCHAR(20) NOT NULL, -- Ex: P, M, G, GG, Único
    estoque_atual INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT chk_estoque_positivo CHECK (estoque_atual >= 0), -- RN-PROD-01
    CONSTRAINT uq_produto_tamanho UNIQUE (produto_id, tamanho)
);

-- 10. Calendário Editorial (Marketing - C-03)
CREATE TABLE calendario_editorial (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    plataforma tipo_plataforma NOT NULL,
    data_publicacao TIMESTAMP WITH TIME ZONE NOT NULL,
    descricao TEXT NOT NULL,
    responsavel_id UUID NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Lançamentos Financeiros (Caixa)
CREATE TABLE lancamentos_financeiros (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo tipo_lancamento NOT NULL,
    categoria VARCHAR(100) NOT NULL,
    valor DECIMAL(12, 2) NOT NULL,
    data_competencia TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status_conciliacao BOOLEAN NOT NULL DEFAULT FALSE, -- C-04
    evento_id UUID REFERENCES eventos(id) ON DELETE SET NULL,
    produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. Logs de Notificações e Auditoria (Append-Only - RN-LOG-01)
CREATE TABLE logs_notificacoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    tipo_notificacao VARCHAR(100) NOT NULL, -- Ex: Email, Alerta In-App
    gatilho_regra VARCHAR(100) NOT NULL, -- Ex: SOLICITACAO_VERBA, TENTATIVA_VIOLACAO
    destinatario_email VARCHAR(255) NOT NULL,
    status_entrega VARCHAR(50) NOT NULL, -- Ex: ENVIADO, FALHA
    data_envio TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    erro_detalhe TEXT -- Armazena stack de erros do provedor (Resend/SendGrid)
);

-- 13. Fornecedores (Novidade Fase 2)
CREATE TABLE fornecedores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL,
    contato_nome VARCHAR(255),
    telefone VARCHAR(50),
    email VARCHAR(255),
    tipo_produto VARCHAR(255),
    categoria_servico VARCHAR(255), -- Vestuário, Transporte, Alimentação, Som & Iluminação, etc.
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. Pedidos de Compra / Encomendas Pendentes (Novidade Fase 2)
CREATE TABLE pedidos_compra (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fornecedor_id UUID NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
    produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    tamanho VARCHAR(20) NOT NULL,
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    status VARCHAR(50) NOT NULL DEFAULT 'Pendente', -- Pendente, Recebido, Cancelado
    data_pedido TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    data_previsao TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 15. Cronograma de Postagens de Marketing (Fase 4)
CREATE TABLE cronograma_postagens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    plataforma VARCHAR(50) NOT NULL, -- Instagram, WhatsApp, LinkedIn, TikTok, Outro
    tipo_conteudo VARCHAR(50) NOT NULL, -- Stories, Feed, Reels, Carrossel, Texto
    data_publicacao TIMESTAMP WITH TIME ZONE NOT NULL,
    descricao TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Agendado', -- Agendado, Publicado, Cancelado
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. Escalações de Atletas por Evento e Modalidade (Fase 4)
CREATE TABLE escalacoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    modalidade_id UUID NOT NULL REFERENCES modalidades(id) ON DELETE CASCADE,
    atleta_id UUID NOT NULL REFERENCES atletas(id) ON DELETE CASCADE,
    funcao VARCHAR(100) NOT NULL DEFAULT 'Titular', -- Titular, Reserva, Capitão, Staff Técnico
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_evento_modalidade_atleta UNIQUE (evento_id, modalidade_id, atleta_id)
);

-- 17. Participantes de Eventos Sociais/Mistos (Fase 4)
CREATE TABLE participantes_evento (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    nome VARCHAR(255) NOT NULL,
    ra_matricula VARCHAR(50),
    valor_cobrado DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    status_pagamento VARCHAR(50) NOT NULL DEFAULT 'Pendente', -- Pago, Pendente, Isento
    forma_pagamento VARCHAR(50), -- Pix, Dinheiro, Cartão, Isento
    data_pagamento DATE,
    obs TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
