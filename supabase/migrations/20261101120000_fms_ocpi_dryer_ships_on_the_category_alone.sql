-- OCPI-14a · the Dryer row in Shipment & invoice follows the CATEGORY alone.
--
-- 🔴 THE BUG, reported by Ritesh Bhai on sight: pick machine category = Direct
--    and the Shipment & invoice table shows four rows, not five. The Dryer row
--    is missing until a DRYER CATEGORY (Indian / Chinese) is also picked.
--
--    That is because every dryer column — the detail fields AND the six shipment
--    columns — shared one variable, `v_has_dryer`, which is three terms:
--
--        the machine category carries a dryer
--        AND a dryer category has been picked
--        AND that dryer category does not mean "no dryer"
--
--    The middle term is right for the DETAILS: you cannot name a dryer, or count
--    its chambers, inside a category nobody has chosen. It is wrong for the
--    SHIPMENT row, which asks how the dryer travels and whether it is billed
--    separately — questions that make sense the moment the deal is known to
--    carry a dryer at all.
--
-- ⚠ THE THIRD TERM SURVIVES, and that is not an oversight. OCPI-8 item 1.5 was
--   an explicit client decision on 01-Sep-2026: picking the dryer category that
--   MEANS there is no dryer must hide the Shipment & invoice row too. So:
--
--        Direct, no dryer category yet   -> row SHOWN   (this fix)
--        Direct, "Not Applicable"        -> row HIDDEN  (OCPI-8, preserved)
--        Direct, Indian / Chinese        -> row SHOWN
--        Sublimation / Other / POD       -> row HIDDEN
--
-- ⚠ BOTH ENGINES OR NEITHER. Showing the row in the browser while this function
--   still cleared it on `v_has_dryer` would mean the server erased the six
--   answers on every save — the module's defining failure mode. `branching.ts`
--   gains the matching `hasDryerShipment` in the same commit.
--
-- ⚠ THE BODY IS TRANSFORMED, NOT RETYPED. This rewrites the LIVE definition in
--   place: it reads pg_get_functiondef, asserts each anchor appears exactly
--   once, substitutes, and asserts the result. A hand-copied 400-line function
--   is how a body drifts from what is actually running. It is also idempotent in
--   the only way that matters — re-running it finds no anchors and raises.

begin;

do $mig$
declare
  v_src text := pg_get_functiondef('public.fms_ocpi_write_oc(uuid,jsonb)'::regprocedure);
  v_new text;
  v_n   integer;
begin
  v_new := v_src;

  -- 1 · the new variable, declared beside the flag it is derived from.
  v_new := replace(v_new,
    'v_shows_dryer     boolean;',
    'v_shows_dryer     boolean;' || chr(10) ||
    '  -- OCPI-14a · the SHIPMENT half of the dryer question. Two terms, not' || chr(10) ||
    '  -- three: it does NOT wait for a dryer category to be picked, because how' || chr(10) ||
    '  -- a dryer ships is answerable the moment the deal is known to carry one.' || chr(10) ||
    '  -- It still obeys a category that MEANS no dryer (OCPI-8 item 1.5).' || chr(10) ||
    '  v_dryer_ships boolean;');

  -- 2 · the assignment, immediately after v_has_dryer's.
  v_new := replace(v_new,
    'and coalesce(v_no_dryer, false) = false;',
    'and coalesce(v_no_dryer, false) = false;' || chr(10) || chr(10) ||
    '  v_dryer_ships := coalesce(v_shows_dryer, false)' || chr(10) ||
    '                   and coalesce(v_no_dryer, false) = false;');

  -- 3 · the six shipment columns move onto it. Each search string carries its
  --     own column name, so none of them can match a detail line by accident.
  v_new := replace(v_new, 'dryer_ship_mode        = case when not v_has_dryer',
                          'dryer_ship_mode        = case when not v_dryer_ships');
  v_new := replace(v_new, 'dryer_ship_via         = case when not v_has_dryer',
                          'dryer_ship_via         = case when not v_dryer_ships');
  v_new := replace(v_new, 'dryer_separate_invoice = case when not v_has_dryer',
                          'dryer_separate_invoice = case when not v_dryer_ships');
  v_new := replace(v_new, 'dryer_invoice_qty      = case when not v_has_dryer',
                          'dryer_invoice_qty      = case when not v_dryer_ships');
  v_new := replace(v_new, 'dryer_invoice_amount   = case when not v_has_dryer',
                          'dryer_invoice_amount   = case when not v_dryer_ships');
  v_new := replace(v_new, 'dryer_invoice_subtotal = case when not v_has_dryer',
                          'dryer_invoice_subtotal = case when not v_dryer_ships');

  if v_new = v_src then raise exception 'OCPI-14a: no substitution happened'; end if;

  select count(*) into v_n from regexp_matches(v_new, 'v_dryer_ships', 'g');
  if v_n <> 8 then
    raise exception 'OCPI-14a: expected 8 uses of v_dryer_ships (decl, assign, 6 columns), found %', v_n;
  end if;

  execute v_new;
end $mig$;

do $check$
declare
  v_oc text := pg_get_functiondef('public.fms_ocpi_write_oc(uuid,jsonb)'::regprocedure);
  v_n  integer;
begin
  select count(*) into v_n from regexp_matches(v_oc, 'v_dryer_ships', 'g');
  if v_n <> 8 then raise exception 'OCPI-14a assertion 1: expected 8 uses of v_dryer_ships, found %', v_n; end if;

  -- The DETAIL columns must still wait for a dryer category: name, chambers,
  -- heating mode, warranty, included, and the price derivation, plus the
  -- declaration and the assignment.
  select count(*) into v_n from regexp_matches(v_oc, 'v_has_dryer', 'g');
  if v_n <> 8 then raise exception 'OCPI-14a assertion 2: expected 8 uses of v_has_dryer, found %', v_n; end if;

  if v_oc not like '%v_dryer_ships := coalesce(v_shows_dryer, false)%' then
    raise exception 'OCPI-14a assertion 3: the shipment gate is not derived from shows_dryer';
  end if;
  if v_oc like '%v_dryer_ships := coalesce(v_shows_dryer, false)
                   and v_dryer_cat is not null%' then
    raise exception 'OCPI-14a assertion 4: the shipment gate still waits for a dryer category';
  end if;

  if v_oc not like '%v_value + coalesce(v_gst, 0)%' then
    raise exception 'OCPI-14a assertion 5: total_inr changed shape';
  end if;
end $check$;

commit;
