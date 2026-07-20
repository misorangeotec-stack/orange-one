-- ===========================================================================
-- PRODUCTION ENTRY FMS — THE JOB CARD + WORKFLOW (Phase 2).
--
-- One entity per job card (case-style, like fms_sampling_requests — no
-- header+line split). ONE AUTHORITATIVE TIMESTAMP COLUMN PER STEP.
--
-- A STRICTLY LINEAR chain of ten steps:
--   issue_slip → material_handover → transfer_slip → production_entry →
--   quality_check → mc_testing → pm_handover → pm_transfer → packing_entry →
--   fg_transfer → closed
-- `issue_slip` is the origin (raising the card); steps 2–10 each own a queue.
-- Queue membership is STATUS-DRIVEN, so a held / closed / cancelled card leaves
-- every queue.
--
-- Helpers:
--   fms_production_can_act(step, req, uid)  — the authorization gate
--   fms_production_resume_status(req)       — where a held card goes back to
--
-- RPCs (all SECURITY DEFINER; lock the row, validate status, re-check authz,
-- stamp the step's own timestamp + captured data, then advance status/current_step):
--   fms_production_submit_request,
--   fms_production_record_material_handover, _record_transfer_slip,
--   _record_production, _record_quality, _record_mc_testing, _record_pm_handover,
--   _record_pm_transfer, _record_packing, _record_fg_transfer,
--   _hold_request, _cancel_request
--
-- ⚠ NEVER INFER A STEP'S COMPLETION FROM THE ACTIVITY TRAIL — announce() is
--   best-effort and swallowed. Every step stamps its own column here.
--
-- Purely ADDITIVE. Reverses (in order): drop the record/hold/cancel/submit
-- functions, then resume_status, can_act, then the table.
-- ===========================================================================

create table if not exists public.fms_production_requests (
  id                    uuid primary key default gen_random_uuid(),
  req_no                text not null unique,          -- PRD-2627-0001

  -- ---- issue slip (step 1) intake --------------------------------------
  jobcard_no            text not null,                 -- external job card no. (free text)
  category_id           uuid references public.fms_production_categories on delete restrict,
  raw_material_id       uuid references public.fms_production_raw_materials on delete restrict,
  required_qty          numeric,
  unit_id               uuid references public.fms_production_units on delete restrict,
  fg_item_id            uuid references public.fms_production_fg_items on delete restrict,
  issue_remarks         text,

  raised_by             uuid references auth.users on delete set null,
  requester_name        text not null,

  -- STATUSES ARE NOT STEP KEYS. on_hold / cancelled / closed live here only.
  status                text not null check (status in (
                          'awaiting_material_handover','awaiting_transfer_slip',
                          'awaiting_production','awaiting_quality','awaiting_mc_testing',
                          'awaiting_pm_handover','awaiting_pm_transfer','awaiting_packing',
                          'awaiting_fg_transfer','closed','on_hold','cancelled')),
  current_step          text not null,

  submitted_at          timestamptz not null default now(),

  -- ---- step 2: material_handover (mh) ----------------------------------
  mh_actual_date        date,
  mh_status             text,
  mh_qty                numeric,
  rm_book_no            text,
  mh_remarks            text,
  mh_at                 timestamptz,
  mh_by                 uuid references auth.users on delete set null,

  -- ---- step 3: transfer_slip & batch card (ts) -------------------------
  ts_actual_date        date,
  ts_status             text,
  transfer_slip_no      text,
  batch_card_no         text,
  ts_remarks            text,
  ts_at                 timestamptz,
  ts_by                 uuid references auth.users on delete set null,

  -- ---- step 4: production_entry (pe) -----------------------------------
  pe_actual_date        date,
  pe_status             text,
  actual_qty            numeric,
  scrap_qty             numeric,
  lot_no                text,
  pe_remarks            text,
  pe_at                 timestamptz,
  pe_by                 uuid references auth.users on delete set null,

  -- ---- step 5: quality_check (qc) --------------------------------------
  qc_actual_date        date,
  qc_status             text,
  qc_remarks            text,
  qc_attachment_path    text,   -- storage object path in fms-production-docs
  qc_attachment_name    text,   -- original filename for display
  qc_at                 timestamptz,
  qc_by                 uuid references auth.users on delete set null,

  -- ---- step 6: mc_testing (mc) -----------------------------------------
  mc_actual_date        date,
  mc_status             text,
  mc_remarks            text,
  mc_at                 timestamptz,
  mc_by                 uuid references auth.users on delete set null,

  -- ---- step 7: pm_handover (pmh) ---------------------------------------
  pmh_actual_date       date,
  pmh_status            text,
  pmh_qty               numeric,
  pmh_batch_no          text,
  pmh_remarks           text,
  pmh_at                timestamptz,
  pmh_by                uuid references auth.users on delete set null,

  -- ---- step 8: pm_transfer (pmt) ---------------------------------------
  pmt_actual_date       date,
  pmt_status            text,
  pmt_qty               numeric,
  pmt_remarks           text,
  pmt_at                timestamptz,
  pmt_by                uuid references auth.users on delete set null,

  -- ---- step 9: packing_entry (pk) --------------------------------------
  pk_actual_date        date,
  pk_status             text,
  packed_qty            numeric,
  loose_ink_qty         numeric,
  pk_remarks            text,
  pk_at                 timestamptz,
  pk_by                 uuid references auth.users on delete set null,

  -- ---- step 10: fg_transfer to Hojiwala (fg) — closes the card ---------
  fg_actual_date        date,
  fg_status             text,
  final_qty             numeric,
  fg_remarks            text,
  fg_at                 timestamptz,
  fg_by                 uuid references auth.users on delete set null,
  closed_at             timestamptz,

  -- edit audit (one pair — a card only sits at one step at a time)
  edited_at             timestamptz,
  edited_by             uuid references auth.users on delete set null,

  hold_at               timestamptz,
  hold_reason           text,
  cancelled_at          timestamptz,
  cancel_reason         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.fms_production_requests is
  'One production job card. Carries the issue-slip intake and one authoritative timestamp + captured data per step through a strictly linear ten-step chain. Read is open to every granted user (the app is per-user granted, not universal); writes go through the RPCs.';

create index if not exists fms_production_requests_status_idx on public.fms_production_requests (status);
create index if not exists fms_production_requests_raised_idx on public.fms_production_requests (raised_by);

drop trigger if exists trg_fms_production_requests_updated on public.fms_production_requests;
create trigger trg_fms_production_requests_updated
  before update on public.fms_production_requests
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- THE gate every workflow RPC calls: admin / coordinator / the step's owner.
create or replace function public.fms_production_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_production_is_coordinator(p_uid)
      or public.fms_production_is_step_owner(p_step_key, p_uid);
$$;
grant execute on function public.fms_production_can_act(text, uuid, uuid) to authenticated;

-- Where a held card goes back to — derived from its own timestamps (linear chain).
create or replace function public.fms_production_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.fg_at  is not null then 'closed'
    when r.pk_at  is not null then 'awaiting_fg_transfer'
    when r.pmt_at is not null then 'awaiting_packing'
    when r.pmh_at is not null then 'awaiting_pm_transfer'
    when r.mc_at  is not null then 'awaiting_pm_handover'
    when r.qc_at  is not null then 'awaiting_mc_testing'
    when r.pe_at  is not null then 'awaiting_quality'
    when r.ts_at  is not null then 'awaiting_production'
    when r.mh_at  is not null then 'awaiting_transfer_slip'
    else 'awaiting_material_handover'
  end
  from public.fms_production_requests r where r.id = p_req;
$$;
grant execute on function public.fms_production_resume_status(uuid) to authenticated;

-- ===========================================================================
-- RLS — read open to every granted user; every write goes through the RPCs.
-- ===========================================================================
alter table public.fms_production_requests enable row level security;
drop policy if exists fms_production_requests_select on public.fms_production_requests;
create policy fms_production_requests_select on public.fms_production_requests
  for select to authenticated using (true);
drop policy if exists fms_production_requests_write_admin on public.fms_production_requests;
create policy fms_production_requests_write_admin on public.fms_production_requests
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RPC — raise a job card. THE ORIGIN OF THE WORKFLOW.
-- ===========================================================================
drop function if exists public.fms_production_submit_request(jsonb);
create or replace function public.fms_production_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_no    text;
  v_seq   integer;
  v_fy    text := public.fms_production_fy_code(current_date);
  v_uid   uuid := auth.uid();
  v_name  text := nullif(trim(p->>'requester_name'), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p->>'jobcard_no'), '') = '' then raise exception 'Job card number is required'; end if;
  if (p->>'raw_material_id') is null or trim(p->>'raw_material_id') = '' then raise exception 'Raw material is required'; end if;
  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then raise exception 'Finished-good item is required'; end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  v_seq := public.fms_production_next_seq('PRD-' || v_fy);
  v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_production_requests (
    req_no, jobcard_no, category_id, raw_material_id, required_qty, unit_id, fg_item_id,
    issue_remarks, raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no,
    trim(p->>'jobcard_no'),
    nullif(p->>'category_id','')::uuid,
    (p->>'raw_material_id')::uuid,
    nullif(p->>'required_qty','')::numeric,
    nullif(p->>'unit_id','')::uuid,
    (p->>'fg_item_id')::uuid,
    nullif(trim(p->>'issue_remarks'), ''),
    v_uid, v_name,
    'awaiting_material_handover', 'material_handover', now()
  )
  returning id into v_id;

  perform public.fms_production_announce(
    'request', v_id, 'raised',
    'Job card ' || v_no || ' raised — ready for material handover confirmation.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('req_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_production_submit_request(jsonb) to authenticated;

-- ===========================================================================
-- A helper macro would be nice but PL/pgSQL has none — each record RPC is spelled
-- out. They all share the shape: lock row · check status · check authz · stamp
-- the step's own *_at/*_by + captured data · advance · announce to the next owners.
-- ===========================================================================

-- step 2 → 3 : material_handover
drop function if exists public.fms_production_record_material_handover(uuid, jsonb);
create or replace function public.fms_production_record_material_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_material_handover' then raise exception 'This job card is not awaiting material handover (status %)', v_status; end if;
  if not public.fms_production_can_act('material_handover', p_req, v_uid) then raise exception 'Not authorized to record material handover'; end if;

  update public.fms_production_requests set
    mh_actual_date = coalesce(nullif(p->>'mh_actual_date','')::date, current_date),
    mh_status      = nullif(trim(p->>'mh_status'), ''),
    mh_qty         = nullif(p->>'mh_qty','')::numeric,
    rm_book_no     = nullif(trim(p->>'rm_book_no'), ''),
    mh_remarks     = nullif(trim(p->>'mh_remarks'), ''),
    mh_at = coalesce(mh_at, now()), mh_by = coalesce(mh_by, v_uid),
    status = 'awaiting_transfer_slip', current_step = 'transfer_slip'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'material_handover',
    'Material handover confirmed for ' || coalesce(v_no,'a job card') || ' — ready for transfer slip & batch card.',
    public.fms_production_step_owner_ids('transfer_slip'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_material_handover(uuid, jsonb) to authenticated;

-- step 3 → 4 : transfer_slip & batch card
drop function if exists public.fms_production_record_transfer_slip(uuid, jsonb);
create or replace function public.fms_production_record_transfer_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_transfer_slip' then raise exception 'This job card is not awaiting the transfer slip (status %)', v_status; end if;
  if not public.fms_production_can_act('transfer_slip', p_req, v_uid) then raise exception 'Not authorized to record the transfer slip'; end if;

  update public.fms_production_requests set
    ts_actual_date   = coalesce(nullif(p->>'ts_actual_date','')::date, current_date),
    ts_status        = nullif(trim(p->>'ts_status'), ''),
    transfer_slip_no = nullif(trim(p->>'transfer_slip_no'), ''),
    batch_card_no    = nullif(trim(p->>'batch_card_no'), ''),
    ts_remarks       = nullif(trim(p->>'ts_remarks'), ''),
    ts_at = coalesce(ts_at, now()), ts_by = coalesce(ts_by, v_uid),
    status = 'awaiting_production', current_step = 'production_entry'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'transfer_slip',
    'Transfer slip & batch card created for ' || coalesce(v_no,'a job card') || ' — ready for production entry.',
    public.fms_production_step_owner_ids('production_entry'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_transfer_slip(uuid, jsonb) to authenticated;

-- step 4 → 5 : production_entry
drop function if exists public.fms_production_record_production(uuid, jsonb);
create or replace function public.fms_production_record_production(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_production' then raise exception 'This job card is not awaiting production entry (status %)', v_status; end if;
  if not public.fms_production_can_act('production_entry', p_req, v_uid) then raise exception 'Not authorized to record production entry'; end if;

  update public.fms_production_requests set
    pe_actual_date = coalesce(nullif(p->>'pe_actual_date','')::date, current_date),
    pe_status      = nullif(trim(p->>'pe_status'), ''),
    actual_qty     = nullif(p->>'actual_qty','')::numeric,
    scrap_qty      = nullif(p->>'scrap_qty','')::numeric,
    lot_no         = nullif(trim(p->>'lot_no'), ''),
    pe_remarks     = nullif(trim(p->>'pe_remarks'), ''),
    pe_at = coalesce(pe_at, now()), pe_by = coalesce(pe_by, v_uid),
    status = 'awaiting_quality', current_step = 'quality_check'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_entry',
    'Production entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for quality checking.',
    public.fms_production_step_owner_ids('quality_check'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_production(uuid, jsonb) to authenticated;

-- step 5 → 6 : quality_check
drop function if exists public.fms_production_record_quality(uuid, jsonb);
create or replace function public.fms_production_record_quality(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_quality' then raise exception 'This job card is not awaiting quality checking (status %)', v_status; end if;
  if not public.fms_production_can_act('quality_check', p_req, v_uid) then raise exception 'Not authorized to record quality checking'; end if;

  update public.fms_production_requests set
    qc_actual_date     = coalesce(nullif(p->>'qc_actual_date','')::date, current_date),
    qc_status          = nullif(trim(p->>'qc_status'), ''),
    qc_remarks         = nullif(trim(p->>'qc_remarks'), ''),
    qc_attachment_path = nullif(p->>'qc_attachment_path', ''),
    qc_attachment_name = nullif(p->>'qc_attachment_name', ''),
    qc_at = coalesce(qc_at, now()), qc_by = coalesce(qc_by, v_uid),
    status = 'awaiting_mc_testing', current_step = 'mc_testing'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'quality_check',
    'Quality checking recorded for ' || coalesce(v_no,'a job card') || ' — ready for M/C testing.',
    public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_quality(uuid, jsonb) to authenticated;

-- step 6 → 7 : mc_testing
drop function if exists public.fms_production_record_mc_testing(uuid, jsonb);
create or replace function public.fms_production_record_mc_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_mc_testing' then raise exception 'This job card is not awaiting M/C testing (status %)', v_status; end if;
  if not public.fms_production_can_act('mc_testing', p_req, v_uid) then raise exception 'Not authorized to record M/C testing'; end if;

  update public.fms_production_requests set
    mc_actual_date = coalesce(nullif(p->>'mc_actual_date','')::date, current_date),
    mc_status      = nullif(trim(p->>'mc_status'), ''),
    mc_remarks     = nullif(trim(p->>'mc_remarks'), ''),
    mc_at = coalesce(mc_at, now()), mc_by = coalesce(mc_by, v_uid),
    status = 'awaiting_pm_handover', current_step = 'pm_handover'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'mc_testing',
    'M/C testing recorded for ' || coalesce(v_no,'a job card') || ' — ready for packing-material handover.',
    public.fms_production_step_owner_ids('pm_handover'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_mc_testing(uuid, jsonb) to authenticated;

-- step 7 → 8 : pm_handover
drop function if exists public.fms_production_record_pm_handover(uuid, jsonb);
create or replace function public.fms_production_record_pm_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_pm_handover' then raise exception 'This job card is not awaiting packing-material handover (status %)', v_status; end if;
  if not public.fms_production_can_act('pm_handover', p_req, v_uid) then raise exception 'Not authorized to record packing-material handover'; end if;

  update public.fms_production_requests set
    pmh_actual_date = coalesce(nullif(p->>'pmh_actual_date','')::date, current_date),
    pmh_status      = nullif(trim(p->>'pmh_status'), ''),
    pmh_qty         = nullif(p->>'pmh_qty','')::numeric,
    pmh_batch_no    = nullif(trim(p->>'pmh_batch_no'), ''),
    pmh_remarks     = nullif(trim(p->>'pmh_remarks'), ''),
    pmh_at = coalesce(pmh_at, now()), pmh_by = coalesce(pmh_by, v_uid),
    status = 'awaiting_pm_transfer', current_step = 'pm_transfer'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_handover',
    'Packing material handed over for ' || coalesce(v_no,'a job card') || ' — ready for packing-material transfer.',
    public.fms_production_step_owner_ids('pm_transfer'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_pm_handover(uuid, jsonb) to authenticated;

-- step 8 → 9 : pm_transfer
drop function if exists public.fms_production_record_pm_transfer(uuid, jsonb);
create or replace function public.fms_production_record_pm_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_pm_transfer' then raise exception 'This job card is not awaiting packing-material transfer (status %)', v_status; end if;
  if not public.fms_production_can_act('pm_transfer', p_req, v_uid) then raise exception 'Not authorized to record packing-material transfer'; end if;

  update public.fms_production_requests set
    pmt_actual_date = coalesce(nullif(p->>'pmt_actual_date','')::date, current_date),
    pmt_status      = nullif(trim(p->>'pmt_status'), ''),
    pmt_qty         = nullif(p->>'pmt_qty','')::numeric,
    pmt_remarks     = nullif(trim(p->>'pmt_remarks'), ''),
    pmt_at = coalesce(pmt_at, now()), pmt_by = coalesce(pmt_by, v_uid),
    status = 'awaiting_packing', current_step = 'packing_entry'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_transfer',
    'Packing material transferred to production for ' || coalesce(v_no,'a job card') || ' — ready for packing entry.',
    public.fms_production_step_owner_ids('packing_entry'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_pm_transfer(uuid, jsonb) to authenticated;

-- step 9 → 10 : packing_entry
drop function if exists public.fms_production_record_packing(uuid, jsonb);
create or replace function public.fms_production_record_packing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_packing' then raise exception 'This job card is not awaiting packing entry (status %)', v_status; end if;
  if not public.fms_production_can_act('packing_entry', p_req, v_uid) then raise exception 'Not authorized to record packing entry'; end if;

  update public.fms_production_requests set
    pk_actual_date = coalesce(nullif(p->>'pk_actual_date','')::date, current_date),
    pk_status      = nullif(trim(p->>'pk_status'), ''),
    packed_qty     = nullif(p->>'packed_qty','')::numeric,
    loose_ink_qty  = nullif(p->>'loose_ink_qty','')::numeric,
    pk_remarks     = nullif(trim(p->>'pk_remarks'), ''),
    pk_at = coalesce(pk_at, now()), pk_by = coalesce(pk_by, v_uid),
    status = 'awaiting_fg_transfer', current_step = 'fg_transfer'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'packing_entry',
    'Packing entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for finished-good transfer to Hojiwala.',
    public.fms_production_step_owner_ids('fg_transfer'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_packing(uuid, jsonb) to authenticated;

-- step 10 : fg_transfer — closes the card
drop function if exists public.fms_production_record_fg_transfer(uuid, jsonb);
create or replace function public.fms_production_record_fg_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  select status, req_no, raised_by into v_status, v_no, v_raiser
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_fg_transfer' then raise exception 'This job card is not awaiting finished-good transfer (status %)', v_status; end if;
  if not public.fms_production_can_act('fg_transfer', p_req, v_uid) then raise exception 'Not authorized to record the finished-good transfer'; end if;

  update public.fms_production_requests set
    fg_actual_date = coalesce(nullif(p->>'fg_actual_date','')::date, current_date),
    fg_status      = nullif(trim(p->>'fg_status'), ''),
    final_qty      = nullif(p->>'final_qty','')::numeric,
    fg_remarks     = nullif(trim(p->>'fg_remarks'), ''),
    fg_at = coalesce(fg_at, now()), fg_by = coalesce(fg_by, v_uid),
    closed_at = coalesce(closed_at, now()),
    status = 'closed', current_step = 'fg_transfer'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'fg_transfer',
    'Finished-good transfer to Hojiwala recorded for ' || coalesce(v_no,'a job card') || ' — job card closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_fg_transfer(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — park / un-park. `on_hold` is a STATUS: it leaves every queue.
-- Admin / coordinator only.
-- ===========================================================================
drop function if exists public.fms_production_hold_request(uuid, boolean, text);
create or replace function public.fms_production_hold_request(p_req uuid, p_hold boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_uid uuid := auth.uid();
begin
  select status into v_status from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not (public.is_admin(v_uid) or public.fms_production_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can hold a job card';
  end if;

  if p_hold then
    if v_status in ('closed','cancelled','on_hold') then raise exception 'A % job card cannot be put on hold', v_status; end if;
    if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to hold'; end if;
    update public.fms_production_requests
       set status = 'on_hold', hold_at = now(), hold_reason = trim(p_reason)
     where id = p_req;
  else
    if v_status <> 'on_hold' then raise exception 'This job card is not on hold'; end if;
    update public.fms_production_requests
       set status = public.fms_production_resume_status(p_req), hold_at = null, hold_reason = null
     where id = p_req;
  end if;
end $$;
grant execute on function public.fms_production_hold_request(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- RPC — cancel. The raiser, an admin or a coordinator, before it closes.
-- ===========================================================================
drop function if exists public.fms_production_cancel_request(uuid, text);
create or replace function public.fms_production_cancel_request(p_req uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  select status, raised_by into v_status, v_raiser from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status in ('closed','cancelled') then raise exception 'This job card is already %', v_status; end if;
  if not (v_raiser = v_uid or public.is_admin(v_uid) or public.fms_production_is_coordinator(v_uid)) then
    raise exception 'Only the requester, an admin or a coordinator can cancel this job card';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to cancel'; end if;

  update public.fms_production_requests set
    status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = p_req;
end $$;
grant execute on function public.fms_production_cancel_request(uuid, text) to authenticated;
