-- ROLLBACK for 20260909120000_fms_hr_hr_can_work_the_hod_steps.sql (NR-4).
--
-- Restores fms_hr_is_natural_step_owner() to its pre-NR-4 body - the verbatim text
-- from 20260827150000_fms_hr_reassign_step.sql, where it was first and only defined.
-- The hiring managers named on the requisition become, once again, the only
-- non-admins who may act on the seven HOD/probation steps.
--
-- !! THIS IS A REVOCATION, and it revokes MORE than the migration granted if anyone
--    has been named on one of the seven steps since. Read the list before running it:
--
--      select step_key, employee_ids from public.fms_hr_step_owners
--       where step_key in ('hod_shortlist','interview_2','probation_m1','probation_m2',
--                          'probation_m3','probation_final','probation_extension');
--
-- !! IT DOES NOT UNDO THE PII GRANT, and that is the trap in this file.
--    Those fms_hr_step_owners rows are LEFT IN PLACE - deliberately, because deleting
--    them is a data change and this file only restores a function body. But a row on
--    any step except `mrf` still satisfies fms_hr_is_recruitment_staff(), which is an
--    arm of fms_hr_can_read_requisition(); and it still satisfies
--    fms_hr_is_any_step_owner(), which gates read, update AND delete on the private
--    `fms-hr-docs` bucket. So after this rollback the named people can no longer press
--    the buttons but can still read every candidate's PII and every CV.
--    To take that back too, clear the names in Setup -> Step Owners, or:
--
--      delete from public.fms_hr_step_owners
--       where step_key in ('hod_shortlist','interview_2','probation_m1','probation_m2',
--                          'probation_m3','probation_final','probation_extension');
--
-- !! NOTHING ELSE HAS TO MOVE FIRST. Unlike 20260908120000's rollback, no function is
--    dropped and no policy references anything that disappears, so there is no
--    ordering hazard: this is one `create or replace` of an existing body.
--
-- Safe to run against a database where the migration was never applied - the body
-- below is then simply the current one.

begin;

create or replace function public.fms_hr_is_natural_step_owner(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
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

comment on function public.fms_hr_is_natural_step_owner(text, uuid, uuid) is
  'Who owns this step of this requisition when nobody has been handed it - the hiring managers for the seven HOD/probation steps, the configured step owners for everything else. Deliberately excludes the admin/coordinator arm: that is authority, not ownership.';

grant execute on function public.fms_hr_is_natural_step_owner(text, uuid, uuid) to authenticated;

commit;
