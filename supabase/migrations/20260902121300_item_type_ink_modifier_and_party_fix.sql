-- ===========================================================================
-- CENTRAL MASTERS — two classifier faults found by reading the result on screen.
--
-- FAULT 1: "PART" matched inside "PARTY".
--   The group test used the bare substring PART, so every "... -THIRD PARTY"
--   group was read as a spare-parts group:
--
--     INK-THIRD PARTY         (3 items)  ->  wrongly spare
--     PRINTHEAD -THIRD PARTY  (3 items)  ->  wrongly spare
--     MACHINERY-THIRD PARTY  (10 items)  ->  wrongly spare
--     DRYER -THIRD PARTY      (1 item)   ->  wrongly spare
--     SPARE PART-THIRD PARTY (25 items)  ->  correctly spare, and stays so
--
--   Now \yPARTS?\y, which matches PART and PARTS as words and never PARTY.
--
-- FAULT 2: "INK" is usually a MODIFIER, not the product.
--   Every one of these was tagged Ink, and every one is hardware:
--
--     555-467 MAIN INK TANK              [MS SPARE PARTS]
--     444-114 MAIN INK TANK FILTERS      [SUBPRO-2 SPARE PARTS]
--     M0445 24 HEAD INK TANK COVER       [MECHANICAL]
--     OR228-INK BOTTLE (12L)             [ORIC SPAREPARTS]
--     555-030 INK OUTLET PIPES FITTINGS  [MS SPARE PARTS]
--     INK MISTING UNIT FOR K32           [OTHER SPARE PARTS]
--
--   The tell is the same one that fixed HEAD: the group already knew. So the
--   word INK now yields to a spare-parts group, exactly as a bare HEAD does.
--   Ink filed under an INK group ("KY SUBLIMATION INK BLACK-THIRD PARTY" in
--   INK-THIRD PARTY) is untouched — which only works because of Fault 1's fix.
--
--   TANK, TRAY, COVER and CAPPING join the component nouns for the same reason.
--
-- NET EFFECT: 122 rows move, 116 of them into Spare Parts. Ink 2,206 -> 2,102.
--   Ink was over-claiming; a printer business holds far more ink PLUMBING than
--   ink.
--
-- ⚠ THIS RE-SEEDS EVERY ROW, WHICH IS ONLY SAFE TODAY.
--   Nothing has been corrected by hand yet — verified before running. A blanket
--   re-seed AFTER anyone has fixed a type would silently discard their work.
--   Any future classifier change must be applied NARROWLY, scoped by predicate
--   to the rows the old rule got wrong, the way 20260902121200 was.
--
-- Reversal: restore the function body from 20260902121200 and re-seed. The
--   pre-change distribution was ink 2,206 / spare_parts 8,538 / other 1,461 /
--   machine 979 / head 648 / unset 396.
-- ===========================================================================

create or replace function public.mst_guess_item_type(p_item text, p_group text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- 1. Material nouns win outright, or "SUBLIMATION PAPER" becomes ink.
    when upper(coalesce(p_item,'')) ~ '\y(PAPER|FABRIC|STICKER|CARTON|PACKING|SCRAP|SOFTWARE)\y'
      then 'other'
    -- 2. A component noun makes it a part, whatever brand it carries.
    when upper(coalesce(p_item,'')) ~ '\y(CABLE|WIRE|BOARD|PCB|BELT|BEARING|MOTOR|VALVE|PUMP|FILTER|SENSOR|SWITCH|GEAR|SCREW|BOLT|NUT|WASHER|ROLLER|WIPER|DAMPER|PLATE|BLOCK|SPRING|RUBBER|SEAL|FAN|FUSE|RELAY|CONNECTOR|COUPLING|BUSH|PULLEY|CHAIN|HOSE|TUBE|PIPE|CLAMP|BRACKET|GASKET|NOZZLE|SOLENOID|ENCODER|SERVO|CARRIAGE|RAIL|SLIDER|BUSHING|CLOTH|SPONGE|GREASE|TAPE|COVER|CAPPING|HARNESS|CABINET|TANK|TRAY|O-RING)\y'
      then 'spare_parts'
    -- 3a. INK as a MODIFIER on hardware - "MAIN INK TANK" in a parts group.
    when upper(coalesce(p_item,'')) ~ '(\yINKS?\y|REACTIVEINK)'
     and upper(coalesce(p_group,'')) ~ '(SPARE|\yPARTS?\y|MECHANIC|ELECTRIC)'
      then 'spare_parts'
    -- 3b. Otherwise the word INK means ink. "INKJET" does not match.
    when upper(coalesce(p_item,'')) ~ '(\yINKS?\y|REACTIVEINK)'
      then 'ink'
    -- 4. Whole machines.
    when upper(coalesce(p_item,'')) ~ '\y(MACHINE|MACHINERY|PRINTER|DRYER|CALENDER|PLANT|CHILLER|COMPRESSOR)\y'
      then 'machine'
    -- 5a. STRONG head markers outrank the group: real heads do sit in groups
    --     named "SPARE PART UNDER WARRANTY".
    when upper(coalesce(p_item,'')) ~ '(PRINTHEAD|PRINT HEAD|KJ4B|\yDPI\y|RICOH GEN|MS2C|STARFIRE|XAAR|POLARIS|KYOCERA)'
      then 'head'
    -- 5b. A BARE "HEAD" is weak evidence and yields to a spare-parts group.
    when upper(coalesce(p_item,'')) ~ '\yHEADS?\y'
     and upper(coalesce(p_group,'')) !~ '(SPARE|\yPARTS?\y|MECHANIC|ELECTRIC)'
      then 'head'
    -- 6. Ink families that never spell "ink" - same deference to the group.
    when upper(coalesce(p_item,'')) ~ '\y(SUBLIMATION|REACTIVE|DISPERSE|PIGMENT|NOVACRON|ANTELOS|TERASIL|LANASET)\y'
     and upper(coalesce(p_group,'')) !~ '(SPARE|\yPARTS?\y|MECHANIC|ELECTRIC)'
      then 'ink'
    -- 7-11. The name said nothing; let Tally's group speak.
    when upper(coalesce(p_group,'')) ~ '(SPARE|\yPARTS?\y|MECHANIC|ELECTRIC|PNEUMAT|FASTNER|FASTENER|TOOL|\yBOM\y|CONSUM|WARRANTY|FILTER)'
      then 'spare_parts'
    when upper(coalesce(p_group,'')) ~ '(PRINTHEAD|HEAD|DPI|KJ4B|KYOCERA|RICOH GEN|MS2C)'
      then 'head'
    when upper(coalesce(p_group,'')) ~ '(INK|DYE|PIGMENT|SUBLIMATION|REACTIVE|DISPERSE|NOVACRON|ANTELOS|TERASIL|LANASET)'
      then 'ink'
    when upper(coalesce(p_group,'')) ~ '(MACHINE|MACHINARY|MACHINERY|PRINTER|DRYER)'
      then 'machine'
    when upper(coalesce(p_group,'')) ~ '(PAPER|FABRIC|CHEMICAL|GLUE|SOFTWARE|SCRAP|PACKING|RAW MATERIAL|POWDER|DEAD STOCK)'
      then 'other'
    -- 12. No evidence. NULL, never a guessed 'other'.
    else null
  end;
$$;


do $reseed$
declare
  v_items   integer;
  v_changed integer;
begin
  select count(*) into v_items from public.mst_items;

  update public.mst_items i
     set item_type = public.mst_guess_item_type(i.name, g.name)
    from public.mst_item_groups g
   where g.id = i.group_id
     and i.item_type is distinct from public.mst_guess_item_type(i.name, g.name);

  get diagnostics v_changed = row_count;

  if (select count(*) from public.mst_items) <> v_items then
    raise exception 'item type reseed: mst_items row count changed';
  end if;

  -- Every remaining value must agree with the classifier, or the re-seed
  -- silently skipped rows (a join miss on group_id would do exactly that).
  if exists (
    select 1 from public.mst_items i join public.mst_item_groups g on g.id = i.group_id
     where i.item_type is distinct from public.mst_guess_item_type(i.name, g.name)) then
    raise exception 'item type reseed: rows still disagree with the classifier';
  end if;

  raise notice 'item type reseed: % of % row(s) re-typed', v_changed, v_items;
end $reseed$;
