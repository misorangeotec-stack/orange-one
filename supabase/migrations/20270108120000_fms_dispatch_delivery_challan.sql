-- =============================================================================
--  DC-1 · Delivery Challan orders — raised like a sales order, never credit-checked
-- =============================================================================
--
--  An order now says WHICH DOCUMENT it goes out on:
--
--      invoice            the ordinary sales order. Unchanged in every way:
--                         credit check, partial release, back-to-credit loop.
--      delivery_challan   goods sent FOC. EVERY LINE carries its own rate, ₹0
--                         or ₹1 a unit. Nothing is sold on credit, so the
--                         credit-limit step is skipped ENTIRELY: the order is
--                         born at Check Material Status and the credit team is
--                         never told about it.
--
--  Why skipping is safe all the way down the chain, not just at intake:
--    · cc_approved_qty stays NULL on a challan, and NULL is "uncapped" to both
--      fms_dispatch_apply_ship_lines (no ceiling) and
--      fms_dispatch_record_dispatch_confirm (null headroom => never v_to_credit).
--      So a part-dispatched challan loops back to the STORE, never to credit.
--    · fms_dispatch_record_material_status reads only status, never cc_*.
--
--  The billing step is unchanged server-side: sb_invoice_no holds the DC number
--  the biller types. Only the label on screen differs.
--
--  ⚠ PATCHED BY ANCHOR, NOT RESTATED. submit_order and update_order are
--    rewritten in place from pg_get_functiondef, and fms_dispatch_replace_lines
--    is NOT touched at all — the repo copies of all three have drifted from live
--    (they were patched by substitution before), so restating any of them from a
--    file risks reverting a live change nobody wrote down here.
--
--  Additive only: new columns, defaults every existing row already reads as.
-- =============================================================================


-- ONE TRANSACTION: a failed anchor rolls back everything, never half-patched.
begin;

/* --------------------------------------------------------------- columns -- */

alter table public.fms_dispatch_orders
  add column if not exists doc_type text not null default 'invoice';

alter table public.fms_dispatch_order_items
  add column if not exists challan_rate numeric;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'fms_dispatch_orders_doc_type_chk') then
    alter table public.fms_dispatch_orders
      add constraint fms_dispatch_orders_doc_type_chk
      check (doc_type in ('invoice', 'delivery_challan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fms_dispatch_order_items_challan_rate_chk') then
    alter table public.fms_dispatch_order_items
      add constraint fms_dispatch_order_items_challan_rate_chk
      check (challan_rate is null or challan_rate in (0, 1));
  end if;
end $c$;

comment on column public.fms_dispatch_orders.doc_type is
  'DC-1: invoice (ordinary sales order, credit-checked) or delivery_challan (FOC at ₹0/₹1 per line, skips the credit check entirely). Fixed at intake.';
comment on column public.fms_dispatch_order_items.challan_rate is
  'DC-1: ₹ per unit this line goes out at on a delivery challan - 0 (FOC) or 1. Null on an invoice line.';


/* ------------------------------------------------- per-line rate stamper -- */

-- Runs straight after fms_dispatch_replace_lines, which deletes and re-inserts
-- every line numbering them 1..n in payload order, SKIPPING blank rows (no
-- item_id). This walks the payload the same way so payload line k lands on
-- line_no k, then proves every line got a rate.
create or replace function public.fms_dispatch_apply_challan_rates(p_order uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  l jsonb; v_n integer := 0; v_rate text; v_missing integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(l->>'item_id'), '') = '' then continue; end if;
    v_n := v_n + 1;
    v_rate := coalesce(trim(l->>'challan_rate'), '');
    if v_rate not in ('0', '1') then
      raise exception 'Every delivery challan line goes out at Rs 0 (FOC) or Rs 1 - line % has neither', v_n;
    end if;
    update public.fms_dispatch_order_items
       set challan_rate = v_rate::numeric
     where order_id = p_order and line_no = v_n;
  end loop;

  select count(*) into v_missing
    from public.fms_dispatch_order_items
   where order_id = p_order and challan_rate is null;
  if v_missing > 0 then
    raise exception 'Delivery challan: % line(s) could not be given a rate', v_missing;
  end if;
end
$fn$;

revoke all on function public.fms_dispatch_apply_challan_rates(uuid, jsonb) from public, anon, authenticated;


/* ---------------------------------------------------------------- intake -- */

do $patch$
declare
  v_def text;
  v_anchor text := E'  perform public.fms_dispatch_replace_lines(v_id, p->''lines'');\n';
  v_add text :=
       E'\n'
    || E'  -- DC-1 · A DELIVERY CHALLAN SKIPS THE CREDIT CHECK ENTIRELY. The row was\n'
    || E'  --   inserted above exactly as a sales order; it is moved to the store here,\n'
    || E'  --   inside the same transaction, and returns BEFORE the credit announcement\n'
    || E'  --   below - the credit team is never told about a challan at all.\n'
    || E'  if lower(coalesce(trim(p->>''doc_type''), '''')) = ''delivery_challan'' then\n'
    || E'    perform public.fms_dispatch_apply_challan_rates(v_id, p->''lines'');\n'
    || E'    update public.fms_dispatch_orders set\n'
    || E'      doc_type = ''delivery_challan'',\n'
    || E'      status = ''awaiting_material_status'', current_step = ''material_status''\n'
    || E'    where id = v_id;\n'
    || E'\n'
    || E'    perform public.fms_dispatch_announce(\n'
    || E'      ''order'', v_id, ''raised'',\n'
    || E'      ''Delivery challan '' || v_no || '' raised - no credit check, awaiting the material-status check.'',\n'
    || E'      public.fms_dispatch_step_owner_ids(''material_status''),\n'
    || E'      jsonb_build_object(''order_no'', v_no, ''doc_type'', ''delivery_challan'')\n'
    || E'    );\n'
    || E'    return v_id;\n'
    || E'  elsif coalesce(trim(p->>''doc_type''), '''') not in ('''', ''invoice'') then\n'
    || E'    raise exception ''Unknown document type - choose Sales Invoice or Delivery Challan'';\n'
    || E'  end if;\n';
  n int;
begin
  v_def := pg_get_functiondef('public.fms_dispatch_submit_order(jsonb)'::regprocedure);
  if position('DC-1' in v_def) > 0 then
    raise notice 'fms_dispatch_submit_order already patched for DC-1 - skipping';
    return;
  end if;
  n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if n <> 1 then
    raise exception 'fms_dispatch_submit_order: expected exactly one replace_lines anchor, found %', n;
  end if;
  execute replace(v_def, v_anchor, v_anchor || v_add);
end $patch$;


/* ------------------------------------------------------------------ edit -- */

-- Edit was allowed only while the order waits on credit. A challan never does,
-- so its window is the store's: editable until the stock check is recorded and
-- before anything has gone out. The type itself is not editable - it decided
-- which steps the order runs. replace_lines re-inserts every line, so a
-- challan's rates are re-stamped from the payload straight after it.
do $patch$
declare
  v_def text;
  v_guard_old text := E'  if v_status <> ''awaiting_credit_check'' or v_cc is not null then\n';
  v_guard_new text :=
       E'  if (v_status <> ''awaiting_credit_check'' or v_cc is not null)\n'
    || E'     -- DC-1 · a delivery challan never waits on credit; its edit window is the store''s.\n'
    || E'     and not exists (select 1 from public.fms_dispatch_orders x\n'
    || E'                      where x.id = p_order and x.doc_type = ''delivery_challan''\n'
    || E'                        and x.status = ''awaiting_material_status'' and x.ms_at is null) then\n';
  v_lines_old text := E'    perform public.fms_dispatch_replace_lines(p_order, p->''lines'');\n';
  v_lines_new text := v_lines_old
    || E'    -- DC-1 · re-stamp the per-line challan rates the re-insert just cleared.\n'
    || E'    if exists (select 1 from public.fms_dispatch_orders x\n'
    || E'                where x.id = p_order and x.doc_type = ''delivery_challan'') then\n'
    || E'      perform public.fms_dispatch_apply_challan_rates(p_order, p->''lines'');\n'
    || E'    end if;\n';
  v_probe text;
  n int;
begin
  v_def := pg_get_functiondef('public.fms_dispatch_update_order(uuid,jsonb)'::regprocedure);
  if position('DC-1' in v_def) > 0 then
    raise notice 'fms_dispatch_update_order already patched for DC-1 - skipping';
    return;
  end if;
  foreach v_probe in array array[v_guard_old, v_lines_old] loop
    n := (length(v_def) - length(replace(v_def, v_probe, ''))) / length(v_probe);
    if n <> 1 then
      raise exception 'fms_dispatch_update_order: expected exactly one of "%", found %', left(v_probe, 60), n;
    end if;
  end loop;
  v_def := replace(v_def, v_guard_old, v_guard_new);
  v_def := replace(v_def, v_lines_old, v_lines_new);
  execute v_def;
end $patch$;


/* --------------------------------------------------------------- proofs -- */

do $check$
declare v_bad int;
begin
  if position('DC-1' in pg_get_functiondef('public.fms_dispatch_submit_order(jsonb)'::regprocedure)) = 0
   or position('DC-1' in pg_get_functiondef('public.fms_dispatch_update_order(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'DC-1 patch did not take on one or both functions';
  end if;
  -- Every existing order reads as an invoice, every existing line carries no rate.
  select count(*) into v_bad from public.fms_dispatch_orders where doc_type <> 'invoice';
  if v_bad > 0 then raise exception 'DC-1: % existing order(s) did not default to invoice', v_bad; end if;
  select count(*) into v_bad from public.fms_dispatch_order_items where challan_rate is not null;
  if v_bad > 0 then raise exception 'DC-1: % existing line(s) carry a challan rate', v_bad; end if;
end $check$;

commit;
