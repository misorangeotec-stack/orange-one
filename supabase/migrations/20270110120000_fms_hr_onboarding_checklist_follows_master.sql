-- HR onboarding — an open onboarding's checklist follows Setup → Masters.
--
-- Found by HR: they renumbered the Onboarding Checklist (Confirmation email to 1,
-- Police verification to 4, …) and deactivated Offer letter sent / Send offer
-- confirmation / Reference check, yet every onboarding already running kept the
-- old order AND still listed the three retired items as "0 of 11 done".
--
-- Cause: fms_hr_onboarding_checks is a snapshot taken when the joining date is
-- set, and NR-12's fms_hr_sync_onboarding_checks only ever INSERTS missing active
-- items. A reorder or a deactivation never reached a running onboarding. Worse,
-- fms_hr_try_complete_onboarding needs EVERY check row ticked, so a retired item
-- left on an open onboarding blocks it from ever completing.
--
-- The sync now also, for OPEN onboardings only (same filter as NR-12):
--   • removes a check whose master item is INACTIVE, but only while it is
--     untouched: not ticked, no file, no link. Ticked work is history and stays.
--     Re-activating the item brings it back through the existing insert;
--   • copies the master's sort_order onto each check, so the order HR sets is the
--     order everyone sees — including someone who picks the onboarding up midway;
--   • tries to complete any onboarding that lost a check, in case the retired
--     item was the only thing still open.
--
-- Unchanged on purpose: name / description / due_days stay snapshotted (renaming a
-- master item must not rewrite what someone was asked for), and a completed,
-- declined or no-show onboarding is never touched. The NR-12 statement trigger on
-- fms_hr_onboarding_items already calls this function on every insert/update, so
-- a reorder or deactivation in Masters now lands everywhere with no extra hook.

create or replace function public.fms_hr_sync_onboarding_checks(p_onb uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n       integer;
  v_trimmed uuid[];
  v_onb     uuid;
begin
  -- 1. Retired items, still untouched, leave the open onboardings.
  with gone as (
    delete from public.fms_hr_onboarding_checks k
     using public.fms_hr_onboardings o, public.fms_hr_onboarding_items i
     where k.onboarding_id = o.id
       and i.id = k.item_id
       and not i.active
       and not k.done
       and k.file_path is null
       and k.link_url is null
       and o.completed_at is null
       and o.joining_date is not null
       and coalesce(o.offer_status, '') not in ('declined', 'no_show')
       and (p_onb is null or o.id = p_onb)
    returning k.onboarding_id
  )
  select array_agg(distinct onboarding_id) into v_trimmed from gone;

  -- 2. New / re-activated items arrive (NR-12, unchanged).
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

  -- 3. The order HR sets in Masters is the order an open onboarding shows.
  update public.fms_hr_onboarding_checks k
     set sort_order = i.sort_order
    from public.fms_hr_onboardings o, public.fms_hr_onboarding_items i
   where k.onboarding_id = o.id
     and i.id = k.item_id
     and k.sort_order is distinct from i.sort_order
     and o.completed_at is null
     and o.joining_date is not null
     and coalesce(o.offer_status, '') not in ('declined', 'no_show')
     and (p_onb is null or o.id = p_onb);

  -- 4. Removing the last open item may have finished an onboarding.
  foreach v_onb in array coalesce(v_trimmed, '{}'::uuid[]) loop
    perform public.fms_hr_try_complete_onboarding(v_onb);
  end loop;

  return v_n;
end $function$;

comment on function public.fms_hr_sync_onboarding_checks(uuid) is
  'Bring open onboardings in line with the master: add ACTIVE items that are missing, drop INACTIVE items nobody has touched, and copy the master order. Never renames, never touches a completed onboarding.';

-- Bring today's open onboardings in line now, not on the next Masters edit.
select public.fms_hr_sync_onboarding_checks(null);
