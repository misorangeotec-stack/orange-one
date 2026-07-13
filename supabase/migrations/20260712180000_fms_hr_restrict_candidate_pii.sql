-- HR Recruitment — close a candidate-PII read hole.
--
-- THE HOLE
-- fms_hr_can_read_requisition() granted blanket read to fms_hr_is_any_step_owner(),
-- i.e. anyone listed as an owner of ANY step. But the `mrf` step is exactly where
-- DEPARTMENT HODS are listed — that is how a department head earns the right to raise
-- a requisition. So raising requisitions silently also bought them read access to every
-- candidate on every OTHER department's vacancies: names, phones, CVs, salary
-- expectations. A Sales HOD could read the Purchase team's applicants.
--
-- That is not what this app promised. The plan is explicit: candidates, resumes and
-- salary are visible ONLY to admins, HR step owners, process coordinators, and the
-- requisition's OWN hiring manager. A department head is not HR.
--
-- THE FIX
-- Split "works in recruitment" from "is allowed to raise a requisition". Read access
-- now needs ownership of a step OTHER than `mrf`. A requester/hiring manager keeps full
-- access to their OWN requisitions through the existing per-row clause below, so nobody
-- loses sight of their own vacancy — they simply stop seeing everyone else's applicants.
--
-- fms_hr_is_any_step_owner() is deliberately left alone: the frontend uses it for "does
-- this user work in recruitment at all", which decides whether to show the app's nav.
-- An MRF raiser SHOULD still see the app — just not other people's candidates.

create or replace function public.fms_hr_is_recruitment_staff(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_step_owners o
    where p_uid = any(o.employee_ids)
      -- `mrf` = "may raise a requisition", which every department head holds.
      -- It is not a claim to work in recruitment, so it grants no read over candidates.
      and o.step_key <> 'mrf'
  );
$$;

grant execute on function public.fms_hr_is_recruitment_staff(uuid) to authenticated;

comment on function public.fms_hr_is_recruitment_staff(uuid) is
  'Works in recruitment — owns a real recruitment step. Excludes `mrf`, which merely licenses a department head to raise a requisition.';

create or replace function public.fms_hr_can_read_requisition(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_hr_is_coordinator(p_uid)
      or public.fms_hr_is_recruitment_staff(p_uid)
      or exists (
        select 1 from public.fms_hr_requisitions r
        where r.id = p_req
          and (r.requester_id = p_uid or p_uid = any(r.hiring_manager_ids) or p_uid = any(r.reporting_to_ids))
      );
$$;

grant execute on function public.fms_hr_can_read_requisition(uuid, uuid) to authenticated;
