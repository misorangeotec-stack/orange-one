-- ===========================================================================
-- PRODUCTION ENTRY FMS — SAVE AN ISSUE SLIP AS A DRAFT.
--
-- A fourth tab on Generate Issue Slip. A half-filled slip can be parked and
-- picked up later instead of being held open in a browser tab or retyped.
--
-- A draft is a REAL ROW in fms_production_requests with status = 'draft'. That is
-- the same shape Customer Onboarding already uses, and it is what makes a draft
-- survive a closed laptop and be visible to the next person on shift.
--
-- ⚠ A DRAFT IS NOT WORK. 'draft' is deliberately absent from the status → step map
--   in lib/queues.ts, so a draft holds no queue, counts toward no SLA, appears in
--   no Control Center total and is never overdue. The store also keeps it out of
--   `requests`, so every existing list, report and dashboard stays correct without
--   being touched.
--
-- THE NUMBER IS RESERVED AT DRAFT TIME, on request. Saving a draft draws the PRD
-- reference and the Lot/Batch number immediately and keeps them through to submit,
-- so the number a person sees while drafting is the number the card is raised with.
--   ⚠ The cost of that choice: a DELETED draft leaves a permanent gap in both
--     series. Sequences are not returned — that is what makes them safe to hand
--     out concurrently — so a draft raised and abandoned burns its number for good.
--     This is the accepted trade for a stable, quotable number.
--   ⚠ A CONVERT draft is the exception: its Lot/Batch number is typed by the user,
--     so there is nothing to reserve. It stores whatever has been typed so far,
--     '' included, and the number is required and checked for uniqueness only when
--     the card is finally raised. The unique index skips blanks for this reason.
--
-- NOTHING IS VALIDATED ON SAVE. An empty draft is a legitimate draft; the rules
-- run at submit, in fms_production_submit_draft, which mirrors the checks
-- fms_production_submit_request makes: signed in, authorized, a job date that is
-- not in the future, an FG item, at least one raw material, and — on a convert
-- card — a typed Lot/Batch number that no other card is using.
--
--   ⚠ THE FG-QUANTITY MATCH IS NOT AMONG THEM, here or in submit_request. That
--     rule ("raw materials must total the FG quantity, on new cards only") lives
--     in the FORM, in useJobCardForm.ts, and nowhere else. Both intake RPCs accept
--     a short BOM. That is deliberate for now — the old cards that are legitimately
--     short are the reason the rule is new-cards-only, and a server-side check
--     would need the same carve-out — but do not read this file as proof the
--     database enforces it.
--
-- Additive: the 'draft' status value and three RPCs. Nothing existing is replaced.
--
-- Rollback: 20261115140001_fms_production_draft_slip_rollback.sql
-- ===========================================================================

alter table public.fms_production_requests drop constraint if exists fms_production_requests_status_check;
alter table public.fms_production_requests add constraint fms_production_requests_status_check
  check (status in (
    'draft',
    'awaiting_material_handover','awaiting_rm_transfer','awaiting_transfer_slip',
    'awaiting_production','awaiting_quality','awaiting_additional_issue_slip',
    'awaiting_mc_testing','awaiting_pm_handover','awaiting_pm_transfer',
    'awaiting_packing','awaiting_ready_to_dispatch','awaiting_fg_transfer',
    'closed','on_hold','cancelled'));

-- ---------------------------------------------------------------------------
-- 1. SAVE (create or update) a draft. No validation whatsoever.
--    p_req null  -> create, reserving the numbers.
--    p_req given -> update that draft in place, keeping its numbers.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_save_draft(p_req uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := p_req;
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p->>'requester_name'), '');
  v_type text;
  v_status text;
  v_no text; v_seq integer; v_bseq integer; v_batch text; v_fy text;
  v_today date; v_issue date;
  v_lines jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_pack  jsonb := coalesce(p->'pmh_bom_lines', '[]'::jsonb);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- Same gate as raising a card: drafting is the first half of raising.
  if exists (
    select 1 from public.fms_production_step_owners
    where step_key = 'issue_slip' and coalesce(array_length(employee_ids, 1), 0) > 0
  ) and not public.fms_production_can_act('issue_slip', null, v_uid) then
    raise exception 'You are not authorized to raise a job card. Ask an admin to add you as an owner of the Raise Request step.';
  end if;

  v_type := lower(coalesce(nullif(trim(p->>'card_type'), ''), 'production'));
  if v_type not in ('production','repackaging','convert') then
    raise exception 'Unknown card type %', v_type;
  end if;

  -- A draft may hold a date that is not yet sensible; only refuse the future,
  -- which is the one thing the user can see is wrong while typing.
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_issue := nullif(trim(p->>'issue_date'), '')::date;
  if v_issue is not null and v_issue > v_today then
    raise exception 'The job date cannot be in the future.';
  end if;

  if jsonb_typeof(v_lines) <> 'array' then raise exception 'bom_lines must be a JSON array'; end if;
  if jsonb_typeof(v_pack)  <> 'array' then raise exception 'pmh_bom_lines must be a JSON array'; end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  if v_id is null then
    -- ---- CREATE ----------------------------------------------------------
    v_fy  := public.fms_production_fy_code(coalesce(v_issue, v_today));
    v_seq := public.fms_production_next_seq('PRD-' || v_fy);
    v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

    if v_type = 'convert' then
      -- Typed by the user; nothing to reserve. '' until they fill it in.
      v_batch := coalesce(nullif(trim(p->>'jobcard_no'), ''), '');
    else
      v_bseq  := public.fms_production_next_batch_seq();
      v_batch := to_char(coalesce(v_issue, v_today), 'YY')
              || to_char(coalesce(v_issue, v_today), 'MM')
              || '-' || lpad(v_bseq::text, 4, '0');
    end if;

    insert into public.fms_production_requests (
      req_no, jobcard_no, card_type, issue_date, fg_item_id, fg_qty, fg_lot_no,
      category_id, raw_material_id, required_qty, unit_id,
      bom_lines, pmh_bom_lines, issue_remarks,
      raised_by, requester_name, status, current_step, submitted_at
    ) values (
      v_no, v_batch, v_type, v_issue,
      nullif(p->>'fg_item_id','')::uuid,
      nullif(trim(p->>'fg_qty'),'')::numeric,
      nullif(trim(p->>'fg_lot_no'), ''),
      nullif(p->>'category_id','')::uuid,
      nullif(p->>'raw_material_id','')::uuid,
      nullif(trim(p->>'required_qty'),'')::numeric,
      nullif(p->>'unit_id','')::uuid,
      v_lines, v_pack,
      nullif(trim(p->>'issue_remarks'), ''),
      v_uid, v_name, 'draft', 'issue_slip', now()
    )
    returning id into v_id;
  else
    -- ---- UPDATE ----------------------------------------------------------
    select status into v_status from public.fms_production_requests where id = v_id for update;
    if v_status is null then raise exception 'Draft not found'; end if;
    if v_status <> 'draft' then
      raise exception 'This job card has already been raised and can no longer be saved as a draft (status %).', v_status;
    end if;

    update public.fms_production_requests set
      card_type       = v_type,
      issue_date      = v_issue,
      fg_item_id      = nullif(p->>'fg_item_id','')::uuid,
      fg_qty          = nullif(trim(p->>'fg_qty'),'')::numeric,
      fg_lot_no       = nullif(trim(p->>'fg_lot_no'), ''),
      category_id     = nullif(p->>'category_id','')::uuid,
      raw_material_id = nullif(p->>'raw_material_id','')::uuid,
      required_qty    = nullif(trim(p->>'required_qty'),'')::numeric,
      unit_id         = nullif(p->>'unit_id','')::uuid,
      bom_lines       = v_lines,
      pmh_bom_lines   = v_pack,
      issue_remarks   = nullif(trim(p->>'issue_remarks'), ''),
      -- A convert draft's number is the user's to change until it is raised.
      jobcard_no      = case when v_type = 'convert'
                             then coalesce(nullif(trim(p->>'jobcard_no'), ''), '')
                             else jobcard_no end,
      edited_at = now(), edited_by = v_uid
    where id = v_id;
  end if;

  return v_id;
end
$fn$;
grant execute on function public.fms_production_save_draft(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. SUBMIT a draft — the validation fms_production_submit_request performs,
--    applied to a row that already exists. The reserved numbers are KEPT.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_submit_draft(p_req uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_status text; v_type text; v_no text; v_batch text;
  v_lines jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_pack  jsonb := coalesce(p->'pmh_bom_lines', '[]'::jsonb);
  v_first jsonb; v_rm text; v_qty text; v_unit text;
  v_fg numeric; v_lot text; v_today date; v_issue date;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- Save whatever is on the form first, so submit always validates what the user
  -- is looking at rather than the last thing that happened to be saved.
  perform public.fms_production_save_draft(p_req, p);

  select status, card_type, req_no, jobcard_no
    into v_status, v_type, v_no, v_batch
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Draft not found'; end if;
  if v_status <> 'draft' then raise exception 'This job card has already been raised (status %).', v_status; end if;

  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_issue := nullif(trim(p->>'issue_date'), '')::date;
  if v_issue is null then raise exception 'The job date is required.'; end if;
  if v_issue > v_today then raise exception 'The job date cannot be in the future.'; end if;

  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then
    raise exception 'Finished-good item is required';
  end if;

  -- ---- REPACKAGING ------------------------------------------------------
  if v_type = 'repackaging' then
    v_fg := nullif(trim(p->>'fg_qty'), '')::numeric;
    if v_fg is null or v_fg <= 0 then raise exception 'Enter the quantity to repack'; end if;

    v_lot := nullif(trim(p->>'fg_lot_no'), '');
    if v_lot is null then raise exception 'The FG item lot number is required on a repackaging slip'; end if;

    v_pack := public.fms_production_pack_lines(v_pack);
    if jsonb_array_length(v_pack) = 0 then raise exception 'At least one packaging item is required'; end if;

    update public.fms_production_requests set
      fg_qty = v_fg, fg_lot_no = v_lot, pmh_bom_lines = v_pack, bom_lines = '[]'::jsonb,
      pe_expected_qty = v_fg, ts_production_loss = 0, scrap_qty = 0, actual_qty = v_fg, pe_lab_qty = 0,
      ts_packed_qty = v_fg, ts_loose_qty = 0, pmh_qty = v_fg,
      status = 'awaiting_packing', current_step = 'packing_entry', submitted_at = now()
    where id = p_req;

    perform public.fms_production_announce('request', p_req, 'raised',
      'Repackaging card ' || v_no || ' (' || v_batch || ', FG lot ' || v_lot || ') raised — ready for the packing entry.',
      public.fms_production_step_owner_ids('packing_entry'),
      jsonb_build_object('req_no', v_no, 'card_type', 'repackaging'));
    return p_req;
  end if;

  -- ---- PRODUCTION and CONVERT -------------------------------------------
  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';

  v_first := v_lines->0;
  v_rm   := nullif(trim(v_first->>'raw_material_id'), '');
  v_qty  := nullif(v_first->>'required_qty', '');
  v_unit := nullif(v_first->>'unit_id', '');
  if v_rm is null then raise exception 'At least one raw material is required'; end if;

  if v_type = 'convert' then
    v_batch := nullif(trim(p->>'jobcard_no'), '');
    if v_batch is null then raise exception 'The Lot/Batch Card Number is required on a convert slip'; end if;
    if exists (
      select 1 from public.fms_production_requests
      where jobcard_no = v_batch and id <> p_req
    ) then
      raise exception 'Lot/Batch Card Number % is already in use on another job card.', v_batch;
    end if;
  end if;

  update public.fms_production_requests set
    jobcard_no      = v_batch,
    issue_date      = v_issue,
    fg_qty          = nullif(trim(p->>'fg_qty'),'')::numeric,
    raw_material_id = v_rm::uuid,
    required_qty    = nullif(v_qty,'')::numeric,
    unit_id         = nullif(v_unit,'')::uuid,
    bom_lines       = v_lines,
    status = 'awaiting_material_handover', current_step = 'material_handover', submitted_at = now()
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'raised',
    (case when v_type = 'convert' then 'Convert card ' else 'Job card ' end)
      || v_no || ' (' || v_batch || ') raised — ready for material handover confirmation.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('req_no', v_no, 'card_type', v_type));

  return p_req;
end
$fn$;
grant execute on function public.fms_production_submit_draft(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. DELETE a draft. Only ever a draft — a raised card is cancelled, not deleted,
--    because its history is a record of work that happened.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_delete_draft(p_req uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_status text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- ⚠ THE SAME GATE fms_production_save_draft APPLIES. Without it this function
  --   checked only that you were signed in, so ANY staff member could delete
  --   ANY draft: the select policy on this table is staff-wide, so every draft
  --   is visible to everyone, and deleting one is not recoverable — the row goes,
  --   and its reserved PRD and Lot/Batch numbers are burned for good. Writing a
  --   draft was gated and destroying one was not.
  if exists (
    select 1 from public.fms_production_step_owners
    where step_key = 'issue_slip' and coalesce(array_length(employee_ids, 1), 0) > 0
  ) and not public.fms_production_can_act('issue_slip', null, v_uid) then
    raise exception 'You are not authorized to delete a draft issue slip. Ask an admin to add you as an owner of the Raise Request step.';
  end if;

  select status, raised_by into v_status, v_raiser
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Draft not found'; end if;
  if v_status <> 'draft' then
    raise exception 'This job card has been raised and cannot be deleted — cancel it instead (status %).', v_status;
  end if;

  -- Your own draft, or an admin / process coordinator clearing up. A second person
  -- on the same step can continue a colleague's draft, which is the point of it
  -- being a row rather than a browser tab — but discarding their half-typed work
  -- is not the same act as picking it up.
  if v_raiser is distinct from v_uid
     and not public.is_admin(v_uid)
     and not public.fms_production_is_coordinator(v_uid) then
    raise exception 'This draft was saved by someone else. Only its author, an admin or the process coordinator can delete it.';
  end if;

  delete from public.fms_production_requests where id = p_req;
end
$fn$;
grant execute on function public.fms_production_delete_draft(uuid) to authenticated;
