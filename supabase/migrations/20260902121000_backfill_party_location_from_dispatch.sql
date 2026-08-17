-- ===========================================================================
-- CENTRAL MASTERS — give customers back the delivery location Dispatch knows.
--
-- WHY THIS IS NOT A SYNC
--   Tally has no concept of "where this customer takes delivery". It is our
--   knowledge, typed by the Dispatch team over years: 291 of their 326 customers
--   carry one, across 34 places (PANDESARA 43, SACHIN 38, UDHNA 29, …). The
--   column already exists on mst_parties and is PORTAL-OWNED — masters-sync
--   names it in its never-touch list — so a value put here survives every pull.
--
--   Losing it at cutover would be losing real work, so it moves now, ahead of
--   Phase 1, where it can be looked at in the Masters screen and corrected.
--
-- HOW ROWS ARE MATCHED
--   By name, punctuation and spacing ignored ("A.N. CREATIONS" = "AN CREATIONS").
--   272 of the 291 match, filling 604 mst_parties rows — more rows than customers
--   because a firm is a separate LEDGER PER COMPANY in Tally, and the place they
--   take delivery is the same whichever of our companies invoices them.
--
--   The 19 that do not match are left alone ON PURPOSE. They are genuine spelling
--   drift ("A N CREATION" vs "A.N. CREATIONS", "JINDAL TEXOFAB LTD") and two of
--   our own companies trading with each other. Guessing at them here would write
--   a wrong location under a right-looking name; they belong to the reconcile
--   screen, where a human confirms the pairing, and Phase 1 carries their
--   location across on the id.
--
-- WHAT IT CANNOT DAMAGE
--   * fms_dispatch_customers is only READ. Not one write touches Dispatch.
--   * Only rows where location IS NULL are filled — nothing is overwritten.
--     Every customer is null today, so this run fills and replaces nothing.
--   * A name that maps to two different locations is SKIPPED, not resolved by
--     picking one (there are none today; this keeps a re-run honest).
--   * mst_parties is read by no module yet — every row's `modules` is empty.
--
-- Reversal:
--   update public.mst_parties set location = null where is_customer;
--   -- (safe only while no one has typed a location by hand — check
--   --  updated_at against this migration's date before running it)
-- ===========================================================================

do $backfill$
declare
  v_before   integer;
  v_filled   integer;
  v_dispatch integer;
  v_stray    integer;
begin
  select count(*) into v_dispatch from public.fms_dispatch_customers;
  select count(*) into v_before from public.mst_parties where is_customer and location is not null;

  with src as (
    select k, min(loc) as loc
      from (
        select regexp_replace(upper(trim(name)), '[^A-Z0-9]', '', 'g') as k,
               upper(trim(location))                                  as loc
          from public.fms_dispatch_customers
         where nullif(trim(location), '') is not null
      ) t
     group by k
    -- One name, one location, or we do not touch it.
    having count(distinct loc) = 1
  )
  update public.mst_parties p
     set location = src.loc
    from src
   where p.is_customer
     and p.location is null
     and regexp_replace(upper(trim(p.name)), '[^A-Z0-9]', '', 'g') = src.k;

  get diagnostics v_filled = row_count;

  -- Dispatch must be exactly as we found it.
  if (select count(*) from public.fms_dispatch_customers) <> v_dispatch then
    raise exception 'party location: fms_dispatch_customers changed (% -> %) - this migration only reads it',
      v_dispatch, (select count(*) from public.fms_dispatch_customers);
  end if;

  -- Nothing that already had a location may have moved.
  if (select count(*) from public.mst_parties where is_customer and location is not null) <> v_before + v_filled then
    raise exception 'party location: filled count does not reconcile - an existing value was overwritten';
  end if;

  -- Every value written must be one Dispatch actually holds; a typo in the
  -- normalisation would show up here as an invented place name.
  select count(*) into v_stray
    from public.mst_parties p
   where p.is_customer and p.location is not null
     and not exists (
       select 1 from public.fms_dispatch_customers d
        where upper(trim(d.location)) = p.location);
  if v_stray > 0 then
    raise exception 'party location: % row(s) carry a location Dispatch does not have', v_stray;
  end if;

  raise notice 'party location: filled % customer row(s) from % Dispatch customers', v_filled, v_dispatch;
end $backfill$;


comment on column public.mst_parties.location is
  'Where the CUSTOMER takes delivery (PANDESARA, SACHIN, LUDHIANA) - not one of our sites, which are mst_locations. Portal-owned: typed here, never written by masters-sync. Seeded from fms_dispatch_customers.location.';
