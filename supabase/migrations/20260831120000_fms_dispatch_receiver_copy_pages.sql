-- ===========================================================================
-- CONFIRMATION ON DISPATCH — THE RECEIVER COPY IS MORE THAN ONE PAGE.
--
-- The delivery is confirmed by whoever is at the customer's gate, on a phone.
-- What they are holding is a paper LR: the front carries the consignment, the
-- BACK carries the signature and the stamp — the half that actually proves the
-- delivery. One `text` column held one file, so the back had nowhere to go and
-- people were photographing the front, or worse, stapling two deliveries'
-- paperwork into one scan.
--
-- Additive: ONE nullable jsonb column on the order and one on the round
-- archive, plus the three functions that carry the dc_ block restated with it.
--
-- ⚠ PAGE ONE IS NOT IN THE NEW COLUMN. It stays in dc_attachment_path /
--   dc_attachment_name, which the register export, the order panel, the round
--   archive and every historic row already read. The new column is pages 2..N
--   ONLY. Duplicating page one here would render it twice and give it two
--   sources of truth.
--
-- ⚠ NULL, NEVER '[]', IS THE EMPTY FORM. Every row written before this
--   migration is null; a row saved with no extra pages must read identically,
--   or every consumer has to handle two spellings of "nothing".
--
-- ⚠ DEPLOY THE DATABASE FIRST — the opposite of 20260827120000, which said the
--   reverse, so do not pattern-match on it. dispatchFetch.ts selects `*` and
--   maps named fields, so a migrated database against the CURRENT frontend is
--   harmless; the new frontend against an un-migrated database is not.
--
-- ⚠ NO STORAGE CHANGE, DELIBERATELY. The extra pages go in the SAME `receiver`
--   folder, which fms_dispatch_can_add_doc already maps to dispatch_confirm.
--   Inventing a new folder is what silently locks non-admin step owners out at
--   the Storage layer — see the `eway` bug repaired in 20260827120000.
--
-- KNOWN, ACCEPTED DEBT: clearing pages nulls the column and leaves the objects
-- in the bucket. That is already true of dc_attachment_path and sb_eway_path;
-- this makes it N times more of the same, not a new class of problem.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------- columns --
--
-- ⚠ BOTH ALTERS MUST STAY ABOVE EVERY FUNCTION BELOW. A plpgsql body is not
--   parsed at CREATE time, so a restated archive_round naming a column that
--   does not exist yet compiles perfectly and then fails at the first real
--   dispatch confirmation. The ordering bug is silent, which is why it is
--   called out rather than left to be noticed.

alter table public.fms_dispatch_orders
  add column if not exists dc_attachment_pages jsonb;

-- Array-ness only. Per-element shape is enforced by fms_dispatch_doc_pages
-- below, NOT here: a CHECK cannot contain a subquery, so validating {path,name}
-- per element would need a function inside the constraint, which makes pg_dump
-- restore order depend on that function existing first.
--
-- The `is null or` arm is for the reader; jsonb_typeof(null) is null, so nulls
-- would pass either way. Dropped first so the migration is re-runnable.
alter table public.fms_dispatch_orders
  drop constraint if exists fms_dispatch_orders_dc_pages_is_array;
alter table public.fms_dispatch_orders
  add constraint fms_dispatch_orders_dc_pages_is_array
  check (dc_attachment_pages is null or jsonb_typeof(dc_attachment_pages) = 'array');

comment on column public.fms_dispatch_orders.dc_attachment_pages is
  'The receiver copy''s EXTRA pages - the back of the LR, a second sheet, a photo of the stamp. JSON array of {path, name} in fms-dispatch-docs, folder `receiver`, in display order. PAGE ONE IS NOT HERE: it stays in dc_attachment_path/dc_attachment_name. NULL - never [] - when there are no extra pages.';

alter table public.fms_dispatch_rounds
  add column if not exists dc_attachment_pages jsonb;

alter table public.fms_dispatch_rounds
  drop constraint if exists fms_dispatch_rounds_dc_pages_is_array;
alter table public.fms_dispatch_rounds
  add constraint fms_dispatch_rounds_dc_pages_is_array
  check (dc_attachment_pages is null or jsonb_typeof(dc_attachment_pages) = 'array');

comment on column public.fms_dispatch_rounds.dc_attachment_pages is
  'The extra receiver-copy pages AS AT this round. They travel with the dc_ block: each round is delivered by its own driver with its own paperwork, so round 2 must never show round 1''s photographs.';

-- --------------------------------------------------------------- helper ----
/**
 * Normalise the extra-pages payload into what the column is documented to hold.
 *
 * ONE function, called by both RPCs, because two hand-copied jsonb_agg blocks
 * is exactly how the record path and the correct path drift apart.
 *
 * The three states mirror the text attachment contract the client already
 * knows (StepModal.tsx): key omitted => caller keeps what is stored (handled by
 * the caller's `p ? key` test, not here), an array => replace wholesale,
 * ''/null/[] => clear. Anything else is a programming error and says so.
 *
 * Not `security definer`: it touches no table, so it needs no elevation. No
 * grant either — EXECUTE is granted to PUBLIC by default and this file, unlike
 * a policy helper, is only ever called from inside another function's body.
 */
create or replace function public.fms_dispatch_doc_pages(p_pages jsonb, p_primary text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare v_out jsonb;
begin
  -- An absent key (SQL null) and a key sent as JSON null mean the same thing.
  if p_pages is null or jsonb_typeof(p_pages) = 'null' then return null; end if;
  -- '' clears, exactly as it does for an optional text attachment slot.
  if jsonb_typeof(p_pages) = 'string'
     and coalesce(trim(p_pages #>> '{}'), '') = '' then return null; end if;
  if jsonb_typeof(p_pages) <> 'array' then
    raise exception 'The receiver copy pages must be a JSON array of {path, name}';
  end if;

  select jsonb_agg(jsonb_build_object(
           'path', trim(e->>'path'),
           'name', coalesce(nullif(trim(e->>'name'), ''), trim(e->>'path')))
         order by ord)
    into v_out
    from jsonb_array_elements(p_pages) with ordinality t(e, ord)
   -- A page with no path is not a page.
   where coalesce(trim(e->>'path'), '') <> ''
   -- ⚠ PAGE ONE IS STRIPPED. A client holding the whole list and posting it
   --   verbatim would otherwise store the primary twice, and the documents
   --   strip would render it twice.
     and trim(e->>'path') is distinct from nullif(trim(p_primary), '');

  -- jsonb_agg over zero rows is already NULL, which IS the documented empty
  -- form. There is deliberately nothing to coalesce afterwards.
  return v_out;
end $$;

comment on function public.fms_dispatch_doc_pages(jsonb, text) is
  'Normalise a receiver-copy extra-pages payload: order-preserving, blank paths dropped, the primary stripped, empty forms collapsed to NULL.';

-- ===========================================================================
-- 1. RECORDING THE CONFIRMATION. Restated from 20260818120000; the only changes
--    are the v_pages local, the normalise call and one column in the update.
--    The three-way close / back-to-credit / loop routing and all three
--    announcements are byte-for-byte the same.
-- ===========================================================================
create or replace function public.fms_dispatch_record_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_raiser uuid; v_round integer; v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_pending numeric; v_reason text; v_round_id uuid; v_shipped numeric;
  v_allow numeric; v_headroom numeric; v_to_credit boolean; v_pages jsonb;
begin
  select status, order_no, raised_by, round_no, cc_approved_qty
    into v_status, v_no, v_raiser, v_round, v_allow
  from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_dispatch_confirm' then raise exception 'This order is not awaiting delivery confirmation (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('dispatch_confirm', p_order, v_uid) then raise exception 'Not authorized to confirm the dispatch'; end if;
  if v_dc is null or v_dc not in ('delivered','returned') then
    raise exception 'Record the delivery outcome: Delivered or Returned';
  end if;
  if coalesce(trim(p->>'dc_attachment_path'), '') = '' then
    raise exception 'Attach the receiver copy or LR before saving';
  end if;

  -- ⚠ THERE IS NO EQUIVALENT CHECK FOR THE EXTRA PAGES, and adding one would
  --   stop every single-page LR at the delivery desk. Page one is the record;
  --   the back of the sheet is evidence, not a rule.
  --
  -- Normalised HERE, after the authorisation and outcome checks, so a caller
  -- who may not act on this step is told that, and not handed a shape error.
  v_pages := public.fms_dispatch_doc_pages(p->'dc_attachment_pages',
                                           nullif(p->>'dc_attachment_path',''));

  -- Last line of defence against an empty consignment reaching the archive.
  select coalesce(sum(ship_qty), 0) into v_shipped
    from public.fms_dispatch_order_items where order_id = p_order;
  if v_shipped <= 0 then
    raise exception 'Nothing is marked as going out on this round - correct the material status first';
  end if;

  -- Plain assignment for the pages, not a presence-CASE like the edit path
  -- below: this function is reachable only at awaiting_dispatch_confirm, where
  -- the archive wipe has already nulled the column, so there is nothing to
  -- keep. That is exactly how dc_attachment_path itself is written here.
  update public.fms_dispatch_orders set
    dc_actual_date      = coalesce(nullif(p->>'dc_actual_date','')::date, current_date),
    dc_status           = v_dc,
    dc_attachment_path  = nullif(p->>'dc_attachment_path',''),
    dc_attachment_name  = nullif(p->>'dc_attachment_name',''),
    dc_attachment_pages = v_pages,
    dc_remarks          = nullif(trim(p->>'dc_remarks'), ''),
    dc_at = coalesce(dc_at, now()), dc_by = coalesce(dc_by, v_uid)
  where id = p_order;

  -- What will still be owed once this round is counted. Worked out BEFORE the
  -- archive, because the archived row has to carry the answer as its reason —
  -- and fms_dispatch_rounds is written once, not updated afterwards.
  -- A Returned round contributes nothing: the goods came back.
  select coalesce(sum(greatest(
           li.quantity - li.dispatched_qty
             - (case when v_dc = 'delivered' then coalesce(li.ship_qty, 0) else 0 end), 0)), 0)
    into v_pending
    from public.fms_dispatch_order_items li where li.order_id = p_order;

  -- ...and how much of the credit ceiling this round will have used up. Same
  -- projection, same reason. Null ceiling ⇒ null headroom ⇒ nothing to ask
  -- credit about, which is exactly how every pre-partial order behaves.
  --
  -- ⚠ A RETURNED round leaves headroom untouched, so it goes back to the store
  --   and not to credit. Credit released the quantity; it simply came home.
  if v_allow is null then
    v_headroom := null;
  else
    select v_allow - coalesce(sum(li.dispatched_qty
             + (case when v_dc = 'delivered' then coalesce(li.ship_qty, 0) else 0 end)), 0)
      into v_headroom
      from public.fms_dispatch_order_items li where li.order_id = p_order;
  end if;

  v_reason := case when v_pending <= 0 then 'closed' else 'looped' end;
  v_to_credit := (v_pending > 0 and v_headroom is not null and v_headroom <= 0);

  v_round_id := public.fms_dispatch_archive_round(p_order, v_reason);
  perform public.fms_dispatch_recalc_dispatched(p_order);

  if v_reason = 'closed' then
    update public.fms_dispatch_orders set
      status = 'closed', current_step = 'dispatch_confirm',
      closed_at = coalesce(closed_at, now())
    where id = p_order;

    perform public.fms_dispatch_announce(
      'order', p_order, 'dispatched',
      'Order ' || coalesce(v_no,'') || ' delivered in full and closed.',
      array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'dc_status', v_dc, 'round_no', v_round)
    );

  elsif v_to_credit then
    -- BACK TO CREDIT. Everything credit released has now gone out, so the
    -- balance has never been approved by anyone and must not move until it is.
    --
    -- ⚠ cc_approved_qty IS KEPT. It is the cumulative record of what credit has
    --   authorised over this order's life; the next decision adds to it. What is
    --   cleared is the DECISION — outcome, remark, stamps and round — so the
    --   step reads as genuinely open again and its SLA clock starts from the new
    --   round rather than from the order's receipt.
    update public.fms_dispatch_orders set
      round_no = round_no + 1,
      round_started_at = now(),
      status = 'awaiting_credit_check', current_step = 'credit_check',
      cc_status = null, cc_remarks = null, cc_round_no = null,
      cc_at = null, cc_by = null,
      cc_decided_at = null, cc_decided_by = null,
      cc_edited_at = null, cc_edited_by = null
    where id = p_order;

    perform public.fms_dispatch_announce(
      'order', p_order,
      case when v_dc = 'returned' then 'dispatch_returned' else 'dispatched' end,
      'Round ' || v_round || ' of ' || coalesce(v_no,'an order')
        || case when v_dc = 'returned' then ' came back - the consignment was returned. '
                else ' was delivered. ' end
        || trim(to_char(v_pending,'FM999999990.###'))
        || ' still pending and the approved quantity is used up - back to the credit check.',
      public.fms_dispatch_step_owner_ids('credit_check') || array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'dc_status', v_dc, 'round_no', v_round, 'pending_qty', v_pending)
    );

  else
    -- LOOP BACK. `current_step` matters as much as `status`: the alert builder
    -- keys its headline and its deep link off current_step, so leaving it on
    -- dispatch_confirm sends everyone to the wrong queue.
    update public.fms_dispatch_orders set
      round_no = round_no + 1,
      round_started_at = now(),
      status = 'awaiting_material_status', current_step = 'material_status'
    where id = p_order;

    -- Announced with the round number CAPTURED BEFORE the increment, or the
    -- email about round 1 arrives headed "Round 2".
    perform public.fms_dispatch_announce(
      'order', p_order,
      case when v_dc = 'returned' then 'dispatch_returned' else 'dispatched' end,
      'Round ' || v_round || ' of ' || coalesce(v_no,'an order')
        || case when v_dc = 'returned' then ' came back - the consignment was returned. '
                else ' was delivered. ' end
        || trim(to_char(v_pending,'FM999999990.###')) || ' still pending - back to the material-status check.',
      public.fms_dispatch_step_owner_ids('material_status') || array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'dc_status', v_dc, 'round_no', v_round, 'pending_qty', v_pending)
    );
  end if;
end $$;
grant execute on function public.fms_dispatch_record_dispatch_confirm(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 2. EDITING THE CONFIRMATION. Restated from 20260810120100 with one added
--    column, under the same presence-key contract as the pair beside it.
--
-- ⚠ THIS FUNCTION IS UNREACHABLE, AND THAT IS NOT NEW. record_dispatch_confirm
--   archives the round in the same transaction, and the archive nulls dc_at —
--   which is the one thing fms_dispatch_dc_editable tests for. So the guard
--   below always refuses. It is restated anyway so the column set stays
--   complete if the path is ever revived; nothing in the product may depend on
--   it running. Correcting a finished round is fms_dispatch_amend_round's job.
-- ===========================================================================
create or replace function public.fms_dispatch_update_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_path text;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('dispatch_confirm', p_order, v_uid) then raise exception 'Not authorized to edit the delivery confirmation'; end if;
  if not public.fms_dispatch_dc_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its delivery confirmation can no longer be changed.'; end if;
    raise exception 'This round is closed - open it from the order page to correct what was delivered.';
  end if;
  if p ? 'dc_status' and nullif(trim(p->>'dc_status'), '') is not null
     and nullif(trim(p->>'dc_status'), '') <> (select dc_status from public.fms_dispatch_orders where id = p_order) then
    raise exception 'The delivery outcome cannot be changed here - it drives the dispatched quantities. Use Correct this round on the order page.';
  end if;

  select case when p ? 'dc_attachment_path' then nullif(p->>'dc_attachment_path','') else o.dc_attachment_path end
    into v_path from public.fms_dispatch_orders o where o.id = p_order;
  if coalesce(trim(v_path), '') = '' then raise exception 'Attach the receiver copy or LR before saving'; end if;

  update public.fms_dispatch_orders set
    dc_actual_date      = coalesce(nullif(p->>'dc_actual_date','')::date, dc_actual_date),
    dc_attachment_path  = case when p ? 'dc_attachment_path' then nullif(p->>'dc_attachment_path','') else dc_attachment_path end,
    dc_attachment_name  = case when p ? 'dc_attachment_name' then nullif(p->>'dc_attachment_name','') else dc_attachment_name end,
    -- Same presence contract as the pair above, optional default like sb_eway_:
    -- the key OMITTED keeps the stored pages, [] or '' clears them, an array
    -- replaces them wholesale. Merging was rejected — the screen always holds
    -- the whole list, so a partial contract would only add a way to get it wrong.
    --
    -- ⚠ v_path, NOT the payload, is the primary passed to the normaliser. On an
    --   edit that also replaces page one, the path being stripped from the extra
    --   pages must be the NEW one.
    dc_attachment_pages = case when p ? 'dc_attachment_pages'
                               then public.fms_dispatch_doc_pages(p->'dc_attachment_pages', v_path)
                               else dc_attachment_pages end,
    dc_remarks          = nullif(trim(p->>'dc_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'dispatched_edited',
    format('Delivery confirmation on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_dispatch_confirm(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 3. THE ARCHIVE. Restated from 20260825120000; the extra pages join the dc_
--    block in the insert, the select AND the wipe.
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
  -- ⚠ gp_no, THE sb_eway_ PAIR AND dc_attachment_pages ARE ALL PRESENT, which is
  --   the opposite of the two fields above and easy to get wrong by proximity. A
  --   new round raises a NEW invoice and is delivered against NEW paperwork - one
  --   pass and one e-way bill per invoice is the whole rule, and carrying round
  --   one's stamped LR forward would attach it to round two's delivery.
  update public.fms_dispatch_orders set
    ms_actual_date = null, ms_tempo_no = null, ms_porter = null,
    ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_eway_path = null, sb_eway_name = null,
    sb_remarks = null, sb_at = null, sb_by = null,
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

-- ---------------------------------------------------------------- asserts --
--
-- Each lookup pins the identity arguments as well as the name. 20260825120000
-- only did that for archive_round; with a bare proname join, a future overload
-- makes `select ... into` pick an arbitrary row WITHOUT erroring, and the
-- assertion then silently checks a function nobody meant to check.
do $check$
declare v_src text;
begin
  -- ---------------------------------------------- record_dispatch_confirm --
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_record_dispatch_confirm'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p jsonb';
  if v_src not like '%dc_attachment_pages = v_pages%' then
    raise exception 'record_dispatch_confirm does not store the extra receiver pages'; end if;
  -- The extra pages must never become a SECOND thing that blocks a delivery.
  if v_src ~* 'Attach the (extra|additional|remaining)' then
    raise exception 'record_dispatch_confirm now demands extra pages - they are optional'; end if;
  -- Carried forward: the ONE required page, and the gate that enforces it.
  if v_src not like '%Attach the receiver copy or LR before saving%' then
    raise exception 'record_dispatch_confirm lost the required receiver-copy gate'; end if;
  -- Carried forward from 20260810120100: the round is archived and the delivered
  -- quantities are recomputed.
  if v_src not like '%fms_dispatch_archive_round%'
     or v_src not like '%fms_dispatch_recalc_dispatched%' then
    raise exception 'record_dispatch_confirm no longer archives or recalculates the round'; end if;
  -- Carried forward from 20260818120000: a used-up ceiling routes BACK to credit,
  -- and the cumulative approved quantity survives the loop.
  if v_src not like '%v_headroom%' or v_src not like '%awaiting_credit_check%' then
    raise exception 'record_dispatch_confirm lost the partial-credit routing'; end if;
  if v_src ~ 'cc_approved_qty\s*=\s*null' then
    raise exception 'record_dispatch_confirm now clears the cumulative approved quantity'; end if;

  -- ---------------------------------------------- update_dispatch_confirm --
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_update_dispatch_confirm'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p jsonb';
  if v_src not like '%p ? ''dc_attachment_pages''%' then
    raise exception 'update_dispatch_confirm does not presence-check the extra pages'; end if;
  -- Carried forward from 20260810120100: the "is it attached?" test asks the ROW,
  -- not the payload - testing the payload fails every remarks-only edit.
  if v_src not like '%else o.dc_attachment_path end%' then
    raise exception 'update_dispatch_confirm tests the payload for the attachment, not the row'; end if;
  -- Carried forward: this NEVER touches quantities or the archive.
  if v_src ~ 'fms_dispatch_archive_round|fms_dispatch_recalc_dispatched|ship_qty' then
    raise exception 'update_dispatch_confirm now moves quantities - that is amend_round''s job'; end if;
  if v_src not like '%The delivery outcome cannot be changed here%' then
    raise exception 'update_dispatch_confirm can now flip the outcome without recalculating'; end if;

  -- ------------------------------------------------------- archive_round ---
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_reason text';
  if v_src not like '%o.dc_attachment_pages%' then
    raise exception 'archive_round does not archive the extra receiver pages'; end if;
  if v_src not like '%dc_attachment_pages = null%' then
    raise exception 'archive_round carries the extra pages into the next round'; end if;
  -- Carried forward from 20260825120000.
  if v_src not like '%o.sb_eway_path, o.sb_eway_name%' then
    raise exception 'archive_round does not archive the e-way bill'; end if;
  if v_src not like '%sb_eway_path = null%' then
    raise exception 'archive_round carries the e-way bill into the next round'; end if;
  -- Carried forward from 20260819120000 / 20260825120000: the site and the
  -- company survive a round; the gate pass does not.
  if v_src like '%location_id = null%' then
    raise exception 'archive_round wipes location_id'; end if;
  if v_src like '%company_id = null%' then
    raise exception 'archive_round wipes company_id'; end if;
  if v_src not like '%gp_no = null%' then
    raise exception 'archive_round lost the gate pass wipe'; end if;

  -- ------------------------------------- what we did NOT have to change ----
  -- The extra pages go in the SAME `receiver` folder, so the upload rule is
  -- already correct. Asserted rather than assumed: if that arm is ever renamed,
  -- a dispatch-confirm owner silently loses the ability to attach anything and
  -- the failure lands at the Storage layer as a raw policy violation.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_can_add_doc'
     and pg_get_function_identity_arguments(p.oid) = 'p_name text, p_uid uuid';
  if v_src not like '%''receiver''%' then
    raise exception 'fms_dispatch_can_add_doc lost the receiver folder - no page can be uploaded'; end if;
  -- 20260827120000 repaired these two on the way past; keep them repaired.
  if v_src not like '%''eway''%' or v_src not like '%''sales_return''%' then
    raise exception 'fms_dispatch_can_add_doc is missing the eway or sales_return folder'; end if;

  -- ---------------------------------------------------------- the CHECKs ---
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.fms_dispatch_orders'::regclass
                    and conname = 'fms_dispatch_orders_dc_pages_is_array') then
    raise exception 'the dc_attachment_pages array CHECK is missing on the order'; end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.fms_dispatch_rounds'::regclass
                    and conname = 'fms_dispatch_rounds_dc_pages_is_array') then
    raise exception 'the dc_attachment_pages array CHECK is missing on the round archive'; end if;

  -- ------------------------------------------------------- the normaliser --
  -- The three behaviours the two RPCs above depend on, checked directly rather
  -- than by reading the source: empty forms collapse to NULL, and the primary
  -- never appears among the extra pages.
  if public.fms_dispatch_doc_pages('[]'::jsonb, 'a/b/c') is not null then
    raise exception 'fms_dispatch_doc_pages does not collapse an empty array to NULL'; end if;
  if public.fms_dispatch_doc_pages('[{"path":"a/b/c","name":"one"}]'::jsonb, 'a/b/c') is not null then
    raise exception 'fms_dispatch_doc_pages does not strip the primary page'; end if;
  if jsonb_array_length(
       public.fms_dispatch_doc_pages('[{"path":"a/b/c"},{"path":"d/e/f"}]'::jsonb, 'a/b/c')) <> 1 then
    raise exception 'fms_dispatch_doc_pages did not keep exactly the non-primary pages'; end if;
end $check$;

commit;
