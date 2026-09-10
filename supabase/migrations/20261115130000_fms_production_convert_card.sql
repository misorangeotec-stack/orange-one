-- ===========================================================================
-- PRODUCTION ENTRY FMS — NEW CARD TYPE "CONVERT".
--
-- A third tab on Generate Issue Slip beside Production and Repackaging. It is a
-- PRODUCTION card in every respect — same FG item, same multi-raw-material BOM,
-- same chain from material handover through to the finished-good transfer, same
-- M/C testing — with exactly ONE difference:
--
--   THE LOT/BATCH CARD NUMBER IS TYPED, NOT GENERATED.
--
-- A converted lot already carries a number from wherever it came from (Tally, a
-- supplier, an earlier card), so the in-house counter must not invent one over
-- the top of it. A convert card therefore does NOT draw from
-- fms_production_next_batch_seq() — the auto series stays continuous for the two
-- types that do use it, and no sequence value is burned on a card that ignored it.
--
-- The number is FREE TEXT (trimmed, required). A converted lot's number need not
-- match the in-house YYMM-NNNN shape, so no pattern is imposed.
--
-- It must be UNIQUE. jobcard_no had no constraint before because an auto-generated
-- number could not collide; a typed one can, and two cards sharing a number are
-- indistinguishable in every queue, report and Tally entry downstream. Enforced in
-- BOTH places: a clear error from the RPC, and a unique index so nothing that
-- bypasses the RPC can slip a duplicate in either.
--
-- Additive: the 'convert' card_type value, the unique index. Replace-only:
-- fms_production_submit_request (a new branch; the other two paths are untouched).
--
-- Rollback: 20261115130001_fms_production_convert_card_rollback.sql
-- ===========================================================================

alter table public.fms_production_requests drop constraint if exists fms_production_requests_card_type_check;
alter table public.fms_production_requests add constraint fms_production_requests_card_type_check
  check (card_type in ('production','repackaging','convert'));

comment on column public.fms_production_requests.card_type is
  'production | repackaging | convert. `convert` runs the identical production chain; its ONLY difference is that jobcard_no is typed by the user instead of drawn from the batch counter.';

-- ---------------------------------------------------------------------------
-- Uniqueness on the Lot/Batch Card number.
--
-- ⚠ Guarded rather than unconditional. If this database already holds duplicate
--   jobcard_no values, a bare CREATE UNIQUE INDEX aborts the whole migration and
--   the card type never lands. Instead we look first and, on finding duplicates,
--   warn loudly and continue — the RPC check below still blocks every NEW
--   duplicate, and the existing ones are a data question for a human, not
--   something a migration should decide.
-- ---------------------------------------------------------------------------
do $do$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select jobcard_no
      from public.fms_production_requests
     where nullif(trim(jobcard_no), '') is not null
     group by jobcard_no
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise warning
      'fms_production_requests: % Lot/Batch Card number(s) are already duplicated - unique index NOT created. New convert cards are still blocked from reusing a number by fms_production_submit_request. Resolve the duplicates, then create the index by hand.',
      v_dupes;
  else
    create unique index if not exists fms_production_requests_jobcard_no_key
      on public.fms_production_requests (jobcard_no)
      where nullif(trim(jobcard_no), '') is not null;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- Intake. Verbatim from 20261115120000 (itself verbatim from 20260925120000 bar
-- the repackaging landing step), with ONE new branch added for `convert`.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id     uuid;
  v_no     text;
  v_seq    integer;
  v_bseq   integer;
  v_batch  text;
  -- ⚠ v_fy is not initialised here: it depends on v_issue, which is only known
  --   once the payload has been read.
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
  v_lot    text;
  v_today  date;
  v_issue  date;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- Raise-Request authorization: open to all module users unless issue_slip has
  -- owners configured, in which case only they / admin / coordinator may raise.
  -- Identical for every card type — a convert slip is still an issue slip.
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

  -- The job date. IST, never UTC — see 20260903120200. Shared by every card type.
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

    -- The incoming FG lot. Mandatory: it is what every downstream step traces
    -- the repacked goods back to, and there is no way to recover it later.
    v_lot := nullif(trim(p->>'fg_lot_no'), '');
    if v_lot is null then
      raise exception 'The FG item lot number is required on a repackaging slip';
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
      req_no, jobcard_no, card_type, issue_date, fg_item_id, fg_qty, fg_lot_no,
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
      v_lot,
      '[]'::jsonb,
      nullif(trim(p->>'issue_remarks'), ''),
      v_uid, v_name,
      v_fg, 0, 0, v_fg, 0,
      v_fg, 0, v_fg, v_pack,
      'awaiting_packing', 'packing_entry', now()
    )
    returning id into v_id;

    perform public.fms_production_announce(
      'request', v_id, 'raised',
      'Repackaging card ' || v_no || ' (' || v_batch || ', FG lot ' || v_lot || ') raised — ready for the packing entry.',
      public.fms_production_step_owner_ids('packing_entry'),
      jsonb_build_object('req_no', v_no, 'card_type', 'repackaging')
    );

    return v_id;
  end if;

  -- =======================================================================
  -- PRODUCTION and CONVERT — ONE path. They differ ONLY in where the Lot/Batch
  -- Card number comes from, resolved into v_batch below. Everything else — the
  -- BOM, the FG, the landing step, the announcement audience — is identical,
  -- which is the whole point of the convert type.
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

  -- Internal reference number (PRD-2627-0001). Shared by all three card types.
  v_seq := public.fms_production_next_seq('PRD-' || v_fy);
  v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  if v_type = 'convert' then
    -- TYPED, not generated. Free text: a converted lot's number comes from
    -- outside this system and need not look like YYMM-NNNN.
    v_batch := nullif(trim(p->>'jobcard_no'), '');
    if v_batch is null then
      raise exception 'The Lot/Batch Card Number is required on a convert slip';
    end if;
    -- Checked here so the user gets a sentence rather than a constraint violation;
    -- the unique index above is the actual guarantee.
    if exists (select 1 from public.fms_production_requests where jobcard_no = v_batch) then
      raise exception 'Lot/Batch Card Number % is already in use on another job card.', v_batch;
    end if;
    -- ⚠ NO next_batch_seq() call here: a convert card must not burn a number out
    --   of the auto series it never uses.
  else
    -- Lot/Batch (Issue Slip) number: YYMM-NNNN, continuous NNNN. YYMM is the JOB's
    -- month, so a back-dated card belongs to the month it was actually made in.
    v_bseq  := public.fms_production_next_batch_seq();
    v_batch := to_char(v_issue, 'YY') || to_char(v_issue, 'MM') || '-' || lpad(v_bseq::text, 4, '0');
  end if;

  insert into public.fms_production_requests (
    req_no, jobcard_no, card_type, issue_date, category_id, raw_material_id, required_qty, unit_id, fg_item_id, fg_qty,
    bom_lines, issue_remarks, raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no,
    v_batch,
    v_type,
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
    (case when v_type = 'convert' then 'Convert card ' else 'Job card ' end)
      || v_no || ' (' || v_batch || ') raised — ready for material handover confirmation.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('req_no', v_no, 'card_type', v_type)
  );

  return v_id;
end
$fn$;
grant execute on function public.fms_production_submit_request(jsonb) to authenticated;
