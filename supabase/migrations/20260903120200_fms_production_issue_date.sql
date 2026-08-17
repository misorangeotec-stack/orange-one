-- ===========================================================================
-- PRODUCTION ENTRY FMS — JOB DATE on the issue slip (back-dating).
--
-- Until now a job card's date was whatever moment it was keyed in: the intake
-- RPC stamps submitted_at = now() and the form never asked. That fails when a
-- job is entered AFTER THE FACT — the batch card was written on the floor days
-- ago and the system must record the date the job belongs to, not the day
-- someone got round to typing it.
--
-- New column `issue_date`: the business date, defaulting to today, settable to
-- any PAST date. Future dates are rejected. It applies to both card types.
--
-- ⚠ TWO DATES, TWO MEANINGS — do not collapse them (cf. fms_dispatch_orders,
--   which carries the same warning over order_date vs submitted_at):
--     submitted_at (timestamptz) — when it was keyed in. AUDIT. Drives the SLA
--                                  clock. Never user-editable.
--     issue_date   (date, NEW)   — the date the job belongs to. Shown, printed,
--                                  and drives the Lot/Batch number's month.
--   The SLA anchor deliberately stays on submitted_at, so back-filling old jobs
--   does NOT drop them into the queue already overdue.
--
-- ⚠ IST, NOT current_date. Postgres current_date is UTC, so between midnight and
--   05:30 IST it is still YESTERDAY — a job raised at 2am would default to
--   yesterday, and a user picking today would be rejected as "in the future".
--   Every date decision here uses (now() at time zone 'Asia/Kolkata')::date,
--   matching fms_asset_today_ist() and the purchase/import gate-outward RPCs.
--   This also fixes a latent bug: the Lot/Batch prefix was built from UTC
--   current_date, so a card raised before 05:30 IST on the 1st of a month
--   already got the PREVIOUS month's prefix.
--
-- ⚠ DATA SAFETY. No update, delete, drop, alter column or backfill. One NULLABLE
--   column with NO DEFAULT (a default would stamp every existing card with
--   today's date, falsely claiming they were all raised today) and two function
--   bodies replaced. Existing rows keep issue_date = null and fall back to
--   submitted_at everywhere they are displayed.
--
-- Reversal: restore the two function bodies from 20260903120100. The column can
-- be left in place harmlessly.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. issue_date — nullable, NO default. See the data-safety note above.
-- ---------------------------------------------------------------------------
alter table public.fms_production_requests add column if not exists issue_date date;

comment on column public.fms_production_requests.issue_date is
  'The date the job belongs to (the issue slip / job date), as entered by the '
  'raiser — defaults to today (IST) and may be back-dated, never post-dated. '
  'Drives the Lot/Batch number month and the printed slip date. NOT the audit '
  'timestamp: submitted_at is when the row was actually created, and it alone '
  'drives the SLA clock. Null on cards raised before this column existed; every '
  'display falls back to submitted_at for those.';

-- ---------------------------------------------------------------------------
-- 2. RAISE a job card. Based on 20260903120100. Changes, and ONLY these:
--      * v_today / v_issue resolved in IST, future date rejected
--      * v_fy now derived from v_issue (moved out of the declare block)
--      * the Lot/Batch prefix comes from v_issue, not current_date
--      * both inserts carry issue_date
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_no     text;
  v_seq    integer;
  v_bseq   integer;
  v_batch  text;
  -- ⚠ v_fy is no longer initialised here: it depends on v_issue, which is only
  --   known once the payload has been read.
  v_fy     text;
  v_uid    uuid  := auth.uid();
  v_name   text  := nullif(trim(p->>'requester_name'), '');
  v_lines  jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_first  jsonb;
  v_rm     text;
  v_qty    text;
  v_unit   text;
  v_type   text;
  v_pack   jsonb;
  v_fg     numeric;
  v_today  date;
  v_issue  date;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- Raise-Request authorization: open to all module users unless issue_slip has
  -- owners configured, in which case only they / admin / coordinator may raise.
  -- Identical for both card types — a repackaging slip is still an issue slip.
  if exists (
    select 1 from public.fms_production_step_owners
    where step_key = 'issue_slip' and coalesce(array_length(employee_ids, 1), 0) > 0
  ) and not public.fms_production_can_act('issue_slip', null, v_uid) then
    raise exception 'You are not authorized to raise a job card. Ask an admin to add you as an owner of the Raise Request step.';
  end if;

  v_type := lower(coalesce(nullif(trim(p->>'card_type'), ''), 'production'));
  if v_type not in ('production','repackaging') then
    raise exception 'Unknown card type %', v_type;
  end if;

  -- The job date. IST, never UTC — see the header. Shared by both card types.
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_issue := coalesce(nullif(trim(p->>'issue_date'), '')::date, v_today);
  if v_issue > v_today then
    raise exception 'The job date cannot be in the future.';
  end if;
  -- The financial year of the job, not of the moment it was typed.
  v_fy := public.fms_production_fy_code(v_issue);

  -- =======================================================================
  -- REPACKAGING. Returns early so the production path below stays untouched.
  -- =======================================================================
  if v_type = 'repackaging' then
    if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then
      raise exception 'Finished-good item is required';
    end if;

    v_fg := nullif(trim(p->>'fg_qty'), '')::numeric;
    if v_fg is null or v_fg <= 0 then
      raise exception 'Enter the quantity to repack';
    end if;

    -- Same helper the log book uses, so extra/total are computed identically.
    v_pack := coalesce(p->'pmh_bom_lines', '[]'::jsonb);
    if jsonb_typeof(v_pack) <> 'array' then raise exception 'pmh_bom_lines must be a JSON array'; end if;
    v_pack := public.fms_production_pack_lines(v_pack);
    if jsonb_array_length(v_pack) = 0 then
      raise exception 'At least one packaging item is required';
    end if;

    if v_name is null then
      v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
    end if;

    v_seq := public.fms_production_next_seq('PRD-' || v_fy);
    v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

    -- THE SAME counter as a production card — one unbroken series. The MONTH
    -- comes from the job date, so a back-dated job carries that month's prefix.
    v_bseq  := public.fms_production_next_batch_seq();
    v_batch := to_char(v_issue, 'YY') || to_char(v_issue, 'MM') || '-' || lpad(v_bseq::text, 4, '0');

    -- No wastage: packed = FG qty, and loss/scrap/lab are zero.
    insert into public.fms_production_requests (
      req_no, jobcard_no, card_type, issue_date, fg_item_id, fg_qty,
      bom_lines, issue_remarks, raised_by, requester_name,
      pe_expected_qty, ts_production_loss, scrap_qty, actual_qty, pe_lab_qty,
      ts_packed_qty, ts_loose_qty, pmh_qty, pmh_bom_lines,
      status, current_step, submitted_at
    ) values (
      v_no,
      v_batch,
      'repackaging',
      v_issue,
      (p->>'fg_item_id')::uuid,
      v_fg,
      '[]'::jsonb,
      nullif(trim(p->>'issue_remarks'), ''),
      v_uid, v_name,
      v_fg, 0, 0, v_fg, 0,
      v_fg, 0, v_fg, v_pack,
      'awaiting_pm_transfer', 'pm_transfer', now()
    )
    returning id into v_id;

    perform public.fms_production_announce(
      'request', v_id, 'raised',
      'Repackaging card ' || v_no || ' (' || v_batch || ') raised — ready for packing-material transfer.',
      public.fms_production_step_owner_ids('pm_transfer'),
      jsonb_build_object('req_no', v_no, 'card_type', 'repackaging')
    );

    return v_id;
  end if;

  -- =======================================================================
  -- PRODUCTION — unchanged from 20260903120100 except issue_date + the batch
  -- prefix now coming from v_issue.
  -- =======================================================================

  -- Normalise the BOM: must be an array; drop blank rows (no raw_material_id).
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'bom_lines must be a JSON array';
  end if;
  select coalesce(jsonb_agg(l), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';

  v_first := v_lines->0;  -- NULL when the BOM is empty

  v_rm   := coalesce(nullif(trim(v_first->>'raw_material_id'), ''), nullif(trim(p->>'raw_material_id'), ''));
  v_qty  := coalesce(nullif(v_first->>'required_qty', ''),          nullif(p->>'required_qty', ''));
  v_unit := coalesce(nullif(v_first->>'unit_id', ''),               nullif(p->>'unit_id', ''));

  if v_rm is null then raise exception 'At least one raw material is required'; end if;
  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then raise exception 'Finished-good item is required'; end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  -- Internal reference number (PRD-2627-0001).
  v_seq := public.fms_production_next_seq('PRD-' || v_fy);
  v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  -- Lot/Batch (Issue Slip) number: YYMM-NNNN, continuous NNNN. YYMM is the JOB's
  -- month, so a back-dated card belongs to the month it was actually made in.
  v_bseq  := public.fms_production_next_batch_seq();
  v_batch := to_char(v_issue, 'YY') || to_char(v_issue, 'MM') || '-' || lpad(v_bseq::text, 4, '0');

  insert into public.fms_production_requests (
    req_no, jobcard_no, issue_date, category_id, raw_material_id, required_qty, unit_id, fg_item_id, fg_qty,
    bom_lines, issue_remarks, raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no,
    v_batch,
    v_issue,
    nullif(p->>'category_id','')::uuid,
    v_rm::uuid,
    nullif(v_qty,'')::numeric,
    nullif(v_unit,'')::uuid,
    (p->>'fg_item_id')::uuid,
    nullif(p->>'fg_qty','')::numeric,
    v_lines,
    nullif(trim(p->>'issue_remarks'), ''),
    v_uid, v_name,
    'awaiting_material_handover', 'material_handover', now()
  )
  returning id into v_id;

  perform public.fms_production_announce(
    'request', v_id, 'raised',
    'Job card ' || v_no || ' (' || v_batch || ') raised — ready for material handover confirmation.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('req_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_production_submit_request(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. EDIT the issue slip. Based on 20260903120100; adds issue_date to both
--    branches with the same IST future-date guard.
--
--    ⚠ The Lot/Batch number is NOT re-derived. It is allocated once and may
--      already be written on a physical card, so jobcard_no stays in the
--      never-touched list. Correcting the date afterwards therefore leaves the
--      original month in the number — the form says so.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_update_request(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid  := auth.uid();
  v_raiser    uuid;
  v_status    text;
  v_no        text;
  v_type      text;
  v_lines     jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_first     jsonb;
  v_rm        text;
  v_qty       text;
  v_unit      text;
  v_pack      jsonb;
  v_fg        numeric;
  v_today     date;
  v_issue     date;
  v_cur_issue date;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select raised_by, status, req_no, coalesce(card_type,'production'), issue_date
    into v_raiser, v_status, v_no, v_type, v_cur_issue
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Issue slip not found'; end if;

  -- Authz: the raiser, an admin, or a process coordinator (mirrors the Cancel gate).
  if not (v_raiser = v_uid or public.is_admin(v_uid) or public.fms_production_is_coordinator(v_uid)) then
    raise exception 'Only the person who raised this issue slip, an admin or a coordinator can edit it';
  end if;

  -- Re-check state server-side. The hidden button is a courtesy, never the gate.
  if not public.fms_production_request_editable(p_req) then
    if v_status = 'on_hold'   then raise exception 'This issue slip is on hold — take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This issue slip was cancelled — it can no longer be edited.'; end if;
    if v_type = 'repackaging' then
      raise exception 'This repackaging slip can no longer be edited — the packing-material transfer has already been recorded.';
    end if;
    raise exception 'This issue slip can no longer be edited — material handover has already started.';
  end if;

  -- The job date. An ABSENT/blank key keeps whatever is stored (the established
  -- edit-path idiom), so an old card with a null date stays null rather than
  -- silently acquiring today's.
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_issue := coalesce(nullif(trim(p->>'issue_date'), '')::date, v_cur_issue);
  if v_issue is not null and v_issue > v_today then
    raise exception 'The job date cannot be in the future.';
  end if;

  -- =======================================================================
  -- REPACKAGING. Returns early so the production path below stays untouched.
  -- =======================================================================
  if v_type = 'repackaging' then
    if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then
      raise exception 'Finished-good item is required';
    end if;

    v_fg := nullif(trim(p->>'fg_qty'), '')::numeric;
    if v_fg is null or v_fg <= 0 then
      raise exception 'Enter the quantity to repack';
    end if;

    v_pack := coalesce(p->'pmh_bom_lines', '[]'::jsonb);
    if jsonb_typeof(v_pack) <> 'array' then raise exception 'pmh_bom_lines must be a JSON array'; end if;
    v_pack := public.fms_production_pack_lines(v_pack);
    if jsonb_array_length(v_pack) = 0 then
      raise exception 'At least one packaging item is required';
    end if;

    -- Re-assert the no-wastage identity so a corrected quantity carries through.
    update public.fms_production_requests
       set fg_item_id         = (p->>'fg_item_id')::uuid,
           issue_date         = v_issue,
           fg_qty             = v_fg,
           pe_expected_qty    = v_fg,
           ts_production_loss = 0,
           scrap_qty          = 0,
           actual_qty         = v_fg,
           pe_lab_qty         = 0,
           ts_packed_qty      = v_fg,
           ts_loose_qty       = 0,
           pmh_qty            = v_fg,
           pmh_bom_lines      = v_pack,
           issue_remarks      = nullif(trim(p->>'issue_remarks'), ''),
           edited_at          = now(),
           edited_by          = v_uid
     where id = p_req;

    perform public.fms_production_announce(
      'request', p_req, 'edited',
      'Repackaging slip ' || coalesce(v_no, '') || ' was edited — please re-check before the packing-material transfer.',
      public.fms_production_step_owner_ids('pm_transfer'),
      jsonb_build_object('edited', true)
    );
    return;
  end if;

  -- =======================================================================
  -- PRODUCTION — unchanged from 20260903120100 except issue_date.
  -- =======================================================================

  -- Normalise the BOM: must be an array; drop blank rows (no raw_material_id).
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'bom_lines must be a JSON array'; end if;
  select coalesce(jsonb_agg(l), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';

  v_first := v_lines->0;  -- NULL when the BOM is empty
  v_rm    := nullif(trim(v_first->>'raw_material_id'), '');
  v_qty   := nullif(v_first->>'required_qty', '');
  v_unit  := nullif(v_first->>'unit_id', '');

  if v_rm is null then raise exception 'At least one raw material is required'; end if;
  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then raise exception 'Finished-good item is required'; end if;

  update public.fms_production_requests
     set fg_item_id      = (p->>'fg_item_id')::uuid,
         issue_date      = v_issue,
         fg_qty          = nullif(p->>'fg_qty','')::numeric,
         bom_lines       = v_lines,
         raw_material_id = v_rm::uuid,                       -- legacy single-RM mirror
         required_qty    = nullif(v_qty,'')::numeric,
         unit_id         = nullif(v_unit,'')::uuid,
         issue_remarks   = nullif(trim(p->>'issue_remarks'), ''),
         edited_at       = now(),
         edited_by       = v_uid
   where id = p_req;

  -- In-transaction fan-out to the material-handover owners: the BOM they are
  -- about to hand over just changed.
  perform public.fms_production_announce(
    'request', p_req, 'edited',
    'Issue slip ' || coalesce(v_no, '') || ' was edited — please re-check before material handover.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('edited', true)
  );
end $$;
grant execute on function public.fms_production_update_request(uuid, jsonb) to authenticated;

comment on function public.fms_production_update_request(uuid, jsonb) is
  'Edit the issue slip (step 1), branching on card_type. Authz: raiser / admin / '
  'coordinator. Re-checks fms_production_request_editable server-side. Updates '
  'the job date (issue_date, never future, IST) plus the type-specific fields. '
  'Leaves jobcard_no, req_no, raised_by, submitted_at, status and current_step '
  'untouched — in particular the Lot/Batch number is NOT re-derived from a '
  'corrected date, because it may already be written on a physical card.';

commit;
