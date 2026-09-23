-- ===========================================================================
-- NR-8 · The Talent Acquisition lines that need a column rather than a screen
--
--   1A.1  the recruiter ACKNOWLEDGES an approved requisition   (3% of the sheet)
--   1A.6  BGV becomes a RESULT, not a tick                     (part of 4%)
--   gap 2 the induction date the weekly report tests at Day 15
--
-- ADDITIVE ONLY, and the module is LIVE. No existing column, constraint, RPC or
-- row is altered. Everything here is nullable: a requisition nobody has
-- acknowledged, an onboarding with no BGV result and no induction date are all
-- ordinary states, and every row that exists today is in exactly those states.
-- ===========================================================================

-- 1 ── the acknowledgement ---------------------------------------------------
-- `hr_approved_at` is the HR HEAD's approval. Nothing has ever recorded the
-- recruiter picking the work up afterwards, which is what 1A.1 scores.

alter table public.fms_hr_requisitions
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid;

comment on column public.fms_hr_requisitions.acknowledged_at is
  'NR-8 / KPI 1A.1. When the recruiter acknowledged this approved requisition as their work. Measured against hr_approved_at (the HR Head''s approval) + 1 working day - the earliest moment the vacancy is genuinely the recruiter''s to run. Null means not acknowledged: a real state, and every row that predates NR-8 is in it.';

-- 2 ── BGV, as a result ------------------------------------------------------
-- A checklist item can only be done or not done. The weekly report asks for a
-- STATUS, and its own analysis is blunt about why: there is nowhere to say a
-- verification came back WITH a discrepancy, which is the only state worth
-- flagging. So this is a field on the onboarding, and `police_verification`
-- stays an ordinary checklist item beside it.

alter table public.fms_hr_onboardings
  add column if not exists bgv_status text,
  add column if not exists bgv_note   text,
  add column if not exists bgv_at     timestamptz,
  add column if not exists bgv_by     uuid;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'fms_hr_onboardings_bgv_status_check') then
    alter table public.fms_hr_onboardings
      add constraint fms_hr_onboardings_bgv_status_check
      check (bgv_status is null or bgv_status in ('pending', 'clear', 'discrepancy'));
  end if;
end
$do$;

comment on column public.fms_hr_onboardings.bgv_status is
  'NR-8 / KPI 1A.6. Background verification RESULT: pending, clear or discrepancy. Null = not started. A discrepancy is the only state anybody needs to act on, and a tick could never express it.';
comment on column public.fms_hr_onboardings.bgv_note is
  'NR-8. What the discrepancy was. Demanded by the RPC when the status is discrepancy - a flag with no explanation is a rumour.';

-- 3 ── the induction date ----------------------------------------------------
-- One date, not a checklist item: the weekly report's flag is "induction not
-- done by Day 15", and a done/not-done tick carries no date to test.

alter table public.fms_hr_onboardings
  add column if not exists induction_on date,
  add column if not exists induction_by uuid;

comment on column public.fms_hr_onboardings.induction_on is
  'NR-8 / weekly report B1.3, B2.5. The date the new joiner''s induction was held. Tested against joining_date + 15 days. A DATE rather than a checklist tick, because the flag needs the date.';

-- 4 ── reference check, as an ordinary checklist item ------------------------
-- 1A.6 names references beside BGV. This one really is a done/not-done job, so
-- it is a master row like the other nine - no code, no migration next time.
-- ⚠ Checks are seeded onto an onboarding when it OPENS, so the three that are
-- already open will not grow this item. That is correct: it was not asked of
-- them, and back-filling would invent work nobody was told to do.

insert into public.fms_hr_onboarding_items (key, name, description, requires_file, allows_link, due_days, active, sort_order)
select 'reference_check', 'Reference check',
       'Previous employer or listed referee contacted, and what they said recorded.',
       false, true, 7, true, 10
 where not exists (select 1 from public.fms_hr_onboarding_items where key = 'reference_check');

-- 5 ── acknowledging, as its own RPC ----------------------------------------
-- Not folded into an existing write: acknowledging is a statement by one person
-- about one moment, and it must be impossible to do it twice or on somebody
-- else's behalf.

create or replace function public.fms_hr_acknowledge_requisition(p_req uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_ack    timestamptz;
  v_no     text;
begin
  select status, acknowledged_at, mrf_no into v_status, v_ack, v_no
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  -- Only once it is APPROVED: there is nothing to pick up before that, and an
  -- acknowledgement on a requisition that is later sent back is meaningless.
  if v_status not in ('mgmt_review', 'posting', 'sourcing', 'on_hold', 'closed') then
    raise exception 'This requisition is not approved yet (status %)', v_status;
  end if;

  if v_ack is not null then
    raise exception 'This requisition was already acknowledged';
  end if;

  -- Whoever will actually run the hunt: the owner of the posting step.
  if not public.fms_hr_can_act('job_posting', p_req, v_uid) then
    raise exception 'Only the recruiter on this requisition can acknowledge it';
  end if;

  update public.fms_hr_requisitions
     set acknowledged_at = now(), acknowledged_by = v_uid
   where id = p_req;
end
$fn$;

grant execute on function public.fms_hr_acknowledge_requisition(uuid) to authenticated;

-- 6 ── the onboarding's two new facts ----------------------------------------

create or replace function public.fms_hr_set_bgv(p_onboarding uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req uuid;
begin
  select requisition_id into v_req from public.fms_hr_onboardings where id = p_onboarding for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;

  if p_status is not null and p_status not in ('pending', 'clear', 'discrepancy') then
    raise exception 'Unknown BGV result %', p_status;
  end if;
  -- A discrepancy with no explanation is a rumour, and it is the one state
  -- somebody downstream has to act on.
  if p_status = 'discrepancy' and coalesce(trim(p_note), '') = '' then
    raise exception 'Say what the discrepancy was';
  end if;

  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to record the verification on this hire';
  end if;

  update public.fms_hr_onboardings
     set bgv_status = p_status,
         bgv_note   = nullif(trim(p_note), ''),
         bgv_at     = case when p_status is null then null else now() end,
         bgv_by     = case when p_status is null then null else v_uid end
   where id = p_onboarding;
end
$fn$;

grant execute on function public.fms_hr_set_bgv(uuid, text, text) to authenticated;

create or replace function public.fms_hr_set_induction(p_onboarding uuid, p_on date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req uuid;
  v_join date;
begin
  select requisition_id, joining_date into v_req, v_join
    from public.fms_hr_onboardings where id = p_onboarding for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;

  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to record the induction on this hire';
  end if;

  if p_on is not null then
    if p_on > current_date then
      raise exception 'An induction cannot be recorded for a future date';
    end if;
    -- Before the joining date it is not an induction, it is a typo.
    if v_join is not null and p_on < v_join then
      raise exception 'The induction cannot be before the joining date (%)', to_char(v_join, 'DD-MM-YYYY');
    end if;
  end if;

  update public.fms_hr_onboardings
     set induction_on = p_on,
         induction_by = case when p_on is null then null else v_uid end
   where id = p_onboarding;
end
$fn$;

grant execute on function public.fms_hr_set_induction(uuid, date) to authenticated;
