-- ===========================================================================
-- HOTFIX — fms_dispatch_archive_round REFERENCED A DROPPED COLUMN AGAIN.
--
-- WHAT BROKE
--   Confirming a delivery failed with:
--     column "unit_id" of relation "fms_dispatch_round_items" does not exist
--   archive_round runs on every path that ends a round, so Confirmation on
--   Dispatch was dead for every order.
--
-- HOW IT BROKE — the lesson, not the excuse
--   The units master was cut in 20260810120200, and 20260811120000 repaired
--   archive_round by patching the LIVE definition with pg_get_functiondef +
--   replace() (dropping `unit_id`, sourcing the label from `li.unit`, removing
--   the units join). That repair therefore existed ONLY in the database — no
--   migration file contains the corrected body.
--
--   20260812120000 then re-issued archive_round by copying the body out of
--   20260810120100 to add one line (`company_id = null` to the WIPE). That copy
--   was the PRE-REPAIR text, so it silently reverted all three fixes.
--
-- ⚠ THE RULE THIS COSTS: a function repaired by an in-place pg_get_functiondef
--   patch has NO canonical source in the repo. Before `create or replace`-ing any
--   fms_dispatch_* function from an old migration file, diff it against the live
--   definition first:
--     select pg_get_functiondef(oid) from pg_proc where proname = '<fn>';
--   The newest migration that MENTIONS a function is not necessarily the one that
--   DEFINES it.
--
-- This file now carries the whole corrected body, so it is the canonical source.
-- `fms_dispatch_round_items` has: round_id, order_item_id, line_no, item_id,
-- item_name, unit_name, ordered_qty, ship_qty, lot_no — there is no unit_id, and
-- the unit label lives on fms_dispatch_order_items.unit (text).
-- ===========================================================================

begin;

create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id,
    ms_actual_date, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name, sb_remarks, sb_at, sb_by,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id,
    o.ms_actual_date, o.ms_remarks, o.ms_at, o.ms_by,
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name, o.sb_remarks, o.sb_at, o.sb_by,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

  -- Only lines that actually went out. That set IS "this round's consignment",
  -- which is what the sales-bill and delivery screens render.
  --
  -- ⚠ NO unit_id, and NO join to fms_dispatch_units — that master is gone. The
  --   unit is plain text carried on the order line (a snapshot taken when the
  --   order was raised), and it is frozen onto the round item here so history
  --   survives a later rename.
  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name,
    ordered_qty, ship_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    coalesce(it.name, 'Item'), li.unit,
    li.quantity, li.ship_qty, li.lot_no
  from public.fms_dispatch_order_items li
  left join public.fms_dispatch_items it on it.id = li.item_id
  where li.order_id = p_order and coalesce(li.ship_qty, 0) > 0
  order by li.line_no;

  -- WIPE. This is the half people forget, and forgetting it makes every closed
  -- order exist twice: once in the archive and once on the header.
  --
  -- `company_id` is part of the step block now (it is chosen at material status),
  -- so it clears with the rest — the next round is a fresh decision.
  update public.fms_dispatch_orders set
    company_id = null,
    ms_actual_date = null, ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_remarks = null, sb_at = null, sb_by = null,
    go_actual_date = null, go_outward_no = null, go_remarks = null, go_at = null, go_by = null,
    dc_actual_date = null, dc_status = null, dc_attachment_path = null,
    dc_attachment_name = null, dc_remarks = null, dc_at = null, dc_by = null,
    edited_at = null, edited_by = null
  where id = p_order;

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end $$;
revoke all on function public.fms_dispatch_archive_round(uuid, text) from public, authenticated;

-- Assert the dropped identifiers are really gone from the installed definition.
--
-- ⚠ MATCH CODE, NOT PROSE. pg_get_functiondef returns the body INCLUDING comments,
--   and the comment above deliberately names `unit_id` and the units master. A
--   bare '%unit_id%' test therefore fires on this file's own documentation. Each
--   check below matches a token sequence that can only occur in executable SQL.
do $check$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_reason text';
  if v_def is null then raise exception 'archive_round missing after replace'; end if;
  if v_def like '%li.unit_id%' then raise exception 'archive_round still selects li.unit_id'; end if;
  if v_def like '%unit_name, unit_id%' then raise exception 'archive_round still inserts a unit_id column'; end if;
  if v_def like '%join public.fms_dispatch_units%' then raise exception 'archive_round still joins the dropped units master'; end if;
  if v_def not like '%company_id = null%' then raise exception 'archive_round lost the company_id wipe'; end if;
end $check$;

commit;
