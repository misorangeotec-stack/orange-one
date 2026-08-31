-- ===========================================================================
-- §16 — THE LEG'S MODE AND THE RATE CARD'S NAME FOR IT ARE NOT THE SAME WORD.
--
-- `fms_travel_class_excess` built the rate type by concatenation:
--
--     l.kind || '_entitlement'
--
-- A leg's `kind` is one of flight | train | bus | cab | hotel. The rate card's
-- `rate_type` is one of air_entitlement | train_entitlement | road_entitlement.
-- Only `train` is spelt the same in both, so:
--
--   * a FLIGHT asked for `flight_entitlement`, which does not exist. It got no
--     row, so `entitled_class` came back NULL and the §16 sentence degraded to
--     the anonymous "(band entitlement)" instead of naming "Economy — Saver
--     fare" — on the one line item where naming the entitlement is the entire
--     point, because that sentence is what justifies a deduction from somebody's
--     pay.
--   * worse, a flight with NO comparable fare recorded produced NO NOTE AT ALL.
--     The "nobody has recorded what the compliant option cost, so no excess can
--     be calculated" sentence is guarded on `v_e is not null`, so the case the
--     engine was deliberately built to speak up about stayed silent.
--   * a BUS resolved nothing either — it was not in the list at all.
--
-- The mapping is now explicit rather than derived from spelling. §5 puts bus
-- with the road modes ("Auto-rickshaw / local bus / metro"), so it reads
-- road_entitlement alongside cab.
--
-- Found by the phase 7 worked examples: a Band-3 (TC-C) traveller booked in
-- Business returned an excess of 12,300.00 attributed to "the TC-C entitlement
-- (band entitlement)" — arithmetically right, and unusable as an explanation.
--
-- Nothing else changes; this is the same function with the lookup corrected.
-- ===========================================================================
create or replace function public.fms_travel_class_excess(p_trip uuid)
returns table (
  leg_id          uuid,
  kind            text,
  booked_class    text,
  entitled_class  text,
  net_cost        numeric,
  entitled_fare   numeric,
  personal_excess numeric,
  note            text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t      record;
  l      record;
  v_e    text;
  v_type text;
  v_key  text;
begin
  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then return; end if;

  for l in select * from public.fms_travel_legs where trip_id = p_trip order by sort_order loop
    v_e    := null;
    v_type := null;
    v_key  := null;

    -- The leg's mode, translated into what the rate card calls it. A hotel has
    -- no class entitlement — it has a nightly cap, which §7.2 handles in
    -- check_claim — so it deliberately maps to nothing.
    if l.kind = 'flight' then
      v_type := 'air_entitlement';   v_key := 'class';
    elsif l.kind = 'train' then
      v_type := 'train_entitlement'; v_key := 'class';
    elsif l.kind in ('cab', 'bus') then
      v_type := 'road_entitlement';  v_key := 'mode';
    end if;

    if v_type is not null then
      select rr.text_value into v_e from public.fms_travel_resolve_rate(
        t.snap_rate_card_id, v_type, t.snap_travel_category, null, v_key) rr;
    end if;

    leg_id         := l.id;
    kind           := l.kind;
    booked_class   := l.travel_class;
    entitled_class := v_e;
    net_cost       := l.net_cost;
    entitled_fare  := l.entitled_fare;

    if l.entitled_fare is not null then
      personal_excess := round(greatest(l.net_cost - l.entitled_fare, 0), 2);
      note := case
        when l.net_cost > l.entitled_fare then format(
          '§16 — booked above the %s entitlement (%s). The company reimburses %s; the difference of %s is the employee''s own.',
          t.snap_travel_category, coalesce(v_e, 'band entitlement'),
          to_char(l.entitled_fare, 'FM999999999.00'),
          to_char(l.net_cost - l.entitled_fare, 'FM999999999.00'))
        else 'Within the band entitlement.' end;
    else
      personal_excess := 0;
      note := case
        when v_e is null then null
        else format('Entitlement at %s is %s. No comparable fare has been recorded, so no §16 excess can be calculated — record what the entitled option would have cost if this was booked above it.',
                    t.snap_travel_category, v_e) end;
    end if;
    return next;
  end loop;
end $$;

comment on function public.fms_travel_class_excess(uuid) is
  '§16 - what a leg booked above the band entitlement costs the employee. The leg''s mode is translated into the rate card''s name for it (flight -> air_entitlement, cab/bus -> road_entitlement) rather than concatenated, which is what broke flights and buses. The rate card holds the entitled CLASS as words, not a price, so the excess is calculable only once somebody records what the compliant option would have cost. It says so rather than inventing the size of a salary deduction.';
grant execute on function public.fms_travel_class_excess(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertion: a flight now resolves its entitled class off the seeded card.
-- ---------------------------------------------------------------------------
do $$
declare
  v_card uuid;
  v_txt  text;
begin
  select id into v_card from public.fms_travel_rate_cards order by effective_from limit 1;
  if v_card is null then
    raise notice 'No rate card seeded; skipping the assertion.';
    return;
  end if;

  select rr.text_value into v_txt
    from public.fms_travel_resolve_rate(v_card, 'air_entitlement', 'TC-C', null, 'class') rr;

  if v_txt is null then
    raise exception 'air_entitlement/class does not resolve for TC-C - the fix would still leave flights unnamed';
  end if;
  raise notice 'TC-C air entitlement resolves as: %', v_txt;
end $$;

-- Reversal: re-apply 20261005121700's definition of fms_travel_class_excess.
-- Nothing else in this migration creates or alters an object.
