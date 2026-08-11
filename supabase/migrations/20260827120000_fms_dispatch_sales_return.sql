-- ===========================================================================
-- Order to Dispatch — cancellation by the raiser, and the SALES RETURN step.
--
-- WHAT CHANGES
--   1. The person who RAISED an order can cancel it. Until now only a
--      coordinator could.
--
--      ⚠ UP TO THE GATE, AND NOT PAST IT. Once `go_at` is stamped the material
--        has physically left the plant, and cancelling then would leave goods
--        on a vehicle with no delivery record and nothing owed against them.
--        The remedy there is to confirm the delivery — or record it as
--        Returned — and cancel the balance afterwards.
--
--   2. Cancelling an order whose SALES BILL IS ALREADY RAISED no longer just
--      deletes it. The order moves to a new status, `awaiting_sales_return`,
--      and the work of unwinding the invoice in Tally becomes a real, owned,
--      visible step — `sales_return` — with its own owner set, its own queue
--      and its own notification. The order is cancelled only once that step is
--      recorded.
--
--   3. The Sales Return step offers exactly two outcomes:
--        'invoice_cancelled' — the bill was cancelled outright in Tally
--        'sales_return'      — a sales return / credit note was raised against
--                              it; its number and document are mandatory
--      THERE IS NO 24-HOUR RULE ANYWHERE IN HERE, AND THAT IS DELIBERATE.
--      Which outcome applies is a judgement made against Tally and GST outside
--      this system. The app records what was done; it never derives it, never
--      times it, and never shows a deadline.
--
-- ⚠ THE ARCHIVE IS DEFERRED, AND THAT IS THE LOAD-BEARING DECISION.
--   `fms_dispatch_archive_round` NULLs sb_invoice_no / sb_at / sb_actual_date /
--   sb_eway_* / gp_no off the order header. If cancel archived the round at
--   REQUEST time, the Sales Return step would open on a row with no invoice
--   number, and `fms_dispatch_resume_status` — which reads timestamps, not
--   status — could no longer tell withdraw where to put the order back. So the
--   archive happens in `record_sales_return`, at the END of the flow.
--
-- ⚠ DEPLOY THE FRONTEND BEFORE APPLYING THIS. `dispatchFetch` reads with
--   select("*") and defaults every new field, so an un-migrated database loads
--   fine — but the reverse does not hold. Applied ahead of the frontend, this
--   file lets an order reach `awaiting_sales_return`, a status the old bundle
--   has never heard of: blank status pill, gone from every queue, no screen to
--   action it. That happened once already, on 2026-08-11, and had to be undone.
--
-- ADDITIVE ONLY: new nullable columns, two widened CHECKs (drop-and-re-add by
-- their exact generated names, the pattern 20260810120000:66-68 documents), and
-- re-stated function bodies. Nothing is dropped except one stale overload that
-- should never have survived (see section 4). Safe to re-run.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. The new status.
-- ---------------------------------------------------------------------------
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_status_check;
alter table public.fms_dispatch_orders
  add constraint fms_dispatch_orders_status_check check (status in (
    'awaiting_credit_check','awaiting_material_status',
    'awaiting_sales_bill','awaiting_gate_out','awaiting_dispatch_confirm',
    'awaiting_sales_return',
    'closed','on_hold','cancelled'));

-- `current_step` has no CHECK (20260801120100:77), so 'sales_return' needs no DDL.

-- ---------------------------------------------------------------------------
-- 2. The sales-return block.
--
-- Columns, not a table: there is at most ONE per order, structurally. Cancel is
-- terminal, and only the LIVE round can hold an unsettled invoice — every
-- earlier round was archived by record_dispatch_confirm, which means delivered.
-- ---------------------------------------------------------------------------
alter table public.fms_dispatch_orders
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_requested_by uuid references auth.users on delete set null,
  add column if not exists sr_round_no         integer,
  add column if not exists sr_invoice_no       text,
  add column if not exists sr_invoice_at       timestamptz,
  add column if not exists sr_invoice_date     date,
  add column if not exists sr_eway_expected    boolean,
  add column if not exists sr_mode             text,
  add column if not exists sr_reference_no     text,
  add column if not exists sr_actual_date      date,
  add column if not exists sr_remarks          text,
  add column if not exists sr_attachment_path  text,
  add column if not exists sr_attachment_name  text,
  add column if not exists sr_at               timestamptz,
  add column if not exists sr_by               uuid references auth.users on delete set null,
  add column if not exists sr_edited_at        timestamptz,
  add column if not exists sr_edited_by        uuid references auth.users on delete set null;

comment on column public.fms_dispatch_orders.sr_invoice_no is
  'Snapshot of the invoice being unwound, taken at cancel-request time. ORDER-scoped and TERMINAL: fms_dispatch_archive_round must NEVER wipe the sr_ block, because the archive runs AFTER the return is recorded and this is the only surviving record of which invoice it was. Asserted at the end of 20260827120000.';
comment on column public.fms_dispatch_orders.sr_round_no is
  'Which round''s invoice is being unwound — the pointer used to reach that round''s invoice PDF, e-way PDF and gate pass in fms_dispatch_rounds.';
comment on column public.fms_dispatch_orders.sr_mode is
  'invoice_cancelled = the bill was cancelled outright in Tally. sales_return = a sales return / credit note was raised against it. Chosen by the Sales Return owner. NOT derived, and NOT time-based — there is deliberately no 24-hour rule in this system.';
comment on column public.fms_dispatch_orders.sr_eway_expected is
  'This consignment carried an e-way bill, so it needs cancelling on the portal too. A REMINDER, not a state: we hold the e-way PDF but neither its number nor its generation time, so there is nothing here to track against.';

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.fms_dispatch_orders'::regclass
                    and conname  = 'fms_dispatch_orders_sr_mode_check') then
    alter table public.fms_dispatch_orders
      add constraint fms_dispatch_orders_sr_mode_check
      check (sr_mode is null or sr_mode in ('invoice_cancelled','sales_return'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Coordinator ids.
--
-- `fms_dispatch_is_coordinator(uuid)` answers yes/no and folds admins in; there
-- has never been a way to ENUMERATE them, which the announces below need.
--
-- ⚠ This does NOT include admins. Admins are implicit in the boolean and not
--   enumerable from config, and they do not need every cancellation in their
--   bell. Coordinators are the people who chase this.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_coordinator_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select array_agg(distinct x::uuid)
      from public.fms_dispatch_config c,
           lateral jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb)) x
     where c.key = 'process_coordinators'
       and x ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ), '{}'::uuid[]);
$$;
grant execute on function public.fms_dispatch_coordinator_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A stale overload that has been shadowing location scoping since August.
--
-- 20260820120000 replaced fms_dispatch_is_step_owner(text,uuid) with a
-- three-argument, LOCATION-AWARE version — but never dropped the two-argument
-- one from 20260801120000:196. Both still exist, and PostgreSQL resolves an
-- exact-arity call first, so every surviving 2-arg call silently runs the OLD,
-- LOCATION-BLIND body. Drop it; the 3rd argument defaults to null anyway, so
-- every call site keeps working and starts honouring location.
--
-- Verified on the live database before dropping: nothing depends on it and no
-- function body calls the 2-arg form.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_dispatch_is_step_owner(text, uuid);

-- ===========================================================================
-- 5. CANCEL — now a three-way branch.
-- ===========================================================================
create or replace function public.fms_dispatch_cancel_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status text; v_no text; v_raiser uuid; v_step text; v_round integer;
  v_live boolean; v_inv text; v_inv_at timestamptz; v_inv_date date; v_eway boolean;
  v_gone timestamptz;
begin
  -- ⚠ ONE SELECT, AND IT READS THE sb_ BLOCK. Everything the Sales Return step
  --   needs must be in a local BEFORE fms_dispatch_archive_round can wipe it.
  select status, order_no, raised_by, current_step, round_no,
         ms_at is not null,
         sb_invoice_no, sb_at, sb_actual_date, sb_eway_path is not null,
         go_at
    into v_status, v_no, v_raiser, v_step, v_round,
         v_live, v_inv, v_inv_at, v_inv_date, v_eway,
         v_gone
    from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;

  -- The RAISER may cancel, not just a coordinator — that is the point of this
  -- change. Step owners are deliberately NOT included: owning gate-out is
  -- authority over a step, not over whether the order should exist at all.
  if not (public.fms_dispatch_is_coordinator(v_uid) or v_raiser = v_uid) then
    raise exception 'Only the person who raised this order, a coordinator or an admin can cancel it';
  end if;

  if v_status = 'closed' then
    raise exception 'This order is already closed - correct the round instead';
  end if;

  -- ⚠ THE GATE IS THE POINT OF NO RETURN, and this is the boundary the whole
  --   feature stops at. Up to and including `awaiting_gate_out` the consignment
  --   is still in the plant, so withdrawing it is a paperwork problem — which is
  --   exactly what the Sales Return step below solves. Once `go_at` is stamped
  --   the material has physically left on a vehicle, and cancelling would leave
  --   goods outside with no delivery record and nothing owed against them.
  --
  --   Read off `go_at` rather than the status on purpose: a held order sitting
  --   at `on_hold` keeps its timestamps, so a status test would let a cancel
  --   through on a consignment that had already gone out.
  --
  --   The route back is the honest one — confirm the delivery (or record it as
  --   Returned so the goods come back), which archives the round, then cancel
  --   whatever balance is left.
  if v_gone is not null then
    raise exception 'This consignment has already left the gate - confirm the delivery or record a return first, then cancel the balance';
  end if;

  -- Idempotent, and a second cancel must NOT jump the queue: an order already
  -- awaiting its sales return is mid-cancellation, not un-cancelled.
  if v_status in ('cancelled','awaiting_sales_return') then return; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A cancellation reason is required'; end if;

  -- ---- (a) An invoice exists: hand it to the Sales Return step. ------------
  if v_inv_at is not null then
    -- ⚠ NO ARCHIVE HERE. See the header. record_sales_return does it.
    update public.fms_dispatch_orders set
      status = 'awaiting_sales_return', current_step = 'sales_return',
      cancel_requested_at = now(), cancel_requested_by = v_uid,
      cancel_reason = trim(p_reason),
      sr_round_no      = v_round,
      sr_invoice_no    = v_inv,
      sr_invoice_at    = v_inv_at,
      sr_invoice_date  = v_inv_date,
      sr_eway_expected = v_eway
    where id = p_order;

    perform public.fms_dispatch_announce('order', p_order, 'cancel_requested',
      'Order ' || coalesce(v_no,'') || ' was cancelled after sales bill ' || coalesce(v_inv,'') ||
      ' was raised - cancel the bill in Tally, or punch a sales return against it.'
      || case when v_eway then ' This consignment carried an e-way bill - cancel it on the portal too.' else '' end,
      -- The step's OWN owners. Coordinators are copied unconditionally so that
      -- an unassigned step can never swallow the request; announce de-dupes and
      -- drops anyone who cannot see the order.
      public.fms_dispatch_step_owner_ids('sales_return')
        || public.fms_dispatch_coordinator_ids(),
      jsonb_build_object('order_no', v_no, 'invoice_no', v_inv,
                         'round_no', v_round, 'reason', trim(p_reason)));
    return;
  end if;

  -- ---- (b) No invoice: cancel outright, exactly as before. -----------------
  -- The ms_at guard is unchanged and still required: a part-recorded round must
  -- not survive on the header of a cancelled order, or it keeps appearing —
  -- and stays editable — in the step queues.
  if v_live then
    perform public.fms_dispatch_archive_round(p_order, 'cancelled');
    perform public.fms_dispatch_recalc_dispatched(p_order);
  end if;

  update public.fms_dispatch_orders
     set status = 'cancelled', cancelled_at = now(),
         cancel_requested_at = now(), cancel_requested_by = v_uid,
         cancel_reason = trim(p_reason)
   where id = p_order;

  -- Widened from "the raiser" to "the raiser, the coordinators and whoever had
  -- it in their queue": the raiser is now usually the ACTOR, and the person who
  -- was about to action the step deserves to learn why it vanished.
  perform public.fms_dispatch_announce('order', p_order, 'cancelled',
    'Order ' || coalesce(v_no,'') || ' cancelled.',
    array_remove(array[v_raiser], null)
      || public.fms_dispatch_coordinator_ids()
      || public.fms_dispatch_step_owner_ids(v_step),
    jsonb_build_object('order_no', v_no, 'reason', trim(p_reason)));
end $$;
grant execute on function public.fms_dispatch_cancel_order(uuid, text) to authenticated;

-- ===========================================================================
-- 6. RECORD THE SALES RETURN — the step that finally cancels the order.
-- ===========================================================================
create or replace function public.fms_dispatch_record_sales_return(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status text; v_no text; v_raiser uuid; v_live boolean; v_inv text;
  v_mode text := nullif(trim(p->>'sr_mode'), '');
  v_ref  text := nullif(trim(p->>'sr_reference_no'), '');
  v_path text := nullif(trim(p->>'sr_attachment_path'), '');
begin
  select status, order_no, raised_by, ms_at is not null, sr_invoice_no
    into v_status, v_no, v_raiser, v_live, v_inv
    from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_return' then
    raise exception 'This order is not waiting on a sales return';
  end if;
  -- The EXISTING generic predicate: admin, coordinator, or an owner of the
  -- sales_return step at this order's location.
  if not public.fms_dispatch_can_act('sales_return', p_order, v_uid) then
    raise exception 'Only an owner of the Sales Return step can record this';
  end if;

  if v_mode is null or v_mode not in ('invoice_cancelled','sales_return') then
    raise exception 'Choose whether the invoice was cancelled or a sales return was raised';
  end if;
  if v_mode = 'sales_return' and v_ref is null then
    raise exception 'Enter the sales return / credit note number';
  end if;
  if v_mode = 'sales_return' and v_path is null then
    raise exception 'Attach the sales return / credit note';
  end if;

  update public.fms_dispatch_orders set
    sr_mode            = v_mode,
    sr_reference_no    = v_ref,
    sr_actual_date     = coalesce(nullif(p->>'sr_actual_date','')::date, current_date),
    sr_remarks         = nullif(trim(p->>'sr_remarks'), ''),
    sr_attachment_path = v_path,
    sr_attachment_name = nullif(trim(p->>'sr_attachment_name'), ''),
    sr_at              = coalesce(sr_at, now()),
    sr_by              = coalesce(sr_by, v_uid)
  where id = p_order;

  -- NOW the round can be archived — the invoice details are already snapshotted
  -- into the sr_ block, which archive_round does not touch.
  if v_live then
    perform public.fms_dispatch_archive_round(p_order, 'cancelled');
    perform public.fms_dispatch_recalc_dispatched(p_order);
  end if;

  update public.fms_dispatch_orders
     set status = 'cancelled', cancelled_at = now()
   where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'cancelled',
    'Sales bill ' || coalesce(v_inv,'') || ' on order ' || coalesce(v_no,'') || ' was '
    || case when v_mode = 'sales_return'
            then 'reversed with sales return ' || coalesce(v_ref,'') || '.'
            else 'cancelled in Tally.' end,
    array_remove(array[v_raiser], null) || public.fms_dispatch_coordinator_ids(),
    jsonb_build_object('order_no', v_no, 'invoice_no', v_inv,
                       'sr_mode', v_mode, 'reference_no', v_ref));
end $$;
grant execute on function public.fms_dispatch_record_sales_return(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 7. CORRECT A RECORDED SALES RETURN.
--
-- ⚠ sr_mode is NOT re-derived here. The entry has already been made in Tally;
--   a correction to the remarks two days later must not silently reclassify a
--   real invoice cancellation as a sales return.
-- ===========================================================================
create or replace function public.fms_dispatch_update_sales_return(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_done timestamptz; v_no text; v_mode text; v_path text;
begin
  select sr_at, order_no, sr_mode into v_done, v_no, v_mode
    from public.fms_dispatch_orders where id = p_order for update;
  if v_no is null then raise exception 'Sales order not found'; end if;
  if v_done is null then raise exception 'No sales return has been recorded on this order yet'; end if;
  if not public.fms_dispatch_can_act('sales_return', p_order, v_uid) then
    raise exception 'Only an owner of the Sales Return step can edit this';
  end if;

  if p ? 'sr_reference_no' and v_mode = 'sales_return'
     and coalesce(trim(p->>'sr_reference_no'), '') = '' then
    raise exception 'Enter the sales return / credit note number';
  end if;

  -- The attachment presence contract, copied from update_sales_bill: an OMITTED
  -- key keeps the stored file, '' clears it. Probe what the row WOULD hold, so
  -- a required document cannot be cleared by an edit.
  select case when p ? 'sr_attachment_path' then nullif(p->>'sr_attachment_path','') else o.sr_attachment_path end
    into v_path from public.fms_dispatch_orders o where o.id = p_order;
  if v_mode = 'sales_return' and coalesce(trim(v_path), '') = '' then
    raise exception 'Attach the sales return / credit note before saving';
  end if;

  update public.fms_dispatch_orders set
    sr_reference_no    = coalesce(nullif(trim(p->>'sr_reference_no'), ''), sr_reference_no),
    sr_actual_date     = coalesce(nullif(p->>'sr_actual_date','')::date, sr_actual_date),
    sr_remarks         = nullif(trim(p->>'sr_remarks'), ''),
    sr_attachment_path = case when p ? 'sr_attachment_path' then nullif(p->>'sr_attachment_path','') else sr_attachment_path end,
    sr_attachment_name = case when p ? 'sr_attachment_name' then nullif(p->>'sr_attachment_name','') else sr_attachment_name end,
    sr_edited_at = now(), sr_edited_by = v_uid
  where id = p_order;

  -- ⚠ The type name MUST end in `edited`: announce gates email on
  --   `p_type not like '%edited'`, so corrections stay bell-only.
  perform public.fms_dispatch_announce('order', p_order, 'sales_return_edited',
    'The sales return recorded on order ' || coalesce(v_no,'') || ' was corrected.',
    '{}'::uuid[], jsonb_build_object('order_no', v_no));
end $$;
grant execute on function public.fms_dispatch_update_sales_return(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 8. WITHDRAW A CANCELLATION REQUEST.
--
-- Only possible while the Sales Return step is still outstanding — once it is
-- recorded the order is cancelled and there is no way back.
--
-- This works with no new logic ONLY because the round was never archived:
-- fms_dispatch_resume_status walks the step timestamps, so an order whose bill
-- was raised resolves to awaiting_gate_out. (It can never resolve past that:
-- cancelling is refused once go_at is stamped.)
-- ===========================================================================
create or replace function public.fms_dispatch_withdraw_cancel_request(p_order uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status text; v_no text; v_raiser uuid; v_next text; v_step text;
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_return' then
    raise exception 'This order has no cancellation request outstanding';
  end if;
  if not (public.fms_dispatch_is_coordinator(v_uid) or v_raiser = v_uid) then
    raise exception 'Only the person who raised this order, a coordinator or an admin can withdraw the cancellation';
  end if;

  v_next := public.fms_dispatch_resume_status(p_order);
  v_step := case v_next
              when 'awaiting_credit_check'     then 'credit_check'
              when 'awaiting_material_status'  then 'material_status'
              when 'awaiting_sales_bill'       then 'sales_bill'
              when 'awaiting_gate_out'         then 'gate_out'
              when 'awaiting_dispatch_confirm' then 'dispatch_confirm'
              else 'dispatch_confirm' end;

  update public.fms_dispatch_orders set
    status = v_next, current_step = v_step,
    cancel_requested_at = null, cancel_requested_by = null, cancel_reason = null,
    sr_round_no = null, sr_invoice_no = null, sr_invoice_at = null,
    sr_invoice_date = null, sr_eway_expected = null
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'cancel_withdrawn',
    'The cancellation of order ' || coalesce(v_no,'') || ' was withdrawn - no sales return is needed.'
    || case when coalesce(trim(p_reason),'') <> '' then ' ' || trim(p_reason) else '' end,
    public.fms_dispatch_step_owner_ids('sales_return')
      || public.fms_dispatch_coordinator_ids()
      || public.fms_dispatch_step_owner_ids(v_step),
    jsonb_build_object('order_no', v_no));
end $$;
grant execute on function public.fms_dispatch_withdraw_cancel_request(uuid, text) to authenticated;

-- ===========================================================================
-- 9. HOLD — must refuse an order that is mid-cancellation.
--
-- ⚠ THIS IS THE DANGEROUS ONE. Without the new guard, a coordinator could put
--   an `awaiting_sales_return` order on hold and then take it off again — and
--   fms_dispatch_resume_status, which reads TIMESTAMPS and not status, would
--   see sb_at set and return 'awaiting_gate_out'. The order would silently
--   un-cancel itself back into the gate queue with its invoice still live.
--
-- Carried verbatim from 20260810120100:1007-1044 with one refusal added.
-- ===========================================================================
create or replace function public.fms_dispatch_hold_order(p_order uuid, p_hold boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid(); v_next text; v_step text;
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then raise exception 'Only a coordinator or admin can hold or resume an order'; end if;
  if v_status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if v_status = 'awaiting_sales_return' then
    raise exception 'This order is waiting on its sales return - record or withdraw that first';
  end if;

  if p_hold then
    if v_status = 'on_hold' then return; end if;
    if v_status = 'closed' then raise exception 'This order is already closed'; end if;
    update public.fms_dispatch_orders
       set status = 'on_hold', hold_at = now(), hold_reason = nullif(trim(p_reason), '')
     where id = p_order;
    perform public.fms_dispatch_announce('order', p_order, 'held',
      'Order ' || coalesce(v_no,'') || ' put on hold.', array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'reason', nullif(trim(p_reason), '')));
  else
    if v_status <> 'on_hold' then return; end if;
    v_next := public.fms_dispatch_resume_status(p_order);
    v_step := case v_next
                when 'awaiting_credit_check'     then 'credit_check'
                when 'awaiting_material_status'  then 'material_status'
                when 'awaiting_sales_bill'       then 'sales_bill'
                when 'awaiting_gate_out'         then 'gate_out'
                when 'awaiting_dispatch_confirm' then 'dispatch_confirm'
                else 'dispatch_confirm' end;
    update public.fms_dispatch_orders
       set status = v_next, current_step = v_step, hold_at = null, hold_reason = null
     where id = p_order;
    perform public.fms_dispatch_announce('order', p_order, 'resumed',
      'Order ' || coalesce(v_no,'') || ' taken off hold.',
      public.fms_dispatch_step_owner_ids(v_step),
      jsonb_build_object('order_no', v_no));
  end if;
end $$;
grant execute on function public.fms_dispatch_hold_order(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- 10. CLOSE EARLY — must refuse an order that is mid-cancellation.
--
-- It already refuses today, but only by accident: resume_status returns
-- awaiting_gate_out for a billed order, which fails the between-rounds test and
-- reports "part-way through a dispatch". Correct outcome, wrong reason, and it
-- breaks the moment anything else moves.
--
-- Carried verbatim from 20260810120100:1054-1082 with one refusal added.
-- ===========================================================================
create or replace function public.fms_dispatch_close_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid(); v_resume text;
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then raise exception 'Only a coordinator or admin can close an order early'; end if;
  if v_status = 'closed' then raise exception 'This order is already closed'; end if;
  if v_status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if v_status = 'awaiting_sales_return' then
    raise exception 'This order is waiting on its sales return - record or withdraw that first';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to close an order early'; end if;

  v_resume := public.fms_dispatch_resume_status(p_order);
  if v_resume <> 'awaiting_material_status' then
    raise exception 'This order is part-way through a dispatch. Finish that round, or cancel the order instead.';
  end if;

  update public.fms_dispatch_orders set
    status = 'closed', current_step = 'dispatch_confirm',
    closed_at = coalesce(closed_at, now()),
    closed_reason = trim(p_reason), closed_by = v_uid,
    hold_at = null, hold_reason = null
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'closed_early',
    'Order ' || coalesce(v_no,'') || ' closed with a balance outstanding: ' || trim(p_reason),
    array_remove(array[v_raiser], null),
    jsonb_build_object('order_no', v_no, 'reason', trim(p_reason)));
end $$;
grant execute on function public.fms_dispatch_close_order(uuid, text) to authenticated;

-- ===========================================================================
-- 11. AMEND A ROUND — must refuse an order that is mid-cancellation.
--
-- It refuses a CANCELLED order already; an order awaiting its sales return is
-- cancelled in intent but not yet in status, and correcting a historic round
-- underneath it would move delivered quantities on an order being unwound.
--
-- Carried verbatim from 20260818120000:679-788 with one refusal added.
-- ===========================================================================
create or replace function public.fms_dispatch_amend_round(p_round uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order uuid; v_no text; v_round integer; v_raiser uuid; v_status text; v_old text;
  v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_reason text := nullif(trim(p->>'amend_reason'), '');
  l jsonb; v_pending numeric; v_bad text;
  v_allow numeric; v_headroom numeric; v_to_credit boolean;
begin
  select r.order_id, r.round_no, r.dc_status into v_order, v_round, v_old
    from public.fms_dispatch_rounds r where r.id = p_round for update;
  if v_order is null then raise exception 'That dispatch round was not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a coordinator or admin can correct a completed round';
  end if;
  if v_reason is null then raise exception 'A reason is required when correcting a round'; end if;

  select o.status, o.order_no, o.raised_by, o.cc_approved_qty
    into v_status, v_no, v_raiser, v_allow
    from public.fms_dispatch_orders o where o.id = v_order for update;
  if v_status = 'cancelled' then raise exception 'This order was cancelled - its rounds can no longer be corrected'; end if;
  if v_status = 'awaiting_sales_return' then
    raise exception 'This order is waiting on its sales return - record or withdraw that first';
  end if;
  if v_dc is not null and v_dc not in ('delivered','returned') then
    raise exception 'The outcome must be Delivered or Returned';
  end if;

  if p ? 'lines' and jsonb_typeof(p->'lines') = 'array' then
    for l in select * from jsonb_array_elements(p->'lines') loop
      if coalesce(trim(l->>'id'), '') = '' then continue; end if;
      if coalesce(nullif(l->>'ship_qty','')::numeric, 0) <= 0 then
        raise exception 'A corrected quantity must be greater than zero - remove the line instead';
      end if;
      update public.fms_dispatch_round_items
         set ship_qty = (l->>'ship_qty')::numeric,
             lot_no   = coalesce(nullif(trim(l->>'lot_no'), ''), lot_no)
       where id = (l->>'id')::uuid and round_id = p_round;
    end loop;
  end if;

  update public.fms_dispatch_rounds set
    dc_status    = coalesce(v_dc, dc_status),
    amended_at   = now(), amended_by = v_uid, amend_reason = v_reason
  where id = p_round;

  -- Catch an over-delivery BEFORE the recalculation trips the table CHECK and
  -- surfaces as a constraint name nobody can read.
  select string_agg(it.name, ', ') into v_bad
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
   where li.order_id = v_order
     and coalesce((select sum(ri.ship_qty) from public.fms_dispatch_round_items ri
                   join public.fms_dispatch_rounds r on r.id = ri.round_id
                  where ri.order_item_id = li.id and r.order_id = v_order and r.dc_status = 'delivered'), 0)
         > li.quantity;
  if v_bad is not null then
    raise exception 'That correction would deliver more than was ordered on: %', v_bad;
  end if;

  perform public.fms_dispatch_recalc_dispatched(v_order);

  -- A correction that leaves something owing must re-open a closed order,
  -- otherwise the balance has nowhere to go.
  select coalesce(sum(greatest(quantity - dispatched_qty, 0)), 0),
         case when v_allow is null then null else v_allow - coalesce(sum(dispatched_qty), 0) end
    into v_pending, v_headroom
    from public.fms_dispatch_order_items where order_id = v_order;

  v_to_credit := (v_headroom is not null and v_headroom <= 0);

  if v_status = 'closed' and v_pending > 0 then
    update public.fms_dispatch_orders set
      round_no = round_no + 1, round_started_at = now(),
      status       = case when v_to_credit then 'awaiting_credit_check' else 'awaiting_material_status' end,
      current_step = case when v_to_credit then 'credit_check'          else 'material_status'          end,
      -- The same reset as the dispatch-confirm loop, for the same reason: the
      -- balance is unapproved, so the decision must be made again. Only the
      -- cumulative ceiling survives.
      cc_status     = case when v_to_credit then null else cc_status     end,
      cc_remarks    = case when v_to_credit then null else cc_remarks    end,
      cc_round_no   = case when v_to_credit then null else cc_round_no   end,
      cc_at         = case when v_to_credit then null else cc_at         end,
      cc_by         = case when v_to_credit then null else cc_by         end,
      cc_decided_at = case when v_to_credit then null else cc_decided_at end,
      cc_decided_by = case when v_to_credit then null else cc_decided_by end,
      cc_edited_at  = case when v_to_credit then null else cc_edited_at  end,
      cc_edited_by  = case when v_to_credit then null else cc_edited_by  end,
      closed_at = null
    where id = v_order;
    update public.fms_dispatch_rounds set archived_reason = 'looped'
      where id = p_round and archived_reason = 'closed';
  end if;

  perform public.fms_dispatch_announce(
    'order', v_order, 'round_amended',
    'Round ' || v_round || ' of ' || coalesce(v_no,'an order') || ' was corrected'
      || case when v_dc is not null and v_dc is distinct from v_old
              then ' (' || v_old || ' -> ' || v_dc || ')' else '' end
      || ': ' || v_reason
      || case when v_status = 'closed' and v_pending > 0
              then ' The order has re-opened with ' || trim(to_char(v_pending,'FM999999990.###'))
                   || ' still pending'
                   || case when v_to_credit then ', awaiting a fresh credit decision.' else '.' end
              else '' end,
    case when v_status = 'closed' and v_pending > 0
         then public.fms_dispatch_step_owner_ids(case when v_to_credit then 'credit_check' else 'material_status' end)
              || array_remove(array[v_raiser], null)
         else array_remove(array[v_raiser], null) end,
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'reason', v_reason)
  );
end $$;
grant execute on function public.fms_dispatch_amend_round(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 12. DOCUMENT UPLOADS — the new folder, and a live bug fixed on the way past.
--
-- The CASE maps the storage path's third segment (the folder) to the step whose
-- owners may write there. It has known only 'invoice' and 'receiver' since
-- 20260821120000 — but 20260825120000 then added the e-way slot with folder
-- 'eway', which matches NEITHER arm. The CASE yields NULL, is_step_owner finds
-- no row, and the whole predicate is false: A SALES-BILL OWNER WHO IS NOT AN
-- ADMIN OR COORDINATOR CANNOT UPLOAD AN E-WAY BILL TODAY. The failure lands at
-- the Storage layer, before the RPC, as a raw policy violation.
--
-- Adding 'sales_return' without also fixing 'eway' would ship the identical bug
-- twice, so both arms go in together.
--
-- Carried verbatim from 20260821120000:114-137 with two arms added.
-- ===========================================================================
create or replace function public.fms_dispatch_can_add_doc(p_name text, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.fms_dispatch_orders o
     where o.id = public.fms_dispatch_doc_order(p_name)
       and (
             public.is_admin(p_uid)
          or public.fms_dispatch_is_coordinator(p_uid)
          or public.fms_dispatch_is_step_owner(
               case split_part(p_name, '/', 3)
                 when 'invoice'      then 'sales_bill'
                 when 'eway'         then 'sales_bill'
                 when 'sales_return' then 'sales_return'
                 when 'receiver'     then 'dispatch_confirm'
               end,
               p_uid,
               o.location_id)
       )
  );
$$;

-- ===========================================================================
-- 13. THE MAIL BODY — carried VERBATIM from 20260818120000:798-994.
--
-- ⚠ That file is the canonical source and says so. This copy was produced by
--   slicing it and inserting the four marked blocks below, not by retyping it.
--   Diff the two before replacing either again.
--
-- ⚠ ORDERING TRAP: the status ladder is evaluated top-down, and an order
--   awaiting its sales return would otherwise fall through to the generic
--   "ready for the next step" arm and mail the billing owner a cheerful note
--   about a step that does not exist. Its arm must sit ABOVE that else.
-- ===========================================================================
create or replace function public.fms_dispatch_email_payload(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b text := '/order-to-dispatch';
  r record;
  mr record;
  v_eyebrow text; v_headline text; v_action text; v_subject text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb; v_items jsonb;
  v_label text; v_name text;
  v_next_label text; v_next_queue text;
  v_round integer; v_held boolean; v_early boolean;
begin
  -- ---- master-data governance (unchanged) ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_dispatch_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := replace(coalesce(p_meta->>'master_type', mr.master_type), '_', ' ');
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Open master requests', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- the sales order ----
  select o.*, c.name as customer_name, co.name as company_name
    into r
    from public.fms_dispatch_orders o
    left join public.fms_dispatch_customers c on c.id = o.customer_id
    left join public.fms_dispatch_companies co on co.id = o.company_id
   where o.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  -- ⚠ The announcing RPC captures round_no BEFORE it increments and passes it in
  --   the meta, because by the time this runs the row already says round N+1.
  --   Reading r.round_no here would head round 1's email "Round 2".
  v_round := coalesce(nullif(p_meta->>'round_no','')::integer, r.round_no);
  v_held  := (r.cc_status = 'credit_hold' and r.cc_at is null);
  v_early := (r.status = 'closed' and r.closed_reason is not null);

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Order no.','value', r.order_no),
    jsonb_build_object('label','Customer','value', coalesce(r.customer_name,'-')),
    jsonb_build_object('label','Customer location','value', coalesce(r.customer_location,'-')),
    jsonb_build_object('label','Customer PO no.','value', coalesce(r.customer_po_no,'-')),
    jsonb_build_object('label','Company','value', coalesce(r.company_name,'-')),
    jsonb_build_object('label','Type','value', initcap(r.dispatch_type)),
    jsonb_build_object('label','Order date','value', to_char(r.order_date, 'DD-MM-YYYY')),
    jsonb_build_object('label','Round','value', v_round::text)
  );

  -- The credit ceiling, once credit has set one. Only on a PARTIAL: a full
  -- approval's ceiling is the whole order, and printing "70 of 70" in an email
  -- adds a number without adding a fact.
  if r.cc_status = 'partial' and r.cc_approved_qty is not null then
    v_rows := v_rows || jsonb_build_object('label','Credit approved',
      'value', trim(to_char(r.cc_approved_qty, 'FM999999990.###')));
  end if;

  -- The tempo and the porter answer belong to the round in progress, so they are
  -- appended only once the stock check has actually recorded them.
  if coalesce(btrim(r.ms_tempo_no), '') <> '' then
    v_rows := v_rows || jsonb_build_object('label','Tempo no.','value', r.ms_tempo_no);
  end if;
  if r.ms_porter is not null then
    v_rows := v_rows || jsonb_build_object('label','Porter','value', case when r.ms_porter then 'Yes' else 'No' end);
  end if;

  -- ---- INSERT 1 of 4: the invoice being unwound. --------------------------
  -- Snapshotted at cancel-request time, so it is still here after the round has
  -- been archived and the sb_ block wiped.
  if coalesce(btrim(r.sr_invoice_no), '') <> '' then
    v_rows := v_rows || jsonb_build_object('label','Invoice no.','value', r.sr_invoice_no);
  end if;
  if coalesce(r.sr_eway_expected, false) then
    v_rows := v_rows || jsonb_build_object('label','E-way bill','value','Yes - cancel it on the portal too');
  end if;
  if coalesce(btrim(r.sr_reference_no), '') <> '' then
    v_rows := v_rows || jsonb_build_object('label','Sales return no.','value', r.sr_reference_no);
  end if;
  -- ---- end INSERT 1 -------------------------------------------------------

  -- The consignment: what is going out on the round in progress. Once a round is
  -- archived its ship_qty is cleared, so this falls back to the ordered quantity
  -- — which is the right thing to show on an order that is between rounds.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(it.name, 'Item'),
           'qty', trim(to_char(coalesce(li.ship_qty, li.quantity), 'FM999999990.###')) ||
                  case when coalesce(li.unit,'') <> '' then ' ' || li.unit else '' end
         ) order by li.line_no), '[]'::jsonb)
    into v_items
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
   where li.order_id = r.id;

  v_next_label := case r.current_step
                    when 'credit_check'     then 'Credit Confirmation'
                    when 'material_status'  then 'Material Status Check'
                    when 'sales_bill'       then 'Sales Bill'
                    when 'gate_out'         then 'Gate Outward Entry'
                    when 'dispatch_confirm' then 'Dispatch Confirmation'
                    -- INSERT 2 of 4
                    when 'sales_return'     then 'Sales Return'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'credit_check'     then '/queues/credit-check'
                    when 'material_status'  then '/queues/material-status'
                    when 'sales_bill'       then '/queues/sales-bill'
                    when 'gate_out'         then '/queues/gate-out'
                    when 'dispatch_confirm' then '/queues/dispatch-confirm'
                    -- INSERT 2 of 4
                    when 'sales_return'     then '/queues/sales-return'
                    else '/orders/' || r.id::text end;

  v_eyebrow := case p_type
                 when 'raised'             then 'New sales order'
                 when 'credit_checked'     then 'Credit approved'
                 when 'credit_on_hold'     then 'Credit on hold'
                 when 'material_checked'   then 'Stock confirmed'
                 when 'material_pending'   then 'Nothing available yet'
                 when 'billed'             then 'Sales bill raised'
                 when 'gate_out'           then 'Out of the gate'
                 when 'dispatched'         then 'Delivered'
                 when 'dispatch_returned'  then 'Returned'
                 when 'round_amended'      then 'Round corrected'
                 when 'closed_early'       then 'Closed early'
                 when 'held'               then 'On hold'
                 when 'resumed'            then 'Resumed'
                 when 'cancelled'          then 'Cancelled'
                 -- INSERT 3 of 4
                 when 'cancel_requested'   then 'Sales bill to cancel'
                 when 'cancel_withdrawn'   then 'Cancellation withdrawn'
                 else 'Order update' end;

  if v_held then
    -- The order sits at awaiting_credit_check but is deliberately NOT due.
    v_headline  := 'Order ' || r.order_no || ' is on hold at credit';
    v_action    := 'put an order on hold at the credit check';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Credit hold - ' || r.order_no || ' (' || coalesce(r.customer_name,'customer') || ')';
  elsif v_early then
    v_headline  := 'Order ' || r.order_no || ' was closed with a balance outstanding';
    v_action    := 'closed an order early';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Closed early - ' || r.order_no;
  elsif r.status = 'closed' then
    v_headline  := 'Order ' || r.order_no || ' is closed';
    v_action    := 'confirmed the final delivery';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Delivered - ' || r.order_no || ' (' || coalesce(r.customer_name,'customer') || ')';
  elsif r.status in ('on_hold','cancelled') then
    v_headline  := 'Order ' || r.order_no || ' is ' || replace(r.status, '_', ' ');
    v_action    := replace(r.status, '_', ' ') || ' an order';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := initcap(replace(r.status, '_', ' ')) || ' - ' || r.order_no;
  -- ---- INSERT 4 of 4: the cancellation waiting on its sales return. -------
  -- ⚠ MUST sit above the generic else, and it does not collide with the
  --   on_hold/cancelled arm above because the status is neither.
  elsif r.status = 'awaiting_sales_return' then
    v_headline  := 'Sales bill ' || coalesce(r.sr_invoice_no,'') || ' must be cancelled';
    v_action    := 'cancelled an order after its sales bill was raised';
    v_cta_label := 'Open Sales Return';
    v_cta_path  := b || '/queues/sales-return';
    v_subject   := 'Cancel sales bill ' || coalesce(r.sr_invoice_no,'') || ' - ' || r.order_no ||
                   ' (' || coalesce(r.customer_name,'customer') || ')';
  -- ---- end INSERT 4 -------------------------------------------------------
  elsif p_type = 'dispatch_returned' then
    -- A returned round that looped: the order is back at the material check.
    v_headline  := 'Round ' || v_round || ' of ' || r.order_no || ' came back';
    v_action    := 'recorded a returned consignment';
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := 'Returned - ' || r.order_no || ' (round ' || v_round || ')';
  elsif p_type = 'material_pending' then
    v_headline  := r.order_no || ' has no stock available yet';
    v_action    := 'checked stock and found nothing available';
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := 'Awaiting stock - ' || r.order_no;
  else
    v_headline  := r.order_no || ' is ready for ' || v_next_label;
    v_action    := 'moved an order to ' || v_next_label;
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := v_next_label || ' due - ' || r.order_no ||
                   ' (' || coalesce(r.customer_name,'customer') || ')';
  end if;

  return jsonb_build_object(
    'subject',  v_subject,
    'eyebrow',  v_eyebrow,
    'headline', v_headline,
    'action',   v_action,
    'docLabel', 'Order ' || r.order_no,
    'rows',     v_rows,
    'items',    v_items,
    'ctaLabel', v_cta_label,
    'ctaPath',  v_cta_path
  )
  || case when coalesce(btrim(p_text),'') <> ''
          then jsonb_build_object('note', jsonb_build_object('label','Update','text', p_text))
          else '{}'::jsonb end;
end $$;
-- create-or-replace preserves privileges; re-granted anyway, as 20260810120300 does.
grant execute on function public.fms_dispatch_email_payload(text, uuid, text, text, jsonb) to authenticated;

-- ===========================================================================
-- 13b. Lock the new functions to signed-in users.
--
-- ⚠ `grant ... to authenticated` ALONE IS NOT ENOUGH, and REVOKING FROM `anon`
--   IS NOT THE FIX EITHER. Postgres grants EXECUTE on every new function to
--   PUBLIC, and `anon` inherits it from there — it holds no grant of its own, so
--   `revoke ... from anon` silently does nothing and the privilege survives.
--   Verified on this database: the ACL read `{=X/postgres,...}`, and that
--   leading `=X` with no grantee IS the PUBLIC grant.
--
--   The workflow RPCs would refuse an anonymous caller anyway (auth.uid() is
--   null, so every authz test fails), but `coordinator_ids()` would hand the
--   coordinator list to anyone holding the public anon key.
--
--   Revoking from PUBLIC leaves the explicit `authenticated` grants above
--   intact, so signed-in users are unaffected.
-- ===========================================================================
revoke all on function public.fms_dispatch_coordinator_ids()                   from public;
revoke all on function public.fms_dispatch_record_sales_return(uuid, jsonb)    from public;
revoke all on function public.fms_dispatch_update_sales_return(uuid, jsonb)    from public;
revoke all on function public.fms_dispatch_withdraw_cancel_request(uuid, text) from public;

-- ===========================================================================
-- 14. Assertions. Each one encodes a failure mode this design is built around.
-- ===========================================================================
do $check$
declare src text;
begin
  -- The whole point of the change.
  src := pg_get_functiondef('public.fms_dispatch_cancel_order(uuid,text)'::regprocedure);
  if position('v_raiser = v_uid' in src) = 0 then
    raise exception 'fms_dispatch_cancel_order no longer lets the raiser cancel their own order';
  end if;
  if position('awaiting_sales_return' in src) = 0 then
    raise exception 'fms_dispatch_cancel_order no longer routes a billed order to the sales-return step';
  end if;
  -- The gate boundary. Without it a consignment already on a vehicle can be
  -- cancelled, leaving goods outside with nothing owed against them.
  if position('go_at' in src) = 0 or position('already left the gate' in src) = 0 then
    raise exception 'fms_dispatch_cancel_order no longer refuses an order that has left the gate';
  end if;
  -- The invoice must be read into locals BEFORE anything can archive it away.
  --
  -- ⚠ Anchored on the CALL (`perform public.fms_dispatch_archive_round`), not on
  --   the bare function name: the warning comment above the SELECT names that
  --   function too, and matching the comment put the "archive" position at the
  --   top of the body and failed this check on a correct function.
  if position('sb_invoice_no, sb_at' in src) = 0
     or position('sb_invoice_no, sb_at' in src)
        > position('perform public.fms_dispatch_archive_round' in src) then
    raise exception 'fms_dispatch_cancel_order captures the invoice AFTER the archive has wiped it';
  end if;

  -- The sr_ block is terminal. If archive_round ever learns about it, the only
  -- record of which invoice was reversed is deleted at the moment of reversal.
  src := pg_get_functiondef('public.fms_dispatch_archive_round(uuid,text)'::regprocedure);
  if src ~ 'sr_' then
    raise exception 'fms_dispatch_archive_round now touches the sales-return block';
  end if;

  -- Deferring the archive is only correct if the sales-return step performs it.
  src := pg_get_functiondef('public.fms_dispatch_record_sales_return(uuid,jsonb)'::regprocedure);
  if position('fms_dispatch_archive_round' in src) = 0 then
    raise exception 'fms_dispatch_record_sales_return never archives the round - a cancelled order will still show a live consignment';
  end if;
  if position('fms_dispatch_can_act' in src) = 0 then
    raise exception 'fms_dispatch_record_sales_return does not check authorization';
  end if;

  -- A correction must never re-derive the outcome that was already punched.
  src := pg_get_functiondef('public.fms_dispatch_update_sales_return(uuid,jsonb)'::regprocedure);
  if src ~ 'sr_mode\s*=' then
    raise exception 'fms_dispatch_update_sales_return rewrites sr_mode - editing a correction would reclassify a real Tally entry';
  end if;

  -- The three routes that could silently un-cancel or mutate a pending order.
  src := pg_get_functiondef('public.fms_dispatch_hold_order(uuid,boolean,text)'::regprocedure);
  if position('awaiting_sales_return' in src) = 0 then
    raise exception 'fms_dispatch_hold_order can hold an order mid-cancellation - resuming it would send it back to the gate queue with a live invoice';
  end if;
  src := pg_get_functiondef('public.fms_dispatch_close_order(uuid,text)'::regprocedure);
  if position('awaiting_sales_return' in src) = 0 then
    raise exception 'fms_dispatch_close_order does not refuse an order mid-cancellation';
  end if;
  src := pg_get_functiondef('public.fms_dispatch_amend_round(uuid,jsonb)'::regprocedure);
  if position('awaiting_sales_return' in src) = 0 then
    raise exception 'fms_dispatch_amend_round can correct a round underneath an order mid-cancellation';
  end if;

  -- Uploads: the new folder, and the e-way arm this migration repairs.
  src := pg_get_functiondef('public.fms_dispatch_can_add_doc(text,uuid)'::regprocedure);
  if position('''eway''' in src) = 0 or position('''sales_return''' in src) = 0 then
    raise exception 'fms_dispatch_can_add_doc is missing the eway or sales_return folder - a step owner cannot attach the document';
  end if;

  -- The mail arm must be REACHABLE. The status ladder is evaluated top-down and
  -- ends in a generic "is ready for <next step>" else; an arm placed below that
  -- never fires, and the billing owner gets a cheerful note about a step that
  -- does not exist. Assert it precedes the else rather than merely existing.
  src := pg_get_functiondef('public.fms_dispatch_email_payload(text,uuid,text,text,jsonb)'::regprocedure);
  if position('cancel_requested' in src) = 0 or position('/queues/sales-return' in src) = 0 then
    raise exception 'fms_dispatch_email_payload has no sales-return arm';
  end if;
  if position('r.status = ''awaiting_sales_return''' in src) = 0
     or position('r.status = ''awaiting_sales_return''' in src) > position(' is ready for ' in src) then
    raise exception 'the sales-return mail arm sits below the generic else and will never be reached';
  end if;

  -- The stale location-blind overload must be gone.
  if to_regprocedure('public.fms_dispatch_is_step_owner(text,uuid)') is not null then
    raise exception 'the 2-argument fms_dispatch_is_step_owner still exists and will shadow location scoping';
  end if;

  -- The two widened CHECKs.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.fms_dispatch_orders'::regclass
                    and conname = 'fms_dispatch_orders_sr_mode_check') then
    raise exception 'the sr_mode CHECK is missing';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.fms_dispatch_orders'::regclass
                    and conname = 'fms_dispatch_orders_status_check'
                    and pg_get_constraintdef(oid) like '%awaiting_sales_return%') then
    raise exception 'the status CHECK does not accept awaiting_sales_return';
  end if;
end $check$;

commit;
