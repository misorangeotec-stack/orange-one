-- R5 (step 1 of 3) · The deal-type and delivery-term vocabularies widen.
--
-- 🔴 THIS FILE GOES FIRST AND ALONE. It contains no function transforms and no
--    data change — only two CHECK constraints. Ship the frontend before it and
--    the first EPCG save dies on `fms_ocpi_deals_transport_terms_check` with a
--    raw 23514 naming no field, which `20261105120000:50-51` records as this
--    module's worst failure mode.
--
-- WHAT THE CLIENT ASKED FOR
--   Deal type: rename High Seas to HSS on screen, and add EPCG, MOOWR scheme and
--   HSS with EPCG beside Others. Delivery term: keep CIF and EX Factory, replace
--   FOB with Local.
--
-- 🟢 NOTHING IS RENAMED IN THE DATABASE. `high_seas` and `local` keep their
--    stored values — only their BUTTON LABELS change, in TypeScript. So the 30
--    deals holding `local` and the 6 holding `high_seas` are untouched by this
--    change and by every later step of R5. Renaming `local` to `others` to match
--    its new caption would rewrite 30 live rows and four SQL functions for a
--    cosmetic gain; it is deliberately not done.
--
-- ⚠ WIDENED, NEVER TIGHTENED. A CHECK is re-validated against every existing row
--   the moment it is added, so a narrower list would abort on live data. Both
--   lists here are supersets of what is installed.
--
-- 🔴 `FOB` STAYS IN `high_seas_via` THOUGH THE BUTTON IS GONE. No deal uses it —
--    `high_seas_via`, `delivery_via` and `trade_term` all return 0 for FOB,
--    checked before writing this — but the column must still be able to hold
--    what a deal already says. `optsWithCurrent` in the form feeds a deal's own
--    value back as an extra button for the same reason (`fieldSpec.ts:535-538`).
--
-- 🔴 AND `Local` MUST BE ADDED TO `high_seas_via`, NOT ONLY TO THE FORM.
--    `payloadFromDraft` (`fieldSpec.ts:1621-1625`) MIRRORS the delivery term into
--    that column on a High Seas deal, gated on membership of `DELIVERY_VIA` —
--    which is exactly this CHECK's list. `fieldSpec.ts:530-533` states the trap
--    outright: "add a fourth value here and the mirror needs its own list first,
--    or the save is refused by the database." Widening the CHECK is the half of
--    that fix which lives here; the mirror gets its own frozen list in step 2.
--
-- ⚠ `fms_ocpi_transport_coherent` IS DELIBERATELY UNTOUCHED. It reads
--   `transport_terms is distinct from 'local' or high_seas_via is null`; all four
--   non-`local` values satisfy the first disjunct, so it passes. Its INTENT —
--   neither deal type carries the other's answer — simply stops applying to the
--   three new values, and the real rule belongs in `fms_ocpi_write_quotation`'s
--   clearing, which step 2 widens. Tightening a CHECK here would abort on live
--   rows (`20261105120000:60-63`).

begin;

do $assert$
declare v_n int;
begin
  -- Nothing may already hold a value outside the OLD lists, or the drop-and-add
  -- would silently bless data that was never legal.
  select count(*) into v_n from public.fms_ocpi_deals
   where transport_terms is not null and transport_terms not in ('high_seas', 'local');
  if v_n <> 0 then raise exception 'R5.1 pre 1: % deal(s) already hold an unknown transport_terms', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_deals
   where high_seas_via is not null and high_seas_via not in ('CIF', 'EX Factory', 'FOB');
  if v_n <> 0 then raise exception 'R5.1 pre 2: % deal(s) already hold an unknown high_seas_via', v_n; end if;

  -- Recorded so a later reader knows what the widening was measured against.
  select count(*) into v_n from public.fms_ocpi_deals where transport_terms = 'local';
  if v_n <> 30 then raise exception 'R5.1 pre 3: expected 30 Others deals, found % — re-read the footprint', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_deals where transport_terms = 'high_seas';
  if v_n <> 6 then raise exception 'R5.1 pre 4: expected 6 High Seas deals, found %', v_n; end if;
end $assert$;

alter table public.fms_ocpi_deals
  drop constraint if exists fms_ocpi_deals_transport_terms_check;

alter table public.fms_ocpi_deals
  add constraint fms_ocpi_deals_transport_terms_check
  check (transport_terms is null
         or transport_terms in ('high_seas', 'local', 'epcg', 'moowr', 'hss_epcg'));

alter table public.fms_ocpi_deals
  drop constraint if exists fms_ocpi_deals_high_seas_via_check;

alter table public.fms_ocpi_deals
  add constraint fms_ocpi_deals_high_seas_via_check
  check (high_seas_via is null
         or high_seas_via in ('CIF', 'EX Factory', 'FOB', 'Local'));

comment on column public.fms_ocpi_deals.transport_terms is
  'The DEAL TYPE. Stored: high_seas | local | epcg | moowr | hss_epcg. ⚠ THE LABELS ARE NOT THE VALUES — `high_seas` is captioned "HSS" and `local` is captioned "Others" (R5, 10-Sep-2026); both kept their stored value so 36 live deals needed no migration. ⚠ AND `local` HERE IS NOT THE SAME AS `delivery_via = ''Local''`: this column means "Others, i.e. not a named scheme", that one means a local delivery. Two columns, two meanings, one unfortunate word.';

do $post$
declare v_n int;
begin
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_deals_transport_terms_check'
     and pg_get_constraintdef(oid) like '%hss_epcg%'
     and pg_get_constraintdef(oid) like '%moowr%'
     and pg_get_constraintdef(oid) like '%epcg%';
  if v_n <> 1 then raise exception 'R5.1 post 1: the transport_terms list did not widen'; end if;

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_deals_high_seas_via_check'
     and pg_get_constraintdef(oid) like '%Local%'
     and pg_get_constraintdef(oid) like '%FOB%';
  if v_n <> 1 then raise exception 'R5.1 post 2: high_seas_via did not gain Local, or lost FOB'; end if;

  -- The widening must not have blessed away the old values.
  select count(*) into v_n from public.fms_ocpi_deals
   where transport_terms in ('high_seas', 'local');
  if v_n <> 36 then raise exception 'R5.1 post 3: expected 36 deals on the two original types, found %', v_n; end if;
end $post$;

commit;
