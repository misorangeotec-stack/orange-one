-- ROLLBACK for 20261127123000_cc1_fms_rank_for_all_staff.sql — the ranking is again
-- readable only by admins and holders of the FMS Control Center module.
create or replace function public.fms_rank_can_view(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and public.is_staff(p_uid)
     and (public.is_admin(p_uid) or public.module_level(p_uid, 'fms-control-center') <> 'none');
$$;
