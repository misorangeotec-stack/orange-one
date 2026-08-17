-- ===========================================================================
-- PRODUCTION ENTRY FMS — REPACKAGING card type.
--
-- Some finished goods are TRADED, not manufactured: imported ready-made,
-- repacked, sold. For those lots the first six steps (material handover, RM
-- transfer, quality checking, log book entry, production entry, M/C testing)
-- have nothing to record.
--
-- A card now carries a `card_type`:
--   * 'production'  — unchanged in every respect. Raised into material handover.
--   * 'repackaging' — FG item + ONE quantity + the packaging material. No BOM,
--                     no raw materials, no wastage. Raised straight into
--                     PACKING MATERIAL TRANSFER (awaiting_pm_transfer).
--
-- The Lot/Batch number comes from the SAME continuous counter for both types —
-- fms_production_next_batch_seq() is NOT modified here, only called, exactly as
-- the current intake calls it. One unbroken YYMM-NNNN series.
--
-- NO WASTAGE is the whole trick: packed qty = FG qty, so the single quantity
-- fills every figure the downstream steps read, and the packaging lines go into
-- pmh_bom_lines via the SAME fms_production_pack_lines() helper the log book
-- uses. Nothing downstream of intake reads card_type — pm_transfer,
-- packing_entry, ready_to_dispatch and fg_transfer are untouched.
--
-- ⚠ DATA SAFETY. This migration contains NO update, delete, drop, alter column
--   or backfill. It adds one column and replaces three function BODIES. Every
--   existing row reads as 'production' via the column default and takes every
--   existing code path unchanged. The production branch of each function below
--   is copied VERBATIM from its current definition.
--
-- Reversal: restore the three function bodies from 20260729120000 (submit) and
-- 20260730120000 (editable + update). The column may be left in place — no
-- downstream code reads it.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. card_type. NOT NULL + DEFAULT is metadata-only on PG>=11 (no table
--    rewrite); pmh_bom_lines was added to this same table the same way.
-- ---------------------------------------------------------------------------
alter table public.fms_production_requests
  add column if not exists card_type text not null default 'production';

alter table public.fms_production_requests drop constraint if exists fms_production_requests_card_type_check;
alter table public.fms_production_requests add constraint fms_production_requests_card_type_check
  check (card_type in ('production','repackaging'));

comment on column public.fms_production_requests.card_type is
  'production = the full manufacturing chain (default; every pre-existing card). '
  'repackaging = a traded FG that is only repacked: no BOM, no raw materials, no '
  'wastage. Raised directly into awaiting_pm_transfer, bypassing material '
  'handover / RM transfer / quality / log book / production entry / M/C testing. '
  'Nothing downstream of intake reads this column.';

-- ---------------------------------------------------------------------------
-- 2. RAISE a job card. Based on 20260729120000; the production path below the
--    repackaging branch is UNCHANGED, line for line.
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
  v_fy     text  := public.fms_production_fy_code(current_date);
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
    -- It drops any line without a packaging item, so a blank grid yields [].
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

    -- THE SAME counter as a production card — one unbroken series.
    v_bseq  := public.fms_production_next_batch_seq();
    v_batch := to_char(current_date, 'YY') || to_char(current_date, 'MM') || '-' || lpad(v_bseq::text, 4, '0');

    -- No wastage: packed = FG qty, and loss/scrap/lab are zero. These are the
    -- columns pm_transfer / packing_entry / ready_to_dispatch / fg_transfer read.
    insert into public.fms_production_requests (
      req_no, jobcard_no, card_type, fg_item_id, fg_qty,
      bom_lines, issue_remarks, raised_by, requester_name,
      pe_expected_qty, ts_production_loss, scrap_qty, actual_qty, pe_lab_qty,
      ts_packed_qty, ts_loose_qty, pmh_qty, pmh_bom_lines,
      status, current_step, submitted_at
    ) values (
      v_no,
      v_batch,
      'repackaging',
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
  -- PRODUCTION — verbatim from 20260729120000. Do not alter.
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

  -- Lot/Batch (Issue Slip) number: YYMM-NNNN, continuous NNNN.
  v_bseq  := public.fms_production_next_batch_seq();
  v_batch := to_char(current_date, 'YY') || to_char(current_date, 'MM') || '-' || lpad(v_bseq::text, 4, '0');

  insert into public.fms_production_requests (
    req_no, jobcard_no, category_id, raw_material_id, required_qty, unit_id, fg_item_id, fg_qty,
    bom_lines, issue_remarks, raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no,
    v_batch,
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
-- 3. Editable predicate. The production rule is unchanged; repackaging gets its
--    own window — until the packing-material transfer is recorded, which is its
--    first real step (the equivalent of "handover hasn't started yet").
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_request_editable(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_production_requests r
     where r.id = p_req
       and (
         -- production: awaiting the FIRST material handover (excludes the AIS re-loop)
         (coalesce(r.card_type,'production') = 'production'
            and r.status = 'awaiting_material_handover'
            and r.mh_at is null)
         or
         -- repackaging: until the packing-material transfer is recorded
         (r.card_type = 'repackaging'
            and r.status = 'awaiting_pm_transfer'
            and r.pmt_at is null)
       )
  );
$$;
grant execute on function public.fms_production_request_editable(uuid) to authenticated;

comment on function public.fms_production_request_editable(uuid) is
  'True while an issue slip may still be edited. Production: awaiting the FIRST '
  'material handover (status awaiting_material_handover AND mh_at is null). '
  'Repackaging: awaiting the packing-material transfer AND pmt_at is null. '
  'Holding or cancelling the card locks it either way.';

-- ---------------------------------------------------------------------------
-- 4. Edit the issue slip. Based on 20260730120000; the production path below the
--    repackaging branch is UNCHANGED. Never touches jobcard_no, req_no,
--    raised_by, submitted_at, status or current_step.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_update_request(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid  := auth.uid();
  v_raiser uuid;
  v_status text;
  v_no     text;
  v_type   text;
  v_lines  jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_first  jsonb;
  v_rm     text;
  v_qty    text;
  v_unit   text;
  v_pack   jsonb;
  v_fg     numeric;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select raised_by, status, req_no, coalesce(card_type,'production')
    into v_raiser, v_status, v_no, v_type
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

    -- Re-assert the no-wastage identity, so a corrected quantity carries through
    -- to every figure the downstream steps read.
    update public.fms_production_requests
       set fg_item_id         = (p->>'fg_item_id')::uuid,
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
  -- PRODUCTION — verbatim from 20260730120000. Do not alter.
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
  'coordinator. Re-checks fms_production_request_editable server-side. Production '
  'updates fg_item_id, fg_qty, bom_lines (+ legacy mirror) and issue_remarks; '
  'repackaging updates fg_item_id, the no-wastage quantity identity and '
  'pmh_bom_lines. Both stamp edited_at/edited_by and leave jobcard_no, req_no, '
  'raised_by, submitted_at, status and current_step untouched.';

commit;
