-- ROLLBACK for 20260908120000_fms_hr_pipeline_viewers.sql (NR-2 pipeline viewers).
--
-- Returns fms_hr_can_read_requisition() to its six pre-NR-2 arms, returns the
-- `fms hr docs read` storage policy to its two, drops the predicate, and removes the
-- config row.
--
-- ⚠ THIS IS A REVOCATION, and it revokes MORE than the migration granted if anyone has
--   been added to the list since. Everybody on `pipeline_viewers` loses candidate read
--   and CV access the moment this commits. That is the point of the file — but read the
--   list before running it:
--
--     select jsonb_pretty(value) from public.fms_hr_config where key = 'pipeline_viewers';
--
-- ⚠ ORDER MATTERS. The two policy/function bodies must stop referencing
--   fms_hr_is_pipeline_viewer BEFORE it is dropped, or the drop fails on dependency.
--
-- Safe to run against a database where the migration was never applied: every step is
-- guarded (`if exists`, and the two `create or replace` bodies are simply the current
-- ones).

begin;

-- 1. Restore the read gate to its six original arms.
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
      )
      or exists (
        select 1 from public.fms_hr_step_assignees a
         where a.requisition_id = p_req and a.assigned_to = p_uid
      )
      or exists (
        select 1
          from public.fms_hr_interviews i
          join public.fms_hr_candidates c on c.id = i.candidate_id
         where c.requisition_id = p_req and p_uid = any(i.interviewer_ids)
      );
$$;

-- 2. Restore the storage SELECT policy to its two original arms.
drop policy if exists "fms hr docs read" on storage.objects;
create policy "fms hr docs read"
  on storage.objects for select
  using (
    bucket_id = 'fms-hr-docs'
    and (
      public.fms_hr_is_coordinator(auth.uid())
      or public.fms_hr_is_any_step_owner(auth.uid())
    )
  );

-- 3. Now nothing references it.
drop function if exists public.fms_hr_is_pipeline_viewer(uuid);

-- 4. Remove the list itself, so a re-apply starts from the seeded Directors rather
--    than from whatever had accumulated.
delete from public.fms_hr_config where key = 'pipeline_viewers';

commit;
