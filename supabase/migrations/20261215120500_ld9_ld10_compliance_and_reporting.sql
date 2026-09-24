-- ===========================================================================
-- LEARNING & DEVELOPMENT — MANDATORY COMPLIANCE (LD-9) AND THE REPORTING
-- READ-MODEL (LD-10 / LD-11).
--
-- LD-9: POSH and Safety. Client's rule, 21-09-2026: "Everyone in the company,
-- once a year." That answer is what makes "100% of applicable participants"
-- computable at all — with no applicability rule the denominator is a guess.
--
-- LD-10/11: one function per figure the weekly report and the KPI sheet need.
-- They are SQL rather than client arithmetic for two reasons: the browser only
-- ever holds the rows RLS let it see, so a percentage computed there is a
-- percentage of what that reader can see; and the nightly KPI run has no browser
-- at all.
--
-- ⚠ EVERY FIGURE COUNTS ATTENDANCE, NOT NOMINATION. Somebody nominated to a
--   session they skipped has learned nothing, owes no assignment and has nothing
--   to say in feedback. Counting nominations would flatter every number here.
--
-- Rollback: 20261215120500_ld9_ld10_compliance_and_reporting_rollback.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- LD-9 · the mandatory programmes
-- ---------------------------------------------------------------------------
create table if not exists public.fms_ld_mandatory_programs (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  /**
   * Which session types satisfy this programme. Matched on the session type's
   * STABLE CODE, not its name — see the note on fms_ld_session_types.
   */
  session_type_code text not null,
  cycle             text not null default 'annual' check (cycle in ('annual','on_joining','both')),
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.fms_ld_mandatory_programs is
  'POSH, Safety and anything else everyone must do. Applicability is "every active internal employee", per the client 21-09-2026 — which is what makes "100% of applicable participants" a real denominator rather than a guess.';

insert into public.fms_ld_mandatory_programs (name, session_type_code, sort_order) values
  ('POSH',   'posh',   10),
  ('Safety', 'safety', 20)
on conflict (name) do nothing;

alter table public.fms_ld_mandatory_programs enable row level security;
drop policy if exists fms_ld_mandatory_programs_select on public.fms_ld_mandatory_programs;
create policy fms_ld_mandatory_programs_select on public.fms_ld_mandatory_programs
  for select to authenticated using (true);
drop policy if exists fms_ld_mandatory_programs_write on public.fms_ld_mandatory_programs;
create policy fms_ld_mandatory_programs_write on public.fms_ld_mandatory_programs
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_ld_is_coordinator(auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_ld_is_coordinator(auth.uid()));

drop trigger if exists trg_fms_ld_mandatory_programs_updated on public.fms_ld_mandatory_programs;
create trigger trg_fms_ld_mandatory_programs_updated
  before update on public.fms_ld_mandatory_programs
  for each row execute function public.set_updated_at();

/*
 * Who has done each mandatory programme this year, and who has not.
 *
 * ⚠ "DONE" MEANS ATTENDED, not nominated. A name on a list is not training.
 */
create or replace function public.fms_ld_mandatory_status(p_year integer default null)
returns table (
  program_id   uuid,
  program      text,
  applicable   integer,
  completed    integer,
  pct          numeric,
  outstanding  jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with yr as (select coalesce(p_year, extract(year from current_date)::int) as y),
  staff as (
    select p.id, p.name from public.profiles p
    where coalesce(p.is_external, false) = false
  ),
  done as (
    select m.id as program_id, att.employee_id
      from public.fms_ld_mandatory_programs m
      join public.fms_ld_session_types st on st.code = m.session_type_code
      join public.fms_ld_sessions s on st.id = any(s.session_type_ids)
      join public.fms_ld_attendance att on att.session_id = s.id
      cross join yr
     where m.active
       and att.status in ('present','partial')
       and extract(year from s.session_date)::int = yr.y
     group by m.id, att.employee_id
  )
  select
    m.id,
    m.name,
    (select count(*)::int from staff),
    (select count(*)::int from done d where d.program_id = m.id),
    case when (select count(*) from staff) = 0 then 0
         else round(100.0 * (select count(*) from done d where d.program_id = m.id)
                    / (select count(*) from staff), 1) end,
    -- Named, because "84% complete" is not actionable and a list of names is.
    coalesce((
      select jsonb_agg(jsonb_build_object('id', s2.id, 'name', s2.name) order by s2.name)
        from staff s2
       where not exists (select 1 from done d where d.program_id = m.id and d.employee_id = s2.id)
    ), '[]'::jsonb)
  from public.fms_ld_mandatory_programs m
  where m.active
  order by m.sort_order, m.name;
$$;
grant execute on function public.fms_ld_mandatory_status(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- LD-10 · the figures the weekly report's Section C needs
--
-- One call, one period. The weekly form asks for "this period" beside "month to
-- date", so both windows are parameters rather than two functions that could
-- drift apart.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_period_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with sess as (
    select * from public.fms_ld_sessions
     where session_date between p_from and p_to
       and coalesce(outcome,'') not in ('cancelled')
  ),
  att as (
    select a.* from public.fms_ld_attendance a join sess s on s.id = a.session_id
  ),
  noms as (
    select n.* from public.fms_ld_nominations n join sess s on s.id = n.session_id
     where n.status = 'approved'
  ),
  fb as (select f.* from public.fms_ld_feedback f join sess s on s.id = f.session_id),
  asg as (select a.* from public.fms_ld_assignments a join sess s on s.id = a.session_id),
  sub as (
    select v.*, a.due_at from public.fms_ld_assignment_submissions v
      join asg a on a.id = v.assignment_id
  ),
  -- ⚠ A SESSION CAN COUNT UNDER SEVERAL TYPES AT ONCE. The weekly form says so:
  --   "a technical session run by an external agency is reported under both
  --   lines and once in the Total." Hence a join per type, not a group-by.
  typed as (
    select st.code, count(distinct s.id) as n
      from sess s
      join public.fms_ld_session_types st on st.id = any(s.session_type_ids)
     group by st.code
  )
  select jsonb_build_object(
    'sessions_held',      (select count(*) from sess where outcome is not null),
    'sessions_scheduled', (select count(*) from sess),
    'total_hours',        (select coalesce(sum(hours), 0) from sess where outcome is not null),
    'participants',       (select count(*) from noms),
    'attended',           (select count(*) from att where status in ('present','partial')),
    'attendance_pct',     case when (select count(*) from noms) = 0 then null
                            else round(100.0 * (select count(*) from att where status in ('present','partial'))
                                       / (select count(*) from noms), 1) end,
    'feedback_responses', (select count(*) from fb),
    'feedback_avg',       (select round(avg(overall_rating), 2) from fb),
    'external',           coalesce((select n from typed where code = 'external_agency'), 0),
    'technical',          coalesce((select n from typed where code = 'technical'), 0),
    'internal',           coalesce((select n from typed where code = 'internal'), 0),
    'absentees',          (select count(*) from att where status = 'absent'),
    'absentees_followed_up', (select count(*) from att where status = 'absent' and followed_up_at is not null),
    'assignments_issued', (select count(*) from asg),
    -- §3 step 12: "within 1 working day of session completion". Measured against
    -- the session DATE, because that is when the clock starts.
    'assignments_within_24h', (select count(*) from asg a join sess s on s.id = a.session_id
                                where a.issued_at::date <= s.session_date + 1),
    'submissions_due',    (select count(*) from sub),
    'submissions_made',   (select count(*) from sub where submitted_at is not null),
    'submissions_on_time',(select count(*) from sub where submitted_at is not null
                             and (due_at is null or submitted_at::date <= due_at)),
    'submissions_reviewed',(select count(*) from sub where reviewed_at is not null),
    'effectiveness_due',  (select count(*) from public.fms_ld_effectiveness e
                            join sess s on s.id = e.session_id),
    'effectiveness_done', (select count(*) from public.fms_ld_effectiveness e
                            join sess s on s.id = e.session_id where e.submitted_at is not null),
    'cost',               (select coalesce(sum(actual_cost), 0) from sess)
  );
$$;
grant execute on function public.fms_ld_period_summary(date, date) to authenticated;

/*
 * Learning hours per employee for a year — C5 and SK-3 ("10 hours per employee").
 *
 * ⚠ PARTIAL ATTENDANCE COUNTS ITS MINUTES, not the session's full length. That
 *   distinction is the whole reason `minutes` exists on the attendance row; a
 *   half-attended three-hour session is not three hours of training.
 */
create or replace function public.fms_ld_learning_hours(p_year integer default null)
returns table (employee_id uuid, employee text, hours numeric, sessions integer)
language sql
stable
security definer
set search_path = public
as $$
  with yr as (select coalesce(p_year, extract(year from current_date)::int) as y)
  select p.id, p.name,
         round(coalesce(sum(
           case a.status
             when 'present' then coalesce(s.hours, 0)
             when 'partial' then coalesce(a.minutes, 0) / 60.0
             else 0 end), 0), 2),
         count(*) filter (where a.status in ('present','partial'))::int
    from public.profiles p
    left join public.fms_ld_attendance a on a.employee_id = p.id
    left join public.fms_ld_sessions s on s.id = a.session_id
     and extract(year from s.session_date)::int = (select y from yr)
   where coalesce(p.is_external, false) = false
   group by p.id, p.name
   order by 3 desc, p.name;
$$;
grant execute on function public.fms_ld_learning_hours(integer) to authenticated;

/*
 * Annual-plan adherence — the 5% KPI line.
 *
 * "Planned sessions completed as scheduled": a plan line counts as adhered to
 * when a session pointing at it was actually CONDUCTED. A line whose session was
 * scheduled and then cancelled has not been adhered to, which is the distinction
 * the whole measure exists to make.
 */
create or replace function public.fms_ld_plan_adherence(p_fy text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with plan as (
    select * from public.fms_ld_plans
     where status = 'published'
       and fy_code = coalesce(p_fy, public.fms_ld_fy_code(current_date))
     order by revision desc limit 1
  ),
  lines as (select l.* from public.fms_ld_plan_lines l join plan p on p.id = l.plan_id),
  -- Only lines whose month has ARRIVED can be adhered to or missed. Counting a
  -- line planned for March against a January score would report every new plan
  -- as failing on the day it is published.
  due as (select * from lines where planned_month <= date_trunc('month', current_date)::date),
  met as (
    select distinct l.id from due l
      join public.fms_ld_sessions s on s.plan_line_id = l.id
     where s.outcome in ('conducted','partially_conducted')
  )
  select jsonb_build_object(
    'published_at', (select published_at from plan),
    'fy_code',      (select fy_code from plan),
    'lines_total',  (select count(*) from lines),
    'lines_due',    (select count(*) from due),
    'lines_met',    (select count(*) from met),
    'adherence_pct', case when (select count(*) from due) = 0 then null
                       else round(100.0 * (select count(*) from met) / (select count(*) from due), 1) end,
    'ad_hoc_sessions', (select count(*) from public.fms_ld_sessions
                         where plan_line_id is null
                           and public.fms_ld_fy_code(session_date) = coalesce(p_fy, public.fms_ld_fy_code(current_date)))
  );
$$;
grant execute on function public.fms_ld_plan_adherence(text) to authenticated;
