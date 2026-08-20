-- ===========================================================================
-- GENERATE SALES BILL — A BILL CAN BE PARKED, WITH A REASON.
--
-- The only thing this step could do was finish. Recording the bill demands a
-- Tally invoice number AND the invoice PDF (20260825120000:61-62), so an order
-- that must NOT be billed yet - payment not cleared, the customer has asked us
-- to wait, a document missing, something in dispute - had no action at all.
-- Typing the reason into Remarks did not help either: sb_remarks only reaches
-- this table as part of record_sales_bill, which is the very act being avoided.
-- The reason stayed in somebody's head, the row looked exactly like an order
-- nobody had touched, and the SLA clock turned it red as if it were forgotten.
--
-- This is the CREDIT HOLD's shape, not the ORDER hold's: the order stays at
-- `awaiting_sales_bill` and keeps its place in the queue, because deciding to
-- release it is this same desk's own work. Nothing here touches `status`.
--
-- ⚠ THE HOLD MUST NEVER STAND BETWEEN THE TEAM AND AN INVOICE.
--   record_sales_bill is deliberately NOT restated below. A held bill can be
--   recorded straight away - sb_at fills in, the "is it held?" test goes false,
--   and the row leaves the queue on its own. The three stamps stay behind as
--   history: this bill was held, by whom, for how long. Asserted at the end.
--
-- ⚠ NO sb_status COLUMN. 20260810120000 dropped it and it stays dropped.
--   "On hold" is `sb_hold_at is not null and sb_at is null`, exactly as a credit
--   hold is `cc_status = 'credit_hold' and cc_at is null`.
--
-- ⚠ DEPLOY THE DATABASE FIRST. dispatchFetch.ts selects * and maps named
--   fields, so a migrated database against the CURRENT frontend is harmless;
--   the new frontend against an un-migrated database is not.
--
-- Additive: three nullable columns on the order, three on the round archive,
-- one new RPC, and archive_round restated to carry and then clear them.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------- columns --
--
-- ⚠ BOTH ALTERS MUST STAY ABOVE THE FUNCTIONS. A plpgsql body is not parsed at
--   CREATE time, so a restated archive_round naming a column that does not
--   exist yet compiles perfectly and then fails at the first real archive.

alter table public.fms_dispatch_orders
  add column if not exists sb_hold_at     timestamptz,
  add column if not exists sb_hold_reason text,
  add column if not exists sb_hold_by     uuid references auth.users on delete set null;

comment on column public.fms_dispatch_orders.sb_hold_at is
  'When the bill was first parked. HELD SINCE, not last-touched: re-wording the reason must not reset it, or the ageing that makes an old hold findable quietly restarts. Live hold = this is set and sb_at is not.';
comment on column public.fms_dispatch_orders.sb_hold_reason is
  'Why the invoice is not being raised. COMPULSORY when holding - a hold with no reason is indistinguishable from an order nobody has looked at.';
comment on column public.fms_dispatch_orders.sb_hold_by is
  'Who parked it. Anyone who may record the bill may hold and release it.';

alter table public.fms_dispatch_rounds
  add column if not exists sb_hold_at     timestamptz,
  add column if not exists sb_hold_reason text,
  add column if not exists sb_hold_by     uuid references auth.users on delete set null;

comment on column public.fms_dispatch_rounds.sb_hold_at is
  'The hold AS AT this round. Travels with the sb_ block: recording the bill leaves the stamps in place, so a finished round still says whether its invoice was ever parked and for how long.';

-- ===========================================================================
-- 1. HOLDING AND RELEASING.
--
-- Modelled on fms_dispatch_hold_order (20260827120000:445) for shape and on the
-- credit_hold branch of fms_dispatch_record_credit_check (20260818120000:305)
-- for behaviour - the decision is recorded, the order does not advance.
--
-- ⚠ IT MUST NOT WRITE `status` OR `current_step`. Leaving them alone is the
--   whole mechanism: STATUS_STEP in lib/queues.ts is what puts the row in the
--   queue, in My Work, in the daily snapshot email and in the cross-FMS
--   scoreboard, and all four stay correct precisely because nothing moves.
--   Asserted at the end.
-- ===========================================================================
create or replace function public.fms_dispatch_hold_sales_bill(
  p_order uuid, p_hold boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_round integer; v_raiser uuid; v_reason text;
        v_uid uuid := auth.uid();
begin
  select status, order_no, round_no, raised_by
    into v_status, v_no, v_round, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;

  -- One check covers three refusals: an order still upstream, an order already
  -- billed, and an order a coordinator has parked or cancelled - none of which
  -- is a bill this desk can hold.
  if v_status <> 'awaiting_sales_bill' then
    raise exception 'This order is not awaiting the sales bill (status %)', v_status;
  end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then
    raise exception 'Not authorized to hold the sales bill';
  end if;

  if p_hold then
    v_reason := nullif(trim(p_reason), '');
    if v_reason is null then
      raise exception 'A remark is required when a bill is put on hold';
    end if;
    update public.fms_dispatch_orders set
      sb_hold_reason = v_reason,
      -- ⚠ coalesce, NOT now(). Pressing the button again to re-word the reason
      --   must leave "held since" where it was; refreshing it would hide how
      --   long the bill has actually been sitting, which is the one number the
      --   dashboard tile and the Control Center strip exist to show.
      sb_hold_at = coalesce(sb_hold_at, now()),
      sb_hold_by = coalesce(sb_hold_by, v_uid)
    where id = p_order;

    perform public.fms_dispatch_announce(
      'order', p_order, 'bill_on_hold',
      'Sales bill on ' || coalesce(v_no,'an order') || ' put on hold: ' || v_reason,
      array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'round_no', v_round, 'reason', v_reason));
  else
    update public.fms_dispatch_orders set
      sb_hold_at = null, sb_hold_reason = null, sb_hold_by = null
    where id = p_order;

    perform public.fms_dispatch_announce(
      'order', p_order, 'bill_hold_cleared',
      'Sales bill on ' || coalesce(v_no,'an order') || ' taken off hold.',
      array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'round_no', v_round));
  end if;
end $$;

revoke all on function public.fms_dispatch_hold_sales_bill(uuid, boolean, text) from public;
grant execute on function public.fms_dispatch_hold_sales_bill(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- 2. THE ARCHIVE. Restated verbatim from 20260831120000:353 - the only change
--    is the three sb_hold_ columns joining the sb_ block in the insert, the
--    select AND the wipe.
--
-- ⚠ THE WIPE IS THE LOAD-BEARING HALF. A new round raises a new invoice, and a
--   round that starts life carrying the last one's hold is a bill nobody can
--   see a reason for.
-- ===========================================================================
create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id, location_id,
    cc_status, cc_approved_qty, cc_remarks, cc_at, cc_by,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name,
    sb_eway_path, sb_eway_name, sb_remarks, sb_at, sb_by,
    sb_hold_at, sb_hold_reason, sb_hold_by,
    gp_no,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name,
    dc_attachment_pages, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id, o.location_id,
    -- ONLY the decision this round actually made. When credit approved enough to
    -- cover several rounds, the later ones inherit that decision and must archive
    -- NOTHING - otherwise one decision appears once per round it happened to
    -- cover, in the Completed tab and in the register.
    case when o.cc_round_no = o.round_no then o.cc_status       else null end,
    case when o.cc_round_no = o.round_no then o.cc_approved_qty else null end,
    case when o.cc_round_no = o.round_no then o.cc_remarks      else null end,
    case when o.cc_round_no = o.round_no then o.cc_at           else null end,
    case when o.cc_round_no = o.round_no then o.cc_by           else null end,
    o.ms_actual_date, o.ms_tempo_no, o.ms_porter, o.ms_remarks, o.ms_at, o.ms_by,
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name,
    o.sb_eway_path, o.sb_eway_name, o.sb_remarks, o.sb_at, o.sb_by,
    -- No round-ownership test, unlike the cc_ block: a hold belongs to the
    -- invoice this round did or did not raise, and the wipe below guarantees
    -- that whatever the header holds was set during THIS round.
    o.sb_hold_at, o.sb_hold_reason, o.sb_hold_by,
    -- Travels with the sb_ block, because it was issued for that invoice.
    o.gp_no,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name,
    o.dc_attachment_pages, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

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

  -- WIPE.
  --
  -- ⚠ company_id AND location_id ARE BOTH DELIBERATELY ABSENT. Both are chosen
  --   once at intake and are true for every round of the order, so wiping either
  --   would blank it the instant a round closed - and the header, the queues, the
  --   register, the emails and the row-level security predicate all read them.
  --   The archive keeps its own copies above, which is what makes a historic
  --   round self-describing.
  --
  -- ⚠ THE cc_ BLOCK IS ABSENT for a third reason: whether the credit decision
  --   survives into the next round depends on whether any headroom is left, which
  --   only the caller has worked out.
  --
  -- ⚠ gp_no, THE sb_eway_ PAIR, THE sb_hold_ TRIO AND dc_attachment_pages ARE
  --   ALL PRESENT, which is the opposite of the two fields above and easy to get
  --   wrong by proximity. A new round raises a NEW invoice and is delivered
  --   against NEW paperwork - one pass, one e-way bill and at most one hold per
  --   invoice is the whole rule, and carrying round one's stamped LR forward
  --   would attach it to round two's delivery.
  update public.fms_dispatch_orders set
    ms_actual_date = null, ms_tempo_no = null, ms_porter = null,
    ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_eway_path = null, sb_eway_name = null,
    sb_remarks = null, sb_at = null, sb_by = null,
    sb_hold_at = null, sb_hold_reason = null, sb_hold_by = null,
    gp_no = null,
    go_actual_date = null, go_outward_no = null, go_remarks = null, go_at = null, go_by = null,
    dc_actual_date = null, dc_status = null, dc_attachment_path = null,
    dc_attachment_name = null, dc_attachment_pages = null,
    dc_remarks = null, dc_at = null, dc_by = null,
    edited_at = null, edited_by = null
  where id = p_order;

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end $$;

revoke all on function public.fms_dispatch_archive_round(uuid, text) from public, authenticated;

-- ---------------------------------------------------------------- asserts --
--
-- Each lookup pins the identity arguments as well as the name: with a bare
-- proname join, a future overload makes `select ... into` pick an arbitrary row
-- WITHOUT erroring, and the assertion then silently checks the wrong function.
do $check$
declare v_src text;
begin
  -- ----------------------------------------------------- hold_sales_bill --
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_hold_sales_bill'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_hold boolean, p_reason text';
  if v_src is null then raise exception 'fms_dispatch_hold_sales_bill not found'; end if;
  -- A hold with no reason is indistinguishable from an untouched order.
  if v_src not like '%A remark is required when a bill is put on hold%' then
    raise exception 'hold_sales_bill no longer demands a reason'; end if;
  -- THE RULE THIS WHOLE MIGRATION RESTS ON. The moment this function writes a
  -- status, the row leaves the queue, My Work and the snapshot email - which is
  -- the order-level hold, not this one.
  if v_src ~* '(set|,)\s*status\s*=' or v_src ~* 'current_step\s*=' then
    raise exception 'hold_sales_bill now moves the order - it must only stamp the sb_hold_ columns'; end if;
  -- Held SINCE. now() in place of the coalesce restarts the ageing on every edit.
  if v_src not like '%sb_hold_at = coalesce(sb_hold_at, now())%' then
    raise exception 'hold_sales_bill no longer preserves the original hold time'; end if;

  -- --------------------------------------------------- record_sales_bill --
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_record_sales_bill'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p jsonb';
  if v_src is null then raise exception 'fms_dispatch_record_sales_bill not found'; end if;
  -- A hold must never block or complicate raising the invoice: no refusal, and
  -- no clearing either - the stamps are this round's history from here on.
  if v_src like '%sb_hold%' then
    raise exception 'record_sales_bill now touches the hold - it must ignore it entirely'; end if;
  -- Carried forward from 20260825120000.
  if v_src not like '%The Tally invoice number is required%'
     or v_src not like '%Attach the sales invoice before saving%' then
    raise exception 'record_sales_bill lost its required-field gates'; end if;

  -- -------------------------------------------------------- archive_round --
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_reason text';
  if v_src is null then raise exception 'fms_dispatch_archive_round not found'; end if;
  -- Carried into the archive, and - the half that matters - cleared off the
  -- header so the next round starts without it.
  if v_src not like '%sb_hold_at = null, sb_hold_reason = null, sb_hold_by = null%' then
    raise exception 'archive_round does not clear the sales-bill hold'; end if;
  if v_src not like '%o.sb_hold_at, o.sb_hold_reason, o.sb_hold_by%' then
    raise exception 'archive_round does not carry the sales-bill hold onto the round'; end if;
  -- Carried forward from 20260822120000 / 20260825120000 / 20260831120000.
  if v_src not like '%sb_eway_path = null%' or v_src not like '%gp_no = null%'
     or v_src not like '%dc_attachment_pages = null%' then
    raise exception 'archive_round lost part of its wipe'; end if;
  -- Carried forward from 20260827120000: the sales-return block is ORDER-scoped
  -- and terminal, and the archive runs AFTER the return is recorded.
  if position('sr_' in v_src) > 0 then
    raise exception 'archive_round now touches the sales-return block'; end if;
end $check$;

commit;
