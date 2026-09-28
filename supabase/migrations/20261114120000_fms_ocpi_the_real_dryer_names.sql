-- B5 · The six dryer names in the master were INVENTED. These are the real ones.
--
-- WHY THIS FILE EXISTS
--   The eleven machines that can carry a dryer need a dryer to name, and nobody
--   had supplied the real list. Six placeholders were seeded so the screen would
--   work. They were once prefixed `[SAMPLE]`; THAT MARKER IS GONE, so a
--   salesperson sees six names that look entirely real, and one has already
--   reached a live deal:
--
--       QT-M0037-era row holding `Indian 3-Chamber Dryer — Thermic Fluid`
--       on a NON-DRAFT deal.
--
--   The real names were supplied by the client on 07-09-2026. Four Indian, two
--   Chinese — NOT three and three, so this is a REPLACEMENT, not a rename. The
--   old names ran on chambers (2/3/4) and heat source (Electric / Thermic Fluid /
--   Gas Fired); the real ones run on chambers (single/double) and heating
--   (single/dual). The axes do not correspond, so no row is edited in place.
--
-- SPELLING
--   The client's list reads `DOUL`, `SINGHLE` and `HEATHING`. Corrected here to
--   `DUAL`, `SINGLE` and `HEATING` ON THE CLIENT'S EXPLICIT INSTRUCTION. This is
--   deliberately UNLIKE the K32 consumables list (20261106130000), where the
--   contract's own `SQUEZEE` was kept verbatim, because that text was transcribed
--   off a signed paper and this list was supplied directly.
--
-- WHY DEACTIVATE RATHER THAN DELETE
--   `fms_ocpi_deals.dryer_name` is TEXT, not a foreign key — the name is copied
--   onto the deal and frozen with the quotation. Deleting the master row would
--   not corrupt a deal, but it would destroy the only record of what the six
--   placeholders were, and the live deal above still needs explaining.
--   `QuotationForm.tsx:1126-1133` already appends a stored-but-unlisted name to
--   the dropdown, so the live deal keeps showing its value either way.
--
-- ⚠ THIS FILE DOES NOT FIX THE LIVE DEAL. A deal holding an invented dryer name
--   is a commercial fact, not a data error — the salesperson must reopen it and
--   choose a real dryer. Listed by the assertion below so it cannot be forgotten.

begin;

-- ---------------------------------------------------------------------------
-- Assertions FIRST, above the DDL, so the scans do not run inside its locks.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_placeholders int;
  v_types        int;
  v_already      int;
  v_affected     int;
begin
  select count(*) into v_placeholders
    from public.fms_ocpi_dryers
   where name in (
     'Chinese 2-Chamber Dryer — Electric',
     'Chinese 3-Chamber Dryer — Thermic Fluid',
     'Chinese 4-Chamber Dryer — Gas Fired',
     'Indian 2-Chamber Dryer — Electric',
     'Indian 3-Chamber Dryer — Thermic Fluid',
     'Indian 4-Chamber Dryer — Gas Fired');
  if v_placeholders <> 6 then
    raise exception 'B5 pre 1: expected the 6 placeholder dryers, found %', v_placeholders;
  end if;

  select count(*) into v_types
    from public.fms_ocpi_dryer_types
   where name in ('Indian','Chinese') and means_no_dryer is not true;
  if v_types <> 2 then
    raise exception 'B5 pre 2: expected the Indian and Chinese dryer types, found %', v_types;
  end if;

  select count(*) into v_already
    from public.fms_ocpi_dryers where name like 'INDIAN DRYER-%' or name like 'CHINESE DRYER %';
  if v_already <> 0 then
    raise exception 'B5 pre 3: the real names are already present (%) — this file has run before', v_already;
  end if;

  select count(*) into v_affected
    from public.fms_ocpi_deals
   where nullif(btrim(coalesce(dryer_name,'')),'') is not null
     and dryer_name in (
       'Chinese 2-Chamber Dryer — Electric','Chinese 3-Chamber Dryer — Thermic Fluid',
       'Chinese 4-Chamber Dryer — Gas Fired','Indian 2-Chamber Dryer — Electric',
       'Indian 3-Chamber Dryer — Thermic Fluid','Indian 4-Chamber Dryer — Gas Fired');
  raise notice 'B5: % deal(s) hold an invented dryer name and must be corrected by hand.', v_affected;
end $assert$;

-- ---------------------------------------------------------------------------
-- 1 · Retire the six placeholders. Kept, not deleted — see the header.
-- ---------------------------------------------------------------------------
update public.fms_ocpi_dryers
   set active = false, updated_at = now()
 where name in (
   'Chinese 2-Chamber Dryer — Electric',
   'Chinese 3-Chamber Dryer — Thermic Fluid',
   'Chinese 4-Chamber Dryer — Gas Fired',
   'Indian 2-Chamber Dryer — Electric',
   'Indian 3-Chamber Dryer — Thermic Fluid',
   'Indian 4-Chamber Dryer — Gas Fired');

-- ---------------------------------------------------------------------------
-- 2 · The real list. Idempotent on (dryer_type_id, name).
-- ---------------------------------------------------------------------------
insert into public.fms_ocpi_dryers (dryer_type_id, name, active, sort_order)
select t.id, v.name, true, v.sort_order
  from public.fms_ocpi_dryer_types t
  join (values
    ('Indian',  'INDIAN DRYER-SINGLE CHAMBER WITH SINGLE HEATING', 10),
    ('Indian',  'INDIAN DRYER-SINGLE CHAMBER WITH DUAL HEATING',   20),
    ('Indian',  'INDIAN DRYER-DOUBLE CHAMBER WITH SINGLE HEATING', 30),
    ('Indian',  'INDIAN DRYER-DOUBLE CHAMBER WITH DUAL HEATING',   40),
    ('Chinese', 'CHINESE DRYER WITH SINGLE HEATING',               10),
    ('Chinese', 'CHINESE DRYER WITH DUAL HEATING',                 20)
  ) as v(type_name, name, sort_order) on v.type_name = t.name
 where not exists (
   select 1 from public.fms_ocpi_dryers d
    where d.dryer_type_id = t.id and d.name = v.name);

-- ---------------------------------------------------------------------------
-- Post-flight
-- ---------------------------------------------------------------------------
do $post$
declare
  v_active_real int;
  v_active_old  int;
  v_indian      int;
  v_chinese     int;
begin
  select count(*) into v_active_real
    from public.fms_ocpi_dryers
   where active and (name like 'INDIAN DRYER-%' or name like 'CHINESE DRYER %');
  if v_active_real <> 6 then
    raise exception 'B5 post 1: expected 6 active real dryers, found %', v_active_real;
  end if;

  select count(*) into v_active_old
    from public.fms_ocpi_dryers
   where active and name like '%-Chamber Dryer —%';
  if v_active_old <> 0 then
    raise exception 'B5 post 2: % placeholder(s) are still active', v_active_old;
  end if;

  select count(*) into v_indian
    from public.fms_ocpi_dryers d join public.fms_ocpi_dryer_types t on t.id = d.dryer_type_id
   where d.active and t.name = 'Indian';
  select count(*) into v_chinese
    from public.fms_ocpi_dryers d join public.fms_ocpi_dryer_types t on t.id = d.dryer_type_id
   where d.active and t.name = 'Chinese';
  if v_indian <> 4 or v_chinese <> 2 then
    raise exception 'B5 post 3: expected 4 Indian and 2 Chinese, found % and %', v_indian, v_chinese;
  end if;
end $post$;

commit;
