-- Rollback for 20270110120000_fms_hr_onboarding_checklist_follows_master.sql
--
-- Puts fms_hr_sync_onboarding_checks back to its NR-12 body (insert missing active
-- items only). The trigger is NR-12's and is left alone.
--
-- ⚠ Not undone: the retired items this removed from open onboardings, and the
-- sort_order it copied. The removed rows were untouched (not ticked, no file, no
-- link), so nothing of record was lost; re-activating an item in Masters puts it
-- back on every open onboarding.

create or replace function public.fms_hr_sync_onboarding_checks(p_onb uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  insert into public.fms_hr_onboarding_checks (
    onboarding_id, item_id, item_key, name, description,
    requires_file, allows_link, due_days, sort_order
  )
  select o.id, i.id, i.key, i.name, i.description,
         i.requires_file, i.allows_link, i.due_days, i.sort_order
    from public.fms_hr_onboardings o
    cross join public.fms_hr_onboarding_items i
   where i.active
     and o.completed_at is null
     and o.joining_date is not null
     and coalesce(o.offer_status, '') not in ('declined', 'no_show')
     and (p_onb is null or o.id = p_onb)
   order by i.sort_order, i.name
  on conflict (onboarding_id, item_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

comment on function public.fms_hr_sync_onboarding_checks(uuid) is
  'NR-12 — add any ACTIVE onboarding item missing from an open onboarding (all of them when p_onb is null). Never updates or removes; never touches a completed onboarding.';
