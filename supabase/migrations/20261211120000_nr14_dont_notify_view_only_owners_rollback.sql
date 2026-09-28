-- Rollback for 20261211120000_nr14_dont_notify_view_only_owners.sql
--
-- Puts fms_hr_step_owner_ids() back to the raw Setup list, unfiltered. View-only
-- step owners start receiving notifications again for work they cannot action.

create or replace function public.fms_hr_step_owner_ids(p_step text)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select o.employee_ids from public.fms_hr_step_owners o where o.step_key = p_step),
    '{}'::uuid[]
  );
$function$;
