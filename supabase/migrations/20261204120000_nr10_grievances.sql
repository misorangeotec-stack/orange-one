-- ===========================================================================
-- NR-10 · Employee concerns and grievances  (KPI 1C.6 — closed within 24 hours)
--
-- The client has a fixed FORM for this and will send it. Rather than wait, the
-- register is built now and the form's own questions land later in `answers`
-- (jsonb) — no migration, no rebuild. What is fixed here is only what a
-- grievance IS: somebody raised it, when, what about, and whether it was closed
-- inside a day.
--
-- 🔴 THE READ GATE IS NARROWER THAN THE REST OF THE MODULE, ON PURPOSE.
-- Every other probation row is readable by whoever can read the requisition —
-- which includes the HIRING MANAGER. A grievance may be ABOUT the hiring
-- manager. Routing it through the same gate would show the manager the
-- complaint against them, so this table is visible to the raiser, to HR (the
-- owners of the onboarding step), and to admins. Nobody else, ever.
--
-- ADDITIVE ONLY: one new table and two new functions.
-- ===========================================================================

create table if not exists public.fms_hr_grievances (
  id           uuid primary key default gen_random_uuid(),
  raised_by    uuid not null,
  -- Optional: a concern can be about the job generally rather than a probation.
  probation_id uuid references public.fms_hr_probations(id) on delete set null,
  raised_at    timestamptz not null default now(),

  category     text not null check (category in ('work', 'manager', 'team', 'facilities', 'pay', 'other')),
  body         text not null,
  -- The client's form, whenever it arrives. Shape deliberately unconstrained.
  answers      jsonb not null default '{}'::jsonb,

  status       text not null default 'open' check (status in ('open', 'closed')),
  closed_at    timestamptz,
  closed_by    uuid,
  resolution   text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.fms_hr_grievances is
  'NR-10 / KPI 1C.6. Concerns raised by a new joiner, closed within 24 hours of reporting. READ GATE IS DELIBERATELY NARROW: the raiser, HR (owners of the onboarding step) and admins - never the hiring manager, because the grievance may be about them.';
comment on column public.fms_hr_grievances.answers is
  'The client''s own grievance form, question by question. Empty until they send it; adding it needs no migration.';

create index if not exists fms_hr_grievances_open_idx
  on public.fms_hr_grievances (raised_at) where status = 'open';

alter table public.fms_hr_grievances enable row level security;

-- "HR" here means the owners of the onboarding step - the two people who actually
-- run joining - rather than fms_hr_is_recruitment_staff, which is any step owner
-- at all and now includes the heads of department who own the check-in steps.
create or replace function public.fms_hr_may_see_grievances(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select p_uid is not null
     and (
       public.is_admin(p_uid)
       or exists (
         select 1 from public.fms_hr_step_owners o
          where o.step_key = 'onboarding' and p_uid = any(o.employee_ids)
       )
     );
$fn$;

revoke all on function public.fms_hr_may_see_grievances(uuid) from public;
grant execute on function public.fms_hr_may_see_grievances(uuid) to authenticated, service_role;

drop policy if exists fms_hr_grievances_select on public.fms_hr_grievances;
create policy fms_hr_grievances_select
  on public.fms_hr_grievances for select
  using (raised_by = auth.uid() or public.fms_hr_may_see_grievances(auth.uid()));

drop policy if exists fms_hr_grievances_write_admin on public.fms_hr_grievances;
create policy fms_hr_grievances_write_admin
  on public.fms_hr_grievances for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.fms_hr_grievances to authenticated;

-- ── raising one ────────────────────────────────────────────────────────────
-- Anybody signed in may raise a concern about themselves. It is not gated on
-- being a new joiner: somebody two years in with a problem should not be told
-- the form is not for them.

create or replace function public.fms_hr_raise_grievance(
  p_category text,
  p_body     text,
  p_answers  jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_prob uuid;
  v_id   uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_category not in ('work', 'manager', 'team', 'facilities', 'pay', 'other') then
    raise exception 'Unknown category %', p_category;
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Say what the concern is';
  end if;

  -- Attach it to their open probation when they have one, so HR sees it in
  -- context. A concern from anybody else simply has no probation attached.
  select p.id into v_prob
    from public.fms_hr_probations p
    join public.fms_hr_onboardings o on o.id = p.onboarding_id
   where o.employee_user_id = v_uid and p.final_status is null
   limit 1;

  insert into public.fms_hr_grievances (raised_by, probation_id, category, body, answers)
  values (v_uid, v_prob, p_category, trim(p_body), coalesce(p_answers, '{}'::jsonb))
  returning id into v_id;

  -- HR is told at once: the clock on this line is 24 HOURS, so a notice that
  -- waits for somebody to open a screen is already most of the budget.
  perform public.fms_hr_announce(
    'probation', v_prob, 'grievance_raised',
    'A concern has been raised — it is due to be closed within 24 hours',
    public.fms_hr_step_owner_ids('onboarding')
  );

  return v_id;
end
$fn$;

grant execute on function public.fms_hr_raise_grievance(text, text, jsonb) to authenticated;

-- ── closing one ────────────────────────────────────────────────────────────

create or replace function public.fms_hr_close_grievance(p_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_st  text;
begin
  select status into v_st from public.fms_hr_grievances where id = p_id for update;
  if v_st is null then raise exception 'Concern not found'; end if;
  if v_st = 'closed' then raise exception 'This concern is already closed'; end if;

  -- Only HR closes one. The raiser cannot close their own, or "resolved" would
  -- mean nothing more than "they stopped asking".
  if not public.fms_hr_may_see_grievances(v_uid) then
    raise exception 'Only HR can close a concern';
  end if;
  if coalesce(trim(p_resolution), '') = '' then
    raise exception 'Say what was done about it';
  end if;

  update public.fms_hr_grievances
     set status = 'closed', closed_at = now(), closed_by = v_uid,
         resolution = trim(p_resolution), updated_at = now()
   where id = p_id;
end
$fn$;

grant execute on function public.fms_hr_close_grievance(uuid, text) to authenticated;

-- ── the raiser's own list, and HR's ────────────────────────────────────────
-- A definer read for the joiner's page, so it needs no table access of its own
-- and can carry the raiser's NAME for HR without exposing the profiles table.

create or replace function public.fms_hr_grievances_for_me()
returns table (
  id         uuid,
  raised_at  timestamptz,
  category   text,
  body       text,
  status     text,
  closed_at  timestamptz,
  resolution text
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select g.id, g.raised_at, g.category, g.body, g.status, g.closed_at, g.resolution
    from public.fms_hr_grievances g
   where g.raised_by = auth.uid()
   order by g.raised_at desc;
$fn$;

grant execute on function public.fms_hr_grievances_for_me() to authenticated;
