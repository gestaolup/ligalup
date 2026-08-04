-- Separa a edição financeira do pedido do recebimento físico de estoque.
-- Em pedidos aprovados, somente quantidade_recebida pode ser atualizada pela
-- trigger de recebimento; fornecedor, itens, quantidades compradas e preços
-- permanecem bloqueados.
CREATE OR REPLACE FUNCTION public.fn_trg_state_machine_itens()
RETURNS TRIGGER AS $$
DECLARE
    v_status_capa VARCHAR(50);
    v_alteracao_estrutural BOOLEAN;
BEGIN
    SELECT status INTO v_status_capa
    FROM public.pedidos_compra
    WHERE id = NEW.pedido_id;

    v_alteracao_estrutural :=
        OLD.pedido_id IS DISTINCT FROM NEW.pedido_id OR
        OLD.produto_id IS DISTINCT FROM NEW.produto_id OR
        OLD.variante_id IS DISTINCT FROM NEW.variante_id OR
        OLD.quantidade_solicitada IS DISTINCT FROM NEW.quantidade_solicitada OR
        OLD.preco_unitario IS DISTINCT FROM NEW.preco_unitario;

    IF v_status_capa IN ('Aprovado', 'Parcialmente Recebido', 'Concluído', 'Cancelado')
       AND v_alteracao_estrutural THEN
        RAISE EXCEPTION
            'Erro 409: Pedido em status "%" - itens e valores não podem ser editados.',
            v_status_capa
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
