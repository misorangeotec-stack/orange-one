-- ===========================================================================
-- TRAVEL DESK FMS — DEMO TEARDOWN.
--
-- Removes EXACTLY what fms_travel_demo_seed.sql created, and nothing else.
--
-- THE SCOPE IS TWO PREDICATES, because a demo trip can be identified two ways:
--
--   trip_no like 'TRV-DEMO-%'                    — the twenty submitted trips
--   purpose_other_remarks like '%[TRV-DEMO-DRAFT]%' — the one draft
--
-- The draft carries no number because numbers are minted on SUBMIT — that is the
-- whole point of a draft, and the seed did not fake one just to make deletion
-- easier. It is marked in its purpose remarks instead, which is a field the
-- screen was always going to show.
--
-- Passengers, legs, claim lines and DA days all hang off a trip by
-- ON DELETE CASCADE, so deleting those twenty-one rows removes the whole demo.
-- The activity trail and the notifications do NOT cascade (they are keyed by a
-- loose entity_id with no FK), so their ids are collected BEFORE the delete and
-- removed by id.
--
-- It cannot touch real travel data: a real trip is numbered TRV-<FY>-nnnn and
-- can never match 'TRV-DEMO-%'.
--
-- It also removes the THREE MASTER REQUESTS the seed raised — and only those:
-- they carry `proposed_payload->>'_demo' = 'travel'`, so a real request from a
-- real person is never touched, even if it proposes the same name.
--
-- ⚠ WHAT IT DELIBERATELY DOES *NOT* REMOVE, because it is master data the
--   module needs rather than demo content:
--     • fms_travel_hotels            (13 rows — the master was empty before)
--     • fms_travel_bus_operators     (5 rows — likewise)
--     • fms_travel_employee_settings (a base city per demo traveller)
--   Clear those by hand as well if you want the module back to bare:
--     delete from public.fms_travel_hotels;
--     delete from public.fms_travel_bus_operators;
--     delete from public.fms_travel_employee_settings;
--   (Do the hotels AFTER the trips, or a leg still referencing one will hold it.
--    fms_travel_legs.hotel_id is ON DELETE SET NULL, so it would not error — it
--    would quietly blank the hotel on a live booking.)
--
-- ⚠ THE COUNTER IS NOT TOUCHED. The seed already wound the TRV-<FY> series back
--   to the highest number a REAL trip holds, so there is nothing here to undo —
--   and re-deriving it after the demo rows are gone would be the same answer.
--
--   psql "$SUPABASE_DB_URL" -f supabase/seed/fms_travel_demo_teardown.sql
-- ===========================================================================

do $teardown$
declare
  v_trips  uuid[];
  v_pax    integer;
  v_legs   integer;
  v_lines  integer;
  v_da     integer;
  v_act    integer;
  v_note   integer;
  v_reqs   integer;
begin
  select coalesce(array_agg(id), '{}') into v_trips
    from public.fms_travel_trips
   where trip_no like 'TRV-DEMO-%'
      or purpose_other_remarks like '%[TRV-DEMO-DRAFT]%';

  -- The master requests go even if the trips are already gone — they are the
  -- other half of the demo, and leaving a stray "Airport lounge access" sitting
  -- in somebody's review queue after a teardown is exactly the kind of residue
  -- this file exists to prevent.
  delete from public.fms_travel_master_requests where proposed_payload->>'_demo' = 'travel';
  get diagnostics v_reqs = row_count;

  if cardinality(v_trips) = 0 then
    raise notice 'No Travel Desk demo trips found (no TRV-DEMO-%% rows and no marked draft). Removed % demo master request(s).', v_reqs;
    return;
  end if;

  select count(*) into v_pax   from public.fms_travel_passengers  where trip_id = any(v_trips);
  select count(*) into v_legs  from public.fms_travel_legs        where trip_id = any(v_trips);
  select count(*) into v_lines from public.fms_travel_claim_lines where trip_id = any(v_trips);
  select count(*) into v_da    from public.fms_travel_da_days     where trip_id = any(v_trips);

  -- Every Travel Desk activity and notification is keyed on the TRIP — the
  -- module has no satellite entity that raises its own events, unlike HR Exit —
  -- so one predicate covers both.
  delete from public.fms_travel_notifications where entity_id = any(v_trips);
  get diagnostics v_note = row_count;
  delete from public.fms_travel_activity where entity_id = any(v_trips);
  get diagnostics v_act = row_count;

  -- One delete. Passengers, legs, claim lines and DA days cascade with it.
  delete from public.fms_travel_trips where id = any(v_trips);

  raise notice 'Travel Desk demo removed: % trips, % passengers, % legs, % claim lines, % DA days, % activity rows, % notifications, % master requests.',
    cardinality(v_trips), v_pax, v_legs, v_lines, v_da, v_act, v_note, v_reqs;
  raise notice 'Hotels, bus operators and per-employee base cities were left in place (master data, not demo content). The TRV counter was already handed back by the seed.';
end $teardown$;
