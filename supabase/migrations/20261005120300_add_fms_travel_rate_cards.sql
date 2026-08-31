-- ===========================================================================
-- Travel Desk FMS — RATE CARDS (Phase 2).
--
-- THE DOMESTIC TRAVEL POLICY, AS VERSIONED DATA.
--
-- Every figure the policy prices travel with — the hotel cap by band and city
-- tier, the daily allowance, the local conveyance cap, the per-kilometre rate,
-- the meal caps, the class of air and train travel — lives in these two tables
-- rather than in code.
--
-- WHY THAT IS NOT ABSTRACTION FOR ITS OWN SAKE
--
--   1. NOT ONE RATE IN THE POLICY IS SIGNED OFF. Roughly thirty amounts are
--      marked "[⚠ CONFIRM]", and Annexure C says in as many words: "No rate or
--      amount in this policy is final until the Directors sign off on this
--      table." A module that hardcoded any of them would be shipping a guess as
--      if it were policy.
--
--   2. §7.2 SAYS THE RATES ARE REVIEWED EVERY JANUARY. "Rates should be reviewed
--      annually in January and updated if market rates have changed
--      significantly." An annual review must be a data edit, not a deploy.
--
--   3. A TRIP MUST BE PRICED ON THE RULES THAT APPLIED WHEN IT HAPPENED. A claim
--      filed in March for March travel cannot be re-priced by an April revision.
--      So a trip FREEZES the card it was raised against (fms_travel_trips
--      .snap_rate_card_id, phase 3) and resolves against that card for ever.
--      This is the same doctrine as OCPI freezing the resolved document on each
--      quotation version: a rule change must never rewrite history.
--
-- ── THE BAND → TRAVEL CATEGORY DISPUTE LIVES HERE, DELIBERATELY ──────────────
--
-- Section 2 of the policy contains two tables, one immediately after the other,
-- that disagree about two bands:
--
--     §2 table 1, Annexure A, §14.1     band 8 → TC-A,  band 3 → TC-D
--     §2 table 2, §4.1, §5.1, §6.2,
--     §6.3, §7.2, §8.2, §10, §10.1      band 8 → TC-B,  band 3 → TC-C
--
-- Live headcount puts 17 people in band 3 and 6 in band 8 — 23 of the 59 real
-- employees, and band 3 is the field staff who travel most. Every cap, rate and
-- class rule keys off it.
--
-- So the mapping is a `band_category` rate row like any other, the two disputed
-- rows carry `disputed = true`, and — this is the point —
-- fms_travel_confirm_rate_card() REFUSES TO SIGN OFF A CARD THAT STILL HAS A
-- DISPUTED ROW ON IT. The contradiction cannot be forgotten, because nothing
-- can be made enforceable until somebody answers it.
--
-- ── WHAT "CONFIRMED" CHANGES ────────────────────────────────────────────────
-- A DRAFT card still prices everything — the module is fully usable before
-- sign-off — but the engine treats its caps as ADVISORY: a claim over cap is
-- flagged, not refused. A CONFIRMED card enforces. That is the whole difference,
-- and it is what lets the build proceed while the Directors are still deciding.
--
-- Additive. Reversal (reverse order):
--   drop function if exists public.fms_travel_confirm_rate_card(uuid);
--   drop function if exists public.fms_travel_resolve_rate(uuid,text,text,smallint,text);
--   drop function if exists public.fms_travel_current_rate_card(date);
--   drop table if exists public.fms_travel_rates;
--   drop table if exists public.fms_travel_rate_cards;
-- ===========================================================================

begin;

-- ===========================================================================
-- THE CARD — one dated version of the whole policy.
-- ===========================================================================
create table if not exists public.fms_travel_rate_cards (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  -- The date from which this card prices travel. A trip resolves the card whose
  -- effective_from is the latest one on or before its own date.
  effective_from date not null,
  status         text not null default 'draft'
                   check (status in ('draft', 'confirmed', 'superseded')),
  confirmed_by   uuid references auth.users on delete set null,
  confirmed_at   timestamptz,
  notes          text,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A confirmed card must say who confirmed it and when. Without this a row
  -- could be flipped to 'confirmed' by an UPDATE with no accountability, which
  -- on a document the Directors sign is the whole point of the status.
  constraint fms_travel_rate_cards_confirmed_is_attributed check (
    status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)
  )
);

comment on table public.fms_travel_rate_cards is
  'One dated version of the Domestic Travel Policy figures. draft = prices everything but caps only advise; confirmed = caps enforce; superseded = kept so trips frozen against it still resolve.';

create index if not exists fms_travel_rate_cards_effective_idx
  on public.fms_travel_rate_cards (effective_from desc);

drop trigger if exists trg_fms_travel_rate_cards_updated on public.fms_travel_rate_cards;
create trigger trg_fms_travel_rate_cards_updated
  before update on public.fms_travel_rate_cards
  for each row execute function public.set_updated_at();

alter table public.fms_travel_rate_cards enable row level security;

-- ⚠ READABLE BY EVERYONE SIGNED IN, and that is deliberate. An employee is
--   entitled to know what they are entitled to BEFORE they book — the whole
--   complaint about the paper process is that nobody could.
drop policy if exists fms_travel_rate_cards_select on public.fms_travel_rate_cards;
create policy fms_travel_rate_cards_select on public.fms_travel_rate_cards
  for select to authenticated using (true);

drop policy if exists fms_travel_rate_cards_write on public.fms_travel_rate_cards;
create policy fms_travel_rate_cards_write on public.fms_travel_rate_cards
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- THE ROWS — every figure on the card.
--
-- One shape holds all of them, because they are all the same question with
-- different axes: "for this travel category, in a city of this tier, what is the
-- figure for this thing?"
--
--   rate_type          what is being priced
--   travel_category    TC-A..TC-D, or NULL when the figure does not vary by band
--   city_tier          1/2/3, or NULL when it does not vary by city
--   key                a sub-dimension: 'two_wheeler', 'business', 'class', …
--   amount             the money or the number
--   text_value         the words, where the entitlement is a class not a figure
--
-- A NULL axis means "applies to all", so a rate that does not vary is one row
-- rather than twelve.
-- ===========================================================================
create table if not exists public.fms_travel_rates (
  id            uuid primary key default gen_random_uuid(),
  rate_card_id  uuid not null references public.fms_travel_rate_cards on delete cascade,
  rate_type     text not null check (rate_type in (
                  'band_category',        -- band no -> TC. The H1 dispute lives here.
                  'hotel_cap',            -- §7.2, per night incl GST
                  'da',                   -- §8.2, per day
                  'conveyance_cap',       -- §10, per day. NULL amount = no cap (TC-A)
                  'conveyance_self_dec',  -- §10, per trip without a receipt
                  'mileage',              -- §6.3, per km by vehicle type
                  'meal_cap',             -- §9, by meal kind
                  'rental_cap',           -- §10.1, full-day hire incl driver
                  'air_entitlement',      -- §4.1
                  'train_entitlement',    -- §5.1
                  'road_entitlement')),   -- §6.2
  travel_category text check (travel_category is null
                    or travel_category in ('TC-A', 'TC-B', 'TC-C', 'TC-D')),
  city_tier     smallint check (city_tier is null or city_tier in (1, 2, 3)),
  key           text,
  amount        numeric(12,2),
  text_value    text,

  -- ⚠ THE SOURCE POLICY CONTRADICTS ITSELF ON THIS ROW. Set on the band 3 and
  --   band 8 mappings; confirm_rate_card() refuses while any is still true.
  disputed      boolean not null default false,
  -- Where the figure came from, and what was proposed vs confirmed. Printed
  -- beside the cell in the editor, so nobody has to open the Word document.
  notes         text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.fms_travel_rates is
  'Every figure on one rate card. A NULL travel_category or city_tier means the figure does not vary on that axis. disputed marks a row the source policy contradicts itself on - a card cannot be confirmed while one remains.';

-- One figure per (card, type, category, tier, key). COALESCE so the NULL axes
-- participate: without it Postgres would allow two "applies to all" rows.
create unique index if not exists fms_travel_rates_slot_uniq
  on public.fms_travel_rates (
    rate_card_id, rate_type,
    coalesce(travel_category, '*'),
    coalesce(city_tier, 0),
    coalesce(key, '*')
  );

create index if not exists fms_travel_rates_card_type_idx
  on public.fms_travel_rates (rate_card_id, rate_type);

drop trigger if exists trg_fms_travel_rates_updated on public.fms_travel_rates;
create trigger trg_fms_travel_rates_updated
  before update on public.fms_travel_rates
  for each row execute function public.set_updated_at();

alter table public.fms_travel_rates enable row level security;

drop policy if exists fms_travel_rates_select on public.fms_travel_rates;
create policy fms_travel_rates_select on public.fms_travel_rates
  for select to authenticated using (true);

drop policy if exists fms_travel_rates_write on public.fms_travel_rates;
create policy fms_travel_rates_write on public.fms_travel_rates
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- WHICH CARD PRICES A TRIP TAKEN ON A GIVEN DATE.
--
-- Prefers a CONFIRMED card; falls back to the newest DRAFT so the module is
-- fully usable before the Directors have signed anything off. Without that
-- fallback nothing could be tested, and the first trip after go-live would be
-- the first trip ever priced.
-- ===========================================================================
create or replace function public.fms_travel_current_rate_card(p_on date default current_date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.fms_travel_rate_cards
   where status = 'confirmed' and effective_from <= p_on
   order by effective_from desc, created_at desc
   limit 1
$$;

comment on function public.fms_travel_current_rate_card(date) is
  'The confirmed card pricing travel on this date, or NULL if none is confirmed yet. Callers fall back to the newest draft - see fms_travel_effective_rate_card.';
grant execute on function public.fms_travel_current_rate_card(date) to authenticated;

create or replace function public.fms_travel_effective_rate_card(p_on date default current_date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fms_travel_current_rate_card(p_on),
    (select id from public.fms_travel_rate_cards
      where status = 'draft'
      order by effective_from desc, created_at desc
      limit 1)
  )
$$;

comment on function public.fms_travel_effective_rate_card(date) is
  'The card a trip raised on this date should freeze: the confirmed one if there is one, else the newest draft so the module works before sign-off. A draft card advises; only a confirmed card enforces.';
grant execute on function public.fms_travel_effective_rate_card(date) to authenticated;

create or replace function public.fms_travel_card_enforces(p_card uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status in ('confirmed', 'superseded')
       from public.fms_travel_rate_cards where id = p_card),
    false)
$$;

comment on function public.fms_travel_card_enforces(uuid) is
  'Do this card caps BLOCK, or merely advise? Only a signed-off card enforces. Superseded counts: it was confirmed when the trip froze it, and a later revision must not retroactively soften an old claim.';
grant execute on function public.fms_travel_card_enforces(uuid) to authenticated;


-- ===========================================================================
-- THE ONE LOOKUP EVERYTHING ELSE CALLS.
--
-- Resolution walks from most specific to least, so a figure that varies by tier
-- can sit beside one that does not, on the same card, without either needing to
-- know about the other:
--
--   1. exact travel_category + exact city_tier + exact key
--   2. exact travel_category + ANY tier (tier IS NULL) + exact key
--   3. ANY category (NULL) + exact tier + exact key
--   4. ANY category + ANY tier + exact key
--
-- ⚠ A NULL `amount` IS A REAL ANSWER, NOT A MISS. §10 gives TC-A "no cap;
--   actuals with receipt", which is a row that exists and deliberately holds no
--   number. Callers must distinguish "no row" (nothing configured — advise and
--   move on) from "row with a null amount" (uncapped by policy). That is why
--   this returns a ROW rather than a numeric.
-- ===========================================================================
create or replace function public.fms_travel_resolve_rate(
  p_card  uuid,
  p_type  text,
  p_tc    text     default null,
  p_tier  smallint default null,
  p_key   text     default null
)
-- ⚠ THE FIRST COLUMN IS `has_row`, NOT `found`. `found` is a PL/pgSQL special
--   variable, so `select found from fms_travel_resolve_rate(...)` inside any
--   plpgsql body raises "column reference found is ambiguous". Every consumer of
--   this function in phases 7 to 9 is plpgsql, so the name is chosen to keep
--   them all working rather than making each one alias its way out.
returns table (
  has_row    boolean,
  amount     numeric,
  text_value text,
  disputed   boolean,
  notes      text
)
language sql
stable
security definer
set search_path = public
as $$
  select true, r.amount, r.text_value, r.disputed, r.notes
    from public.fms_travel_rates r
   where r.rate_card_id = p_card
     and r.rate_type = p_type
     and (r.travel_category is not distinct from p_tc or r.travel_category is null)
     and (r.city_tier is not distinct from p_tier or r.city_tier is null)
     and (r.key is not distinct from p_key or r.key is null)
   order by
     -- most specific first
     (r.travel_category is not null) desc,
     (r.city_tier is not null) desc,
     (r.key is not null) desc
   limit 1
$$;

comment on function public.fms_travel_resolve_rate(uuid, text, text, smallint, text) is
  'Resolve one figure off a rate card, walking from most specific to least. Returns no row when nothing is configured; returns a row with a NULL amount when the policy deliberately sets no cap.';
grant execute on function public.fms_travel_resolve_rate(uuid, text, text, smallint, text) to authenticated;

-- The band -> travel category answer, as one call.
create or replace function public.fms_travel_category_for_band(p_card uuid, p_band_no integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select text_value
    from public.fms_travel_resolve_rate(p_card, 'band_category', null, null, p_band_no::text)
$$;

comment on function public.fms_travel_category_for_band(uuid, integer) is
  'Which travel category a band maps to ON THIS CARD. Bands 3 and 8 are disputed in the source policy - see the header of 20261005120300.';
grant execute on function public.fms_travel_category_for_band(uuid, integer) to authenticated;


-- ===========================================================================
-- SIGN-OFF.
--
-- ⚠ THIS IS WHERE THE POLICY'S SELF-CONTRADICTION IS FORCED INTO THE OPEN.
--   A card carrying any row still marked `disputed` CANNOT BE CONFIRMED. The
--   band 3 and band 8 mappings are seeded disputed, so travel cannot be made
--   enforceable until somebody with authority has decided which of the policy's
--   two answers is the real one — and unmarked the row by choosing.
--
--   The alternative was a comment in a document, which is exactly the failure
--   mode the whole module exists to fix.
--
-- Confirming supersedes every previously confirmed card. Superseded cards are
-- NEVER deleted: trips frozen against them resolve by id, and their figures are
-- what those claims were legitimately priced on.
-- ===========================================================================
create or replace function public.fms_travel_confirm_rate_card(p_card uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    text;
  v_label     text;
  v_disputed  int;
  v_rows      int;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.is_admin(v_uid) then
    raise exception 'Only an administrator can sign off a rate card';
  end if;

  select status, label into v_status, v_label
    from public.fms_travel_rate_cards where id = p_card for update;

  if v_status is null then raise exception 'Rate card not found'; end if;
  if v_status = 'confirmed' then
    raise exception 'This rate card is already confirmed';
  end if;
  if v_status = 'superseded' then
    raise exception 'This rate card has been superseded by a later one and cannot be confirmed';
  end if;

  select count(*) into v_rows from public.fms_travel_rates where rate_card_id = p_card;
  if v_rows = 0 then
    raise exception 'This rate card has no figures on it yet';
  end if;

  select count(*) into v_disputed
    from public.fms_travel_rates where rate_card_id = p_card and disputed;

  if v_disputed > 0 then
    raise exception
      'Resolve the % disputed figure(s) on this card first. The source policy gives two different answers for them, and a card cannot be signed off while it still contradicts itself.',
      v_disputed;
  end if;

  -- Everything previously confirmed becomes history.
  update public.fms_travel_rate_cards
     set status = 'superseded'
   where status = 'confirmed' and id <> p_card;

  update public.fms_travel_rate_cards
     set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now()
   where id = p_card;

  perform public.fms_travel_announce(
    'rate_card', p_card, 'rate_card_confirmed',
    v_label || ' signed off — travel caps now enforce',
    '{}'::uuid[],
    jsonb_build_object('label', v_label));
end $$;

comment on function public.fms_travel_confirm_rate_card(uuid) is
  'Sign off a rate card so its caps enforce. REFUSES while any row is still marked disputed - the band 3 / band 8 contradiction in Policy section 2 must be decided before travel can be priced enforceably.';
grant execute on function public.fms_travel_confirm_rate_card(uuid) to authenticated;


-- ===========================================================================
-- ASSERTIONS
-- ===========================================================================
do $mig$
declare v_public int;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_travel_rate_cards', 'fms_travel_rates')
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception 'Travel Desk rate cards: % policy/policies scoped to {public}', v_public;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'fms_travel_rates' and c.relrowsecurity
  ) then
    raise exception 'Travel Desk: RLS is not enabled on fms_travel_rates';
  end if;

  -- A confirmed card must carry its attribution.
  begin
    insert into public.fms_travel_rate_cards (label, effective_from, status)
    values ('__assert__', current_date, 'confirmed');
    raise exception 'Travel Desk: a confirmed rate card was accepted with no confirmed_by/at';
  exception
    when check_violation then null;  -- expected
  end;
end $mig$;

commit;
