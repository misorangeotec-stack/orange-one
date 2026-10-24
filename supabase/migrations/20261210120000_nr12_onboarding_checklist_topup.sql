-- NR-12 — a checklist item added in Setup reaches the onboardings already running.
--
-- Found while building the HR trial record: the demo onboarding showed NINE items
-- where the guide says ten. `reference_check` was added by NR-8 on 21-09-2026, and
-- that onboarding was created on 02-09-2026, so it never got it — and never would.
--
-- `fms_hr_set_onboarding_date` seeds the checklist behind `if v_seeded = 0`, which
-- means ONCE, at the moment the joining date is first set. The insert underneath it
-- already carries `on conflict (onboarding_id, item_key) do nothing`, so the gate was
-- never what made it safe — it is only what stopped it topping up.
--
-- The consequence is the one the client named: a step stuck behind an admin. HR adds
-- an item in Setup → Onboarding Items, it appears on nothing that is already in
-- flight, and nobody is told. The item silently applies to next month's joiners only.
--
-- So: one function that inserts MISSING active items, and a statement trigger on the
-- master that runs it. Adding or re-activating an item now lands on every onboarding
-- that is still open.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   • It never UPDATES an existing check row. A check snapshots the item's name,
--     description and due_days as they stood; renaming a master item afterwards must
--     not rewrite history on an onboarding somebody has already worked.
--   • It never touches a COMPLETED onboarding. That person has joined; re-opening
--     their checklist would take a finished record back to "9 of 10 done" and, worse,
--     it is the completion of the last item that opens probation.
--   • It never touches a declined / no-show offer, and never one with no joining date
--     — the checklist is unlocked BY the joining date, and every item's due date is
--     computed from it. Seeding early would show due dates derived from a date nobody
--     has agreed.

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

revoke all on function public.fms_hr_sync_onboarding_checks(uuid) from public;
grant execute on function public.fms_hr_sync_onboarding_checks(uuid) to authenticated;

comment on function public.fms_hr_sync_onboarding_checks(uuid) is
  'NR-12 — add any ACTIVE onboarding item missing from an open onboarding (all of them when p_onb is null). Never updates or removes; never touches a completed onboarding.';

-- The master is written directly under RLS from Setup, not through an RPC, so the
-- hook has to be a trigger. Statement-level: one INSERT .. SELECT covers every
-- onboarding at once, whether the statement touched one master row or twenty.
create or replace function public.fms_hr_onboarding_items_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.fms_hr_sync_onboarding_checks(null);
  return null;
end $function$;

drop trigger if exists fms_hr_onboarding_items_sync_aiu on public.fms_hr_onboarding_items;
create trigger fms_hr_onboarding_items_sync_aiu
after insert or update on public.fms_hr_onboarding_items
for each statement execute function public.fms_hr_onboarding_items_sync();

-- …and the seeding path itself tops up instead of seeding once. Everything else in
-- this function is unchanged, character for character.
create or replace function public.fms_hr_set_onboarding_date(p_onb uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_req    uuid;
  v_status text;
  v_done   timestamptz;
  v_prev   date;
begin
  if p_date is null then raise exception 'A joining date is required'; end if;

  select requisition_id, offer_status, completed_at, joining_date
    into v_req, v_status, v_done, v_prev
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;
  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if v_status in ('declined','no_show') then
    raise exception 'This candidate did not join — the onboarding no longer applies';
  end if;
  if v_done is not null then
    raise exception 'This onboarding is already complete';
  end if;

  update public.fms_hr_onboardings set
    joining_date = p_date, joining_date_set_at = now(),
    joining_date_by = coalesce(joining_date_by, v_uid),
    edited_at = case when v_prev is not null then now() else edited_at end,
    edited_by = case when v_prev is not null then v_uid else edited_by end
  where id = p_onb;

  -- Was `if v_seeded = 0 then …`: seeded once, so an item added to the master after
  -- this date was first set could never arrive. The insert was always idempotent.
  perform public.fms_hr_sync_onboarding_checks(p_onb);
end $function$;

-- Backfill the onboardings that are open right now, so the fix is not only for the
-- next item somebody adds.
select public.fms_hr_sync_onboarding_checks(null);
