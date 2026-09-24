-- Rollback for 20261210120000_nr12_onboarding_checklist_topup.sql
--
-- Removes the top-up: the trigger, its function, the sync function, and the
-- seed-once gate goes back into fms_hr_set_onboarding_date.
--
-- ⚠ Rows the top-up already inserted are NOT removed. They are ordinary checklist
-- items on live onboardings — HR may already have ticked one, and deleting a ticked
-- item would destroy a record of work done. Undo them by hand only if you are sure
-- none has been touched:
--
--   delete from public.fms_hr_onboarding_checks
--    where item_key = 'reference_check' and not done and done_at is null;

drop trigger if exists fms_hr_onboarding_items_sync_aiu on public.fms_hr_onboarding_items;
drop function if exists public.fms_hr_onboarding_items_sync();
drop function if exists public.fms_hr_sync_onboarding_checks(uuid);

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
  v_seeded integer;
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

  select count(*) into v_seeded from public.fms_hr_onboarding_checks where onboarding_id = p_onb;
  if v_seeded = 0 then
    insert into public.fms_hr_onboarding_checks (
      onboarding_id, item_id, item_key, name, description,
      requires_file, allows_link, due_days, sort_order
    )
    select p_onb, i.id, i.key, i.name, i.description,
           i.requires_file, i.allows_link, i.due_days, i.sort_order
      from public.fms_hr_onboarding_items i
     where i.active
     order by i.sort_order, i.name
    on conflict (onboarding_id, item_key) do nothing;
  end if;
end $function$;
