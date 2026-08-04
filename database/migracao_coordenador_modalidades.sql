-- ============================================================================
-- MIGRAÇÃO: coordenador_modalidades
-- v3 — sem FKs em usuario_id e modalidade_id pois ambas as tabelas de
-- referência (usuarios, modalidades) usam id como TEXT no banco Supabase,
-- enquanto o schema local declara UUID. FKs exigem tipos idênticos.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS coordenador_modalidades (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id    TEXT NOT NULL,
    modalidade_id TEXT NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT coordenador_modalidades_usuario_modalidade_key
        UNIQUE (usuario_id, modalidade_id)
);

CREATE INDEX IF NOT EXISTS idx_coordenador_modalidades_usuario
    ON coordenador_modalidades(usuario_id);

CREATE INDEX IF NOT EXISTS idx_coordenador_modalidades_modalidade
    ON coordenador_modalidades(modalidade_id);

ALTER PUBLICATION supabase_realtime ADD TABLE coordenador_modalidades;
