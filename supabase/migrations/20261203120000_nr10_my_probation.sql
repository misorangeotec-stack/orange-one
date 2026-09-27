-- ===========================================================================
-- NR-10 · "My probation" — the new joiner's own screen.
--
-- The joiner has no hr-recruitment grant and can read neither the requisition
-- nor the probation row, so a page built on the HR module's store would show
-- them nothing. They CAN already read their own check-ins (the RLS arm added
-- with the cadence); what they cannot read is the context around them.
--
-- So: one SECURITY DEFINER read that returns exactly their own check-ins with
-- just enough context to render, and nothing about the vacancy, the salary, the
-- other candidates or the manager's own record. Widening the table policies
-- instead would have opened all of that.
--
-- ADDITIVE ONLY: one new function. No table, column, policy or existing
-- function is touched.
-- ===========================================================================

create or replace function public.fms_hr_my_probation()
returns table (
  probation_id   uuid,
  joining_date   date,
  job_title      text,
  day_no         integer,
  due_on         date,
  hod_answered   boolean,
  joiner_status  text,
  joiner_remarks text,
  joiner_at      timestamptz,
  completed_at   timestamptz,
  final_status   text
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select
    p.id,
    p.joining_date,
    r.job_title,
    k.day_no,
    k.due_on,
    k.hod_at is not null,      -- that the HOD has answered, never WHAT they said
    k.joiner_status,
    k.joiner_remarks,
    k.joiner_at,
    k.completed_at,
    p.final_status
  from public.fms_hr_probations p
  join public.fms_hr_onboardings o on o.id = p.onboarding_id
  join public.fms_hr_requisitions r on r.id = p.requisition_id
  join public.fms_hr_probation_checkins k on k.probation_id = p.id
  where o.employee_user_id = auth.uid()
  order by k.day_no;
$fn$;

grant execute on function public.fms_hr_my_probation() to authenticated;
