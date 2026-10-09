-- Rollback for 20270114120000_fms_hr_future_reference.sql
--
-- Drops the four future-reference policies, the RPC, the two predicates and the config
-- row. The three columns are dropped LAST and only after the policies that read them,
-- so the order matters. Dropping the columns discards who was saved and why — export
-- them first if the list is worth keeping.

begin;

drop policy if exists "fms hr docs read future ref" on storage.objects;
drop policy if exists fms_hr_requisitions_select_future_ref on public.fms_hr_requisitions;
drop policy if exists fms_hr_activity_select_future_ref on public.fms_hr_activity;
drop policy if exists fms_hr_candidates_select_future_ref on public.fms_hr_candidates;

drop function if exists public.fms_hr_set_future_reference(uuid, boolean, text);
drop function if exists public.fms_hr_is_future_ref_candidate(uuid);
drop function if exists public.fms_hr_is_future_ref_viewer(uuid);

delete from public.fms_hr_config where key = 'future_ref_viewers';

drop index if exists public.fms_hr_candidates_future_ref_idx;
alter table public.fms_hr_candidates drop column if exists future_ref_note;
alter table public.fms_hr_candidates drop column if exists future_ref_by;
alter table public.fms_hr_candidates drop column if exists future_ref_at;

commit;
