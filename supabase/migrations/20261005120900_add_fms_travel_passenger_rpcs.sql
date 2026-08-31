-- ===========================================================================
-- Travel Desk FMS — WRITING THE PASSENGER LIST (Phase 3).
--
-- `fms_travel_passengers` shipped in 20261005120700 with a SELECT policy and no
-- write policy at all, which is the module's standing rule: the RPC is the only
-- write door. This is that door.
--
-- ⚠ THE LIST IS REPLACED WHOLE, NOT PATCHED ROW BY ROW. A passenger list is a
--   handful of names edited together on one form, and diffing it client-side
--   would mean the browser deciding which rows to delete — which is exactly the
--   kind of decision that leaves an orphan on a ticket after somebody drops out.
--   Delete-then-insert inside one transaction is honest and cannot half-apply.
--
-- ⚠ EDITABLE AFTER SUBMIT, DELIBERATELY, unlike the request fields. The list
--   exists so an airline can be given a name, a gender and a date of birth, and
--   those are corrected at BOOKING time — a misspelt surname found by the
--   coordinator two days before departure must be fixable without cancelling an
--   approved trip. It closes only when the trip does.
--
-- Additive. Reversal:
--   drop function if exists public.fms_travel_set_passengers(uuid, jsonb);
-- ===========================================================================

begin;

create or replace function public.fms_travel_set_passengers(p_trip uuid, p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    text;
  v_owner     uuid;
  v_traveller uuid;
  v_max       int;
  v_count     int;
  v_row       jsonb;
  v_i         int := 0;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, traveller_id
    into v_status, v_owner, v_traveller
    from public.fms_travel_trips where id = p_trip for update;

  if v_status is null then raise exception 'Trip not found'; end if;

  -- A finished trip is a record, not a form.
  if v_status in ('closed', 'cancelled', 'rejected') then
    raise exception 'This trip is %, so its passenger list can no longer be changed',
      replace(v_status, '_', ' ');
  end if;

  -- Whose list this is: the person who filed it, the person travelling, the
  -- Travel Desk (who does the actual booking), or an administrator.
  if not (
       v_owner is not distinct from v_uid
    or v_traveller is not distinct from v_uid
    or public.fms_travel_is_coordinator(v_uid)
    or public.is_admin(v_uid)
  ) then
    raise exception 'You are not authorized to change this trip passenger list';
  end if;

  -- Even the people above need an edit grant on the module. Coordinators and
  -- admins are checked inside module_can_edit, so this cannot lock them out.
  if not public.module_can_edit(v_uid, 'travel-desk') then
    raise exception 'You have view-only access to Travel Desk';
  end if;

  if jsonb_typeof(p) <> 'array' then
    raise exception 'The passenger list must be an array';
  end if;

  v_count := jsonb_array_length(p);

  select coalesce((value->>'max_passengers')::int, 5) into v_max
    from public.fms_travel_config where key = 'policy';
  v_max := coalesce(v_max, 5);

  if v_count > v_max then
    raise exception 'A trip may carry at most % passengers. Raise a second request for the rest.', v_max;
  end if;

  delete from public.fms_travel_passengers where trip_id = p_trip;

  for v_row in select * from jsonb_array_elements(p) loop
    v_i := v_i + 1;

    -- A nameless passenger is not a passenger. Skipping it silently would put a
    -- blank row on a ticket; refusing tells the author which one to fix.
    if nullif(btrim(coalesce(v_row->>'full_name', '')), '') is null then
      raise exception 'Passenger % has no name', v_i;
    end if;

    insert into public.fms_travel_passengers
      (trip_id, employee_id, full_name, gender, date_of_birth, mobile, email, is_primary, sort_order)
    values (
      p_trip,
      nullif(btrim(coalesce(v_row->>'employee_id', '')), '')::uuid,
      btrim(v_row->>'full_name'),
      nullif(btrim(coalesce(v_row->>'gender', '')), ''),
      nullif(btrim(coalesce(v_row->>'date_of_birth', '')), '')::date,
      nullif(btrim(coalesce(v_row->>'mobile', '')), ''),
      nullif(btrim(coalesce(v_row->>'email', '')), ''),
      coalesce((v_row->>'is_primary')::boolean, false),
      v_i * 10
    );
  end loop;

  return v_count;
end $$;

comment on function public.fms_travel_set_passengers(uuid, jsonb) is
  'Replace a trip passenger list whole. Editable until the trip closes, because a misspelt name is found at booking time - the request fields lock at submit, this does not.';
grant execute on function public.fms_travel_set_passengers(uuid, jsonb) to authenticated;


do $mig$
begin
  if not exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname = 'fms_travel_set_passengers'
  ) then
    raise exception 'fms_travel_set_passengers did not install';
  end if;

  -- The table still has no write policy: this RPC remains the only door.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fms_travel_passengers' and cmd <> 'SELECT'
  ) then
    raise exception 'fms_travel_passengers must have no write policy - the RPC is the only door';
  end if;
end $mig$;

commit;
