-- ===========================================================================
-- HR Recruitment FMS — PROBATION (Phase 7).
--
-- Once someone has actually JOINED, their HOD reviews them monthly for three
-- months and then confirms, rejects, or extends by one month.
--
-- Tables:
--   fms_hr_probations         — one per JOINED hire (not per finalized candidate)
--   fms_hr_probation_reviews  — one row per monthly review (months 1–3, plus 4 when
--                               the 3-month decision was "extend")
--
-- RPCs (SECURITY DEFINER; lock the row, authorize via fms_hr_can_act(…), validate
-- the transition, and STAMP THE FACT ON THE DOMAIN ROW):
--   fms_hr_record_probation_review  — months 1–3, and 4 only after an extension
--   fms_hr_decide_probation         — approve / reject / extend, after the M3 review
--   fms_hr_decide_extension         — approve / reject, after the M4 review
--
-- ---------------------------------------------------------------------------
-- THE THREE THINGS THIS PHASE EXISTS TO GET RIGHT:
--
-- 1. THE PROBATION CLOCK IS CALENDAR MONTHS, NOT WORKING DAYS.
--    "One month after they joined" is not "26 working days". A 31-Jan joiner's
--    Month-1 review is due 28-Feb, not 3-Mar. Postgres's own date + interval
--    clamps to the end of a short month, and so does addMonths() in
--    frontend/src/shared/lib/workingDays.ts — fms_hr_add_months() below exists so
--    that the two are demonstrably the same rule, in one place, on each side.
--
-- 2. THE FINAL DECISION BELONGS TO THE SAME PERSON AS THE REVIEWS.
--    fms_hr_can_act() (20260712130000) routed probation_m1/m2/m3 to the
--    requisition's hiring managers but NOT probation_final / probation_extension,
--    which fell through to the global step-owner table. The HOD who did all three
--    reviews would then have been unable to act on their own conclusion — the exact
--    shape of the Phase-4 bug fixed in 20260712150000. can_act is re-issued below
--    with both steps added, and HOD_STEPS in lib/steps.ts now says the same thing.
--
-- 3. A REJECTED PROBATION DOES *NOT* REOPEN THE REQUISITION.
--    Phase 6 reopens a vacancy when an offer is declined, because someone who never
--    turned up never occupied the seat. That reasoning does not carry over: a person
--    who joined, worked three months and failed probation DID fill the seat. The
--    requisition is closed and stays closed — replacing them is a new MRF. So
--    nothing here calls fms_hr_sync_requisition_fill(), and nothing here touches
--    onboardings.completed_at or candidates.joined_at (the two facts seat accounting
--    is computed from).
-- ---------------------------------------------------------------------------
--
-- And the standing rule of this codebase (20260708120900): never infer that a step
-- happened from the activity trail — fms_hr_announce is best-effort and swallows its
-- own failures. Every review and every decision writes an authoritative timestamp
-- column on a real domain row, inside the RPC.
--
-- Purely ADDITIVE. Reversal (reverse order):
--   drop function fms_hr_decide_extension, fms_hr_decide_probation,
--                 fms_hr_record_probation_review, fms_hr_open_probation,
--                 fms_hr_add_months;
--   re-run 20260712160000's fms_hr_try_complete_onboarding and
--          20260712130000's fms_hr_can_act;
--   drop table fms_hr_probation_reviews, fms_hr_probations;
-- ===========================================================================

-- ===========================================================================
-- Calendar-month date math — the SQL twin of addMonths() in shared/lib/workingDays.
--
-- Postgres already clamps ('2026-01-31'::date + interval '1 month' = 2026-02-28),
-- which is exactly the behaviour the frontend implements by hand. Naming it makes
-- the rule greppable from both sides instead of being an incidental property of an
-- inline expression.
-- ===========================================================================
create or replace function public.fms_hr_add_months(p_from date, p_months integer)
returns date
language sql
immutable
as $$
  select (p_from + make_interval(months => greatest(0, coalesce(p_months, 0))))::date;
$$;
grant execute on function public.fms_hr_add_months(date, integer) to authenticated;

comment on function public.fms_hr_add_months(date, integer) is
  'Add N calendar months, clamping to the end of a short month (31-Jan + 1 = 28-Feb). The SQL twin of addMonths() in frontend/src/shared/lib/workingDays.ts — probation reviews are due in months, never in working days.';

-- ===========================================================================
-- fms_hr_probations — one per hire who ACTUALLY JOINED.
--
-- Keyed on the onboarding, not the candidate: the onboarding is what carries the
-- fact "they turned up" (completed_at) and the date everything here is measured
-- from (joining_date). joining_date is COPIED rather than joined, because a
-- probation is a record about a person's first three months: a later correction to
-- the onboarding must not silently re-date reviews that have already happened.
--
-- Two decision points, deliberately kept as separate columns:
--   outcome           — the 3-month verdict: approved | rejected | extended
--   extension_outcome — the verdict after the extra month: approved | rejected
-- and one answer, `final_status`, which is what every report reads. Collapsing the
-- three into one column would lose the difference between "confirmed at 3 months"
-- and "confirmed after an extension" — which is precisely what HR wants to know.
-- ===========================================================================
create table if not exists public.fms_hr_probations (
  id                   uuid primary key default gen_random_uuid(),
  -- One probation per onboarding; the onboarding is deleted only if the candidate is,
  -- and a joined onboarding cannot be un-finalized (Phase 6's backward-move guard).
  onboarding_id        uuid not null unique references public.fms_hr_onboardings on delete cascade,
  candidate_id         uuid not null references public.fms_hr_candidates on delete cascade,
  requisition_id       uuid not null references public.fms_hr_requisitions on delete cascade,

  -- THE anchor. Month N's review is due fms_hr_add_months(joining_date, N).
  joining_date         date not null,
  opened_at            timestamptz not null default now(),

  -- ---- the 3-month decision --------------------------------------------------
  outcome              text check (outcome in ('approved','rejected','extended')),
  outcome_at           timestamptz,
  outcome_by           uuid references auth.users on delete set null,
  outcome_remarks      text,

  -- ---- the extension, if the 3-month decision was "extend" --------------------
  extension_months     integer not null default 1 check (extension_months > 0),
  extension_outcome    text check (extension_outcome in ('approved','rejected')),
  extension_outcome_at timestamptz,
  extension_outcome_by uuid references auth.users on delete set null,
  extension_remarks    text,

  -- ---- the answer, whichever path got here -----------------------------------
  final_status         text check (final_status in ('approved','rejected')),
  final_status_at      timestamptz,
  -- Captured on approval only: the day they stop being on probation, and the ID they
  -- carry from then on. The onboarding's employee_code is the one issued on day one;
  -- this is the one they are confirmed under, and they are not always the same.
  permanent_from       date,
  employee_code        text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists fms_hr_probations_req_idx    on public.fms_hr_probations (requisition_id);
create index if not exists fms_hr_probations_open_idx   on public.fms_hr_probations (final_status);

comment on table public.fms_hr_probations is
  'One probation per JOINED hire (opened by fms_hr_try_complete_onboarding). Reviewed monthly by the requisition''s hiring manager. A rejection records the outcome and stops — it never reopens the requisition, because the seat was genuinely filled.';

drop trigger if exists trg_fms_hr_probations_updated on public.fms_hr_probations;
create trigger trg_fms_hr_probations_updated
  before update on public.fms_hr_probations
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_hr_probation_reviews — one row per monthly review.
--
-- month 4 exists only when the 3-month decision was "extend" (enforced by the RPC).
-- reviewed_at is stamped by the RPC, never typed: it is the authoritative "this
-- review happened" fact that the queue's overdue state is measured against.
-- ===========================================================================
create table if not exists public.fms_hr_probation_reviews (
  id            uuid primary key default gen_random_uuid(),
  probation_id  uuid not null references public.fms_hr_probations on delete cascade,
  month         integer not null check (month between 1 and 4),

  status        text not null check (status in ('satisfactory','needs_improvement','unsatisfactory')),
  remarks       text,
  file_path     text,
  file_name     text,

  reviewed_at   timestamptz not null default now(),
  reviewer_id   uuid references auth.users on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (probation_id, month)
);

create index if not exists fms_hr_probation_reviews_prob_idx on public.fms_hr_probation_reviews (probation_id);

comment on table public.fms_hr_probation_reviews is
  'One row per monthly probation review (1–3, plus 4 after an extension). Performance data about a named employee — read is gated through the requisition.';

drop trigger if exists trg_fms_hr_probation_reviews_updated on public.fms_hr_probation_reviews;
create trigger trg_fms_hr_probation_reviews_updated
  before update on public.fms_hr_probation_reviews
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS — read follows the requisition, exactly as the onboarding does. These rows
-- say how a named employee is performing, so they are NOT world-readable: direct
-- writes are admin-only and everything real happens in an RPC.
-- ===========================================================================
alter table public.fms_hr_probations enable row level security;
drop policy if exists fms_hr_probations_select on public.fms_hr_probations;
create policy fms_hr_probations_select on public.fms_hr_probations
  for select to authenticated using (public.fms_hr_can_read_requisition(requisition_id, auth.uid()));
drop policy if exists fms_hr_probations_write_admin on public.fms_hr_probations;
create policy fms_hr_probations_write_admin on public.fms_hr_probations
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_hr_probation_reviews enable row level security;
drop policy if exists fms_hr_probation_reviews_select on public.fms_hr_probation_reviews;
create policy fms_hr_probation_reviews_select on public.fms_hr_probation_reviews
  for select to authenticated using (
    exists (
      select 1 from public.fms_hr_probations p
      where p.id = probation_id
        and public.fms_hr_can_read_requisition(p.requisition_id, auth.uid())
    )
  );
drop policy if exists fms_hr_probation_reviews_write_admin on public.fms_hr_probation_reviews;
create policy fms_hr_probation_reviews_write_admin on public.fms_hr_probation_reviews
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_hr_can_act — RE-ISSUED (20260712130000 definition) with ONE change:
-- probation_final and probation_extension join the HOD list.
--
-- They were missing, and it was a real bug in waiting. The HOD raises the MRF, runs
-- Round 2, and writes all three monthly reviews — but the decision those reviews
-- exist to support would have routed to whoever happened to be listed as the global
-- owner of `probation_final`, and (since no owner is set) to nobody at all. Phase 4
-- shipped exactly this bug once already (20260712150000: the HOD could not reject a
-- CV they were reviewing); this is the same mistake caught before it shipped.
--
-- Keep this list in sync with HOD_STEPS in frontend/src/apps/hr-recruitment/lib/steps.ts.
-- ===========================================================================
create or replace function public.fms_hr_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
  if public.is_admin(p_uid) or public.fms_hr_is_coordinator(p_uid) then
    return true;
  end if;

  if p_step_key in (
    'hod_shortlist','interview_2',
    'probation_m1','probation_m2','probation_m3',
    'probation_final','probation_extension'
  ) then
    if p_req is null then return false; end if;
    select hiring_manager_ids into v_managers from public.fms_hr_requisitions where id = p_req;
    return v_managers is not null and p_uid = any(v_managers);
  end if;

  return public.fms_hr_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_hr_can_act(text, uuid, uuid) to authenticated;

-- ===========================================================================
-- Open the probation. Called only from fms_hr_try_complete_onboarding — i.e. at the
-- moment the person genuinely joined (offer accepted AND every checklist item done),
-- never when they were merely finalized or offered.
-- ===========================================================================
create or replace function public.fms_hr_open_probation(p_onb uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cand    uuid;
  v_req     uuid;
  v_joining date;
  v_done    timestamptz;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
  v_id      uuid;
begin
  select o.candidate_id, o.requisition_id, o.joining_date, o.completed_at
    into v_cand, v_req, v_joining, v_done
    from public.fms_hr_onboardings o where o.id = p_onb;

  -- A probation is the consequence of joining. No joining, no probation.
  if v_done is null or v_joining is null then return; end if;

  insert into public.fms_hr_probations (onboarding_id, candidate_id, requisition_id, joining_date)
  values (p_onb, v_cand, v_req, v_joining)
  on conflict (onboarding_id) do nothing
  returning id into v_id;

  if v_id is null then return; end if;   -- already open; nothing new to announce

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', v_id, 'opened',
    coalesce(v_name, 'The new hire') || ' is on probation — the Month-1 review is due '
      || to_char(public.fms_hr_add_months(v_joining, 1), 'DD-MM-YYYY')
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[])
  );
end $$;
grant execute on function public.fms_hr_open_probation(uuid) to authenticated;

-- ===========================================================================
-- fms_hr_try_complete_onboarding — RE-ISSUED (20260712160000 definition) with ONE
-- change: joining now also OPENS THE PROBATION.
--
-- Hooked here rather than in fms_hr_toggle_onboarding_check because joining can
-- equally be sealed by the offer acceptance landing last — both paths call this, and
-- this is the single place completed_at is written. Anything hung off one caller
-- would silently miss the other.
-- ===========================================================================
create or replace function public.fms_hr_try_complete_onboarding(p_onb uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    uuid;
  v_cand   uuid;
  v_status text;
  v_done   timestamptz;
  v_total  integer;
  v_ticked integer;
  v_name   text;
  v_no     text;
  v_mgrs   uuid[];
begin
  select requisition_id, candidate_id, offer_status, completed_at
    into v_req, v_cand, v_status, v_done
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null or v_done is not null then return; end if;
  if v_status <> 'accepted' then return; end if;   -- no acceptance, no joining

  select count(*), count(*) filter (where done)
    into v_total, v_ticked
    from public.fms_hr_onboarding_checks where onboarding_id = p_onb;
  if v_total = 0 or v_ticked < v_total then return; end if;

  update public.fms_hr_onboardings set completed_at = now() where id = p_onb;
  -- The seat is filled on the CANDIDATE row too — that is what the pipeline report
  -- reads, and what the backward-move guard checks.
  update public.fms_hr_candidates set joined_at = now() where id = v_cand;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'onboarding', p_onb, 'joined',
    coalesce(v_name, 'The candidate') || ' has joined — onboarding complete (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('probation_m1')
  );

  -- They joined, so the three-month clock starts now (Phase 7).
  perform public.fms_hr_open_probation(p_onb);

  -- A seat is only filled when someone actually turns up. THIS is what closes the
  -- requisition — never the finalize move.
  perform public.fms_hr_sync_requisition_fill(v_req);
end $$;
grant execute on function public.fms_hr_try_complete_onboarding(uuid) to authenticated;

-- ===========================================================================
-- RPC — record one monthly review.
--
-- The sequence is enforced here, not in the UI: you cannot review month 3 before
-- month 2, and month 4 does not exist until the 3-month decision was "extend".
-- Re-recording a month is allowed (a correction), and re-stamps reviewed_at.
-- ===========================================================================
drop function if exists public.fms_hr_record_probation_review(uuid, integer, text, text, text, text);
create or replace function public.fms_hr_record_probation_review(
  p_probation uuid,
  p_month     integer,
  p_status    text,
  p_remarks   text default '',
  p_file_path text default null,
  p_file_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_outcome text;
  v_final   text;
  v_step    text;
  v_missing integer;
  v_name    text;
  v_no      text;
begin
  if p_month is null or p_month not between 1 and 4 then
    raise exception 'A probation review is for month 1, 2, 3 or 4';
  end if;
  if p_status not in ('satisfactory','needs_improvement','unsatisfactory') then
    raise exception 'Unknown review status %', p_status;
  end if;

  select requisition_id, candidate_id, outcome, final_status
    into v_req, v_cand, v_outcome, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_final is not null then
    raise exception 'This probation is already % — no further reviews apply', v_final;
  end if;

  -- Month 4 is the EXTENDED review: it exists only because the 3-month decision was
  -- "extend". Months 1–3 close once that decision has been taken.
  if p_month = 4 then
    if v_outcome is distinct from 'extended' then
      raise exception 'There is no month-4 review unless the probation was extended';
    end if;
  elsif v_outcome is not null then
    raise exception 'The three-month decision has already been taken — month % can no longer be reviewed', p_month;
  end if;

  -- No skipping. A month-3 review with no month-2 review behind it is not a review.
  select count(*) into v_missing
    from generate_series(1, p_month - 1) m
   where not exists (
     select 1 from public.fms_hr_probation_reviews r
      where r.probation_id = p_probation and r.month = m
   );
  if v_missing > 0 then
    raise exception 'Record the earlier month(s) first — % review(s) are still missing before month %', v_missing, p_month;
  end if;

  v_step := case when p_month = 4 then 'probation_extension' else 'probation_m' || p_month end;
  if not public.fms_hr_can_act(v_step, v_req, v_uid) then
    raise exception 'Not authorized to review this person — that is the hiring manager''s call';
  end if;

  insert into public.fms_hr_probation_reviews (
    probation_id, month, status, remarks, file_path, file_name, reviewed_at, reviewer_id
  ) values (
    p_probation, p_month, p_status, nullif(trim(p_remarks), ''),
    nullif(p_file_path, ''), nullif(p_file_name, ''),
    now(), v_uid                                  -- stamped here; the HOD never types a date
  )
  on conflict (probation_id, month) do update set
    status      = excluded.status,
    remarks     = excluded.remarks,
    file_path   = coalesce(excluded.file_path, public.fms_hr_probation_reviews.file_path),
    file_name   = coalesce(excluded.file_name, public.fms_hr_probation_reviews.file_name),
    reviewed_at = now(),
    reviewer_id = v_uid;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no into v_no from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation, 'review_m' || p_month,
    'Month-' || p_month || ' probation review recorded for ' || coalesce(v_name, 'the new hire')
      || ' — ' || replace(p_status, '_', ' ') || ' (' || coalesce(v_no, '') || ')',
    public.fms_hr_step_owner_ids('onboarding')
  );
end $$;
grant execute on function public.fms_hr_record_probation_review(uuid, integer, text, text, text, text) to authenticated;

-- ===========================================================================
-- RPC — the three-month decision: approve · reject · extend by one month.
--
-- APPROVE captures the date they become permanent and the employee ID they are
-- confirmed under. REJECT records the outcome and STOPS: it deliberately does NOT
-- call fms_hr_sync_requisition_fill(). See the header — the seat was filled.
-- ===========================================================================
drop function if exists public.fms_hr_decide_probation(uuid, text, text, date, text);
create or replace function public.fms_hr_decide_probation(
  p_probation     uuid,
  p_decision      text,
  p_remarks       text default '',
  p_permanent_from date default null,
  p_employee_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_join    date;
  v_outcome text;
  v_final   text;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
begin
  if p_decision not in ('approve','reject','extend') then
    raise exception 'Unknown probation decision %', p_decision;
  end if;

  select requisition_id, candidate_id, joining_date, outcome, final_status
    into v_req, v_cand, v_join, v_outcome, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_final is not null or v_outcome is not null then
    raise exception 'The three-month decision has already been taken (%)', coalesce(v_final, v_outcome);
  end if;

  -- The decision exists to conclude the reviews. Without the month-3 review there is
  -- nothing to conclude from.
  if not exists (
    select 1 from public.fms_hr_probation_reviews r
     where r.probation_id = p_probation and r.month = 3
  ) then
    raise exception 'Record the month-3 review before taking the final decision';
  end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to decide this probation — that is the hiring manager''s call';
  end if;

  if p_decision = 'approve' then
    if p_permanent_from is null then
      raise exception 'Give the date this person becomes permanent';
    end if;
    if coalesce(trim(p_employee_code), '') = '' then
      raise exception 'Give the final employee ID';
    end if;

    update public.fms_hr_probations set
      outcome         = 'approved',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = nullif(trim(p_remarks), ''),
      final_status    = 'approved',
      final_status_at = now(),
      permanent_from  = p_permanent_from,
      employee_code   = trim(p_employee_code)
    where id = p_probation;

  elsif p_decision = 'reject' then
    if coalesce(trim(p_remarks), '') = '' then
      raise exception 'Say why probation was not cleared';
    end if;

    -- NOTE the deliberate absence of fms_hr_sync_requisition_fill(v_req) here. This
    -- person joined and filled the seat; the vacancy that hired them is closed and
    -- stays closed. Replacing them is a new MRF, not a reopened old one.
    update public.fms_hr_probations set
      outcome         = 'rejected',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = trim(p_remarks),
      final_status    = 'rejected',
      final_status_at = now()
    where id = p_probation;

  else -- extend
    update public.fms_hr_probations set
      outcome         = 'extended',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = nullif(trim(p_remarks), '')
    where id = p_probation;
  end if;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation,
    case p_decision when 'approve' then 'confirmed' when 'reject' then 'rejected' else 'extended' end,
    coalesce(v_name, 'The new hire') || ' — probation '
      || case p_decision
           when 'approve' then 'cleared; permanent from ' || to_char(p_permanent_from, 'DD-MM-YYYY')
           when 'reject'  then 'not cleared: ' || trim(p_remarks)
           else 'extended by one month; the Month-4 review is due '
                || to_char(public.fms_hr_add_months(v_join, 4), 'DD-MM-YYYY')
         end
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('onboarding')
  );
end $$;
grant execute on function public.fms_hr_decide_probation(uuid, text, text, date, text) to authenticated;

-- ===========================================================================
-- RPC — the decision after the extra month: approve or reject. No third extension.
-- ===========================================================================
drop function if exists public.fms_hr_decide_extension(uuid, text, text, date, text);
create or replace function public.fms_hr_decide_extension(
  p_probation      uuid,
  p_decision       text,
  p_remarks        text default '',
  p_permanent_from date default null,
  p_employee_code  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_outcome text;
  v_ext     text;
  v_final   text;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
begin
  if p_decision not in ('approve','reject') then
    raise exception 'An extended probation ends in approve or reject — it cannot be extended again';
  end if;

  select requisition_id, candidate_id, outcome, extension_outcome, final_status
    into v_req, v_cand, v_outcome, v_ext, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_outcome is distinct from 'extended' then
    raise exception 'This probation was not extended — use the three-month decision';
  end if;
  if v_final is not null or v_ext is not null then
    raise exception 'The extended probation has already been decided (%)', coalesce(v_final, v_ext);
  end if;

  if not exists (
    select 1 from public.fms_hr_probation_reviews r
     where r.probation_id = p_probation and r.month = 4
  ) then
    raise exception 'Record the month-4 review before closing the extended probation';
  end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to decide this probation — that is the hiring manager''s call';
  end if;

  if p_decision = 'approve' then
    if p_permanent_from is null then
      raise exception 'Give the date this person becomes permanent';
    end if;
    if coalesce(trim(p_employee_code), '') = '' then
      raise exception 'Give the final employee ID';
    end if;

    update public.fms_hr_probations set
      extension_outcome    = 'approved',
      extension_outcome_at = now(),
      extension_outcome_by = v_uid,
      extension_remarks    = nullif(trim(p_remarks), ''),
      final_status         = 'approved',
      final_status_at      = now(),
      permanent_from       = p_permanent_from,
      employee_code        = trim(p_employee_code)
    where id = p_probation;

  else
    if coalesce(trim(p_remarks), '') = '' then
      raise exception 'Say why the extended probation was not cleared';
    end if;

    -- Same rule as the three-month rejection: the seat was filled, so the requisition
    -- is not touched.
    update public.fms_hr_probations set
      extension_outcome    = 'rejected',
      extension_outcome_at = now(),
      extension_outcome_by = v_uid,
      extension_remarks    = trim(p_remarks),
      final_status         = 'rejected',
      final_status_at      = now()
    where id = p_probation;
  end if;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation,
    case p_decision when 'approve' then 'confirmed' else 'rejected' end,
    coalesce(v_name, 'The new hire') || ' — extended probation '
      || case p_decision
           when 'approve' then 'cleared; permanent from ' || to_char(p_permanent_from, 'DD-MM-YYYY')
           else 'not cleared: ' || trim(p_remarks)
         end
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('onboarding')
  );
end $$;
grant execute on function public.fms_hr_decide_extension(uuid, text, text, date, text) to authenticated;
