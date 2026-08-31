-- ===========================================================================
-- THE DAILY ALLOWANCE COULD NOT BE FROZEN THROUGH THE API.
--
-- `fms_travel_freeze_da` kept Finance's per-day overrides across a recompute by
-- parking them in a temp table:
--
--     create temp table if not exists _da_keep (...) on commit drop;
--     delete from _da_keep;                       -- <— no WHERE clause
--
-- ⚠ POSTGREST RUNS WITH `sql_safe_updates` ON, so an UPDATE or DELETE with no
--   WHERE clause is refused outright: *"DELETE requires a WHERE clause"*. Every
--   phase 7 worked example passed because they ran on a session where that
--   setting is off — so the function was correct everywhere except the one place
--   it is actually called from, and the failure surfaced only when a real
--   traveller pressed "File this claim" in the browser.
--
--   Worth stating plainly, because it generalises: a rollback-wrapped SQL test
--   run as the owner and the same code called through PostgREST as
--   `authenticated` are not the same execution environment. This is the second
--   thing in this module that only the browser pass could find.
--
-- The temp table is removed rather than given a WHERE clause. It was the wrong
-- shape anyway:
--
--   * `create temp table if not exists` inside a SECURITY DEFINER function
--     interacts with PostgREST's CONNECTION POOL — the table lives on the
--     connection, not on the call, so the `if not exists` branch is load-bearing
--     in production and never taken in a test.
--   * a `delete` + `insert` + `left join` to carry four columns across is more
--     machinery than the job needs.
--
-- The overrides are now held in a local `jsonb` for the duration of the call.
-- Same behaviour, no shared state, and nothing to clean up.
--
-- ⚠ THE OVERRIDES ARE STILL CARRIED FORWARD, which is the whole point of this
--   function and the reason it is not simply "delete and recompute". A recompute
--   after a corrected return time must not silently discard Finance's decision
--   about day 4 — that is a human judgement the engine cannot reproduce.
-- ===========================================================================
create or replace function public.fms_travel_freeze_da(p_trip uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep  jsonb;
  v_total numeric;
begin
  -- Every overridden day, keyed by the day, before anything is deleted.
  select coalesce(jsonb_object_agg(d.day::text, jsonb_build_object(
           'amount', d.override_amount,
           'reason', d.override_reason,
           'by',     d.override_by,
           'at',     d.override_at)), '{}'::jsonb)
    into v_keep
    from public.fms_travel_da_days d
   where d.trip_id = p_trip and d.override_amount is not null;

  delete from public.fms_travel_da_days where trip_id = p_trip;

  insert into public.fms_travel_da_days
    (trip_id, day, city_id, city_tier, da_rate, factor, factor_reason, amount,
     override_amount, override_reason, override_by, override_at)
  select p_trip, c.day, c.city_id, c.city_tier, c.da_rate, c.factor, c.factor_reason, c.amount,
         (v_keep -> c.day::text ->> 'amount')::numeric,
         (v_keep -> c.day::text ->> 'reason'),
         (v_keep -> c.day::text ->> 'by')::uuid,
         (v_keep -> c.day::text ->> 'at')::timestamptz
    from public.fms_travel_compute_da(p_trip) c;

  select coalesce(sum(coalesce(override_amount, amount)), 0) into v_total
    from public.fms_travel_da_days where trip_id = p_trip;

  update public.fms_travel_trips set da_total = v_total where id = p_trip;
  return v_total;
end $$;

comment on function public.fms_travel_freeze_da(uuid) is
  'Recompute and store the DA for a trip, CARRYING FORWARD any Finance override - that is a human judgement the engine cannot reproduce, and a recompute must not silently discard it. The overrides ride in a local jsonb rather than a temp table: PostgREST runs with sql_safe_updates on, so the old unqualified "delete from _da_keep" was refused on every call through the API.';
grant execute on function public.fms_travel_freeze_da(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertion: the function no longer mentions a temp table.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fms_travel_freeze_da'
       and p.prosrc ilike '%temp table%'
  ) then
    raise exception 'fms_travel_freeze_da still creates a temp table';
  end if;
end $$;

-- Reversal: re-apply 20261005121700's definition of fms_travel_freeze_da.
-- Nothing else in this migration creates or alters an object. Note that doing so
-- reintroduces the defect above.
