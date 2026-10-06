-- Rollback for 20270108120000_fms_dispatch_delivery_challan.sql
--
-- Unpicks the two DC-1 patches by reversing the exact substitutions, then drops
-- the helper and the columns. REFUSES if any delivery challan has been raised:
-- dropping the column would turn those orders into invoices that silently
-- skipped credit.

-- ONE TRANSACTION: a failed anchor rolls back everything, never half-patched.
begin;

do $guard$
begin
  if exists (select 1 from public.fms_dispatch_orders where doc_type = 'delivery_challan') then
    raise exception 'Delivery challans exist - rolling back would relabel them as credit-skipping invoices';
  end if;
end $guard$;

do $unpatch$
declare
  v_def text;
  v_start int; v_end int;
  v_marker_end text := E'    raise exception ''Unknown document type - choose Sales Invoice or Delivery Challan'';\n  end if;\n';
begin
  -- submit: cut the block from its leading blank line + comment to the end of its elsif.
  v_def := pg_get_functiondef('public.fms_dispatch_submit_order(jsonb)'::regprocedure);
  v_start := position(E'\n  -- DC-1 · A DELIVERY CHALLAN SKIPS' in v_def);
  if v_start > 0 then
    v_end := position(v_marker_end in v_def) + length(v_marker_end);
    execute substr(v_def, 1, v_start - 1) || substr(v_def, v_end);
  end if;

  -- edit: restore the original guard and remove the re-stamp block.
  v_def := pg_get_functiondef('public.fms_dispatch_update_order(uuid,jsonb)'::regprocedure);
  if position('DC-1' in v_def) > 0 then
    v_def := replace(v_def,
         E'  if (v_status <> ''awaiting_credit_check'' or v_cc is not null)\n'
      || E'     -- DC-1 · a delivery challan never waits on credit; its edit window is the store''s.\n'
      || E'     and not exists (select 1 from public.fms_dispatch_orders x\n'
      || E'                      where x.id = p_order and x.doc_type = ''delivery_challan''\n'
      || E'                        and x.status = ''awaiting_material_status'' and x.ms_at is null) then\n',
         E'  if v_status <> ''awaiting_credit_check'' or v_cc is not null then\n');
    v_def := replace(v_def,
         E'    -- DC-1 · re-stamp the per-line challan rates the re-insert just cleared.\n'
      || E'    if exists (select 1 from public.fms_dispatch_orders x\n'
      || E'                where x.id = p_order and x.doc_type = ''delivery_challan'') then\n'
      || E'      perform public.fms_dispatch_apply_challan_rates(p_order, p->''lines'');\n'
      || E'    end if;\n',
         '');
    execute v_def;
  end if;
end $unpatch$;

drop function if exists public.fms_dispatch_apply_challan_rates(uuid, jsonb);
alter table public.fms_dispatch_order_items drop constraint if exists fms_dispatch_order_items_challan_rate_chk;
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_doc_type_chk;
alter table public.fms_dispatch_order_items drop column if exists challan_rate;
alter table public.fms_dispatch_orders drop column if exists doc_type;

commit;
