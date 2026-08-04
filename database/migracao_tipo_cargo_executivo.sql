-- Corrige a incompatibilidade entre os cargos executivos usados pela aplicação
-- e o enum tipo_cargo consumido pelos gatilhos jurídicos.
ALTER TYPE tipo_cargo ADD VALUE IF NOT EXISTS 'Presidente';
ALTER TYPE tipo_cargo ADD VALUE IF NOT EXISTS 'Vice-Presidente';
