-- ===========================================================================
-- CENTRAL MASTERS — stop the bare word "HEAD" from claiming spare parts.
--
-- WHAT WENT WRONG
--   The first classifier treated any item name containing HEAD as a printhead.
--   Reviewing the Heads bucket on screen showed that is too loose:
--
--     HEAD TAPE BLACK                    [OTHER SPARE PARTS]
--     M0283 - HEAD COVER                 [OTHER SPARE PARTS]
--     OR061-HEAD CAPPING                 [KOLORODO MACHINE SPARE PARTS]
--     HARNESS,HEAD,A(696)-2091563        [MS SPARE PARTS]
--     16 HEAD CABINET                    [OTHER MACHINES PARTS]
--     555-350 PUSH-BUOON HEAD SCHLEGEL   [MS SPARE PARTS]
--
--   Every one is a part FOR a head, sitting in a spare-parts group, and the
--   group was saying so all along.
--
-- THE RULE, NARROWED
--   A bare "HEAD" now yields to the group: if Tally files the item under spare
--   parts, it is a spare part. The STRONG markers are untouched — PRINTHEAD,
--   KYOCERA, KJ4B, nnn DPI, MS2C, STARFIRE and friends still mean the head
--   itself wherever they sit, because a group called "SPARE PART UNDER
--   WARRANTY" legitimately holds real heads under warranty.
--
--   Deliberately conservative. Of the 42 rows this moves, ~40 are plainly
--   parts; "ORC 16 HEAD" and "PRT HEAD" are the arguable ones. Trading two
--   uncertain rows for forty correct ones is the right side of that bet, and
--   either can be set back by hand in Masters in seconds.
--
-- Reversal: re-run 20260902121100's function definition, then
--   update public.mst_items set item_type = 'head'
--    where item_type = 'spare_parts' and upper(name) ~ '\yHEADS?\y';
--   (imprecise - it would also catch rows that were always spare_parts, so
--    prefer restoring from the counts recorded in this migration's notice)
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
    when upper(coalesce(p_item,'')) ~ '\y(CABLE|WIRE|BOARD|PCB|BELT|BEARING|MOTOR|VALVE|PUMP|FILTER|SENSOR|SWITCH|GEAR|SCREW|BOLT|NUT|WASHER|ROLLER|WIPER|DAMPER|PLATE|BLOCK|SPRING|RUBBER|SEAL|FAN|FUSE|RELAY|CONNECTOR|COUPLING|BUSH|PULLEY|CHAIN|HOSE|TUBE|PIPE|CLAMP|BRACKET|GASKET|NOZZLE|SOLENOID|ENCODER|SERVO|CARRIAGE|RAIL|SLIDER|BUSHING|CLOTH|SPONGE|GREASE|TAPE|COVER|CAPPING|HARNESS|CABINET|O-RING)\y'
      then 'spare_parts'
    -- 3. The literal word INK. "INKJET" does not match - no word boundary.
    when upper(coalesce(p_item,'')) ~ '(\yINKS?\y|REACTIVEINK)'
      then 'ink'
    -- 4. Whole machines.
    when upper(coalesce(p_item,'')) ~ '\y(MACHINE|MACHINERY|PRINTER|DRYER|CALENDER|PLANT|CHILLER|COMPRESSOR)\y'
      then 'machine'
    -- 5a. STRONG head markers - a model or a brand. These outrank the group,
    --     because real heads do sit in groups named "... SPARE PART ...".
    when upper(coalesce(p_item,'')) ~ '(PRINTHEAD|PRINT HEAD|KJ4B|\yDPI\y|RICOH GEN|MS2C|STARFIRE|XAAR|POLARIS|KYOCERA)'
      then 'head'
    -- 5b. A BARE "HEAD" is weak evidence and yields to a spare-parts group.
    when upper(coalesce(p_item,'')) ~ '\yHEADS?\y'
     and upper(coalesce(p_group,'')) !~ '(SPARE|PART|MECHANIC|ELECTRIC)'
      then 'head'
    -- 6. Ink product families that never spell "ink" (ANTELOS DEEP BLACK).
    when upper(coalesce(p_item,'')) ~ '\y(SUBLIMATION|REACTIVE|DISPERSE|PIGMENT|NOVACRON|ANTELOS|TERASIL|LANASET)\y'
      then 'ink'
    -- 7-11. The name said nothing; let Tally's group speak.
    when upper(coalesce(p_group,'')) ~ '(SPARE|PART|MECHANIC|ELECTRIC|PNEUMAT|FASTNER|FASTENER|TOOL|\yBOM\y|CONSUM|WARRANTY|FILTER)'
      then 'spare_parts'
    when upper(coalesce(p_group,'')) ~ '(PRINTHEAD|HEAD|DPI|KJ4B|KYOCERA|RICOH GEN|MS2C)'
      then 'head'
    when upper(coalesce(p_group,'')) ~ '(INK|DYE|PIGMENT|SUBLIMATION|REACTIVE|DISPERSE|NOVACRON|ANTELOS|TERASIL|LANASET)'
      then 'ink'
    when upper(coalesce(p_group,'')) ~ '(MACHINE|MACHINARY|MACHINERY|PRINTER|DRYER)'
      then 'machine'
    when upper(coalesce(p_group,'')) ~ '(PAPER|FABRIC|CHEMICAL|GLUE|SOFTWARE|SCRAP|PACKING|RAW MATERIAL|POWDER|DEAD STOCK)'
      then 'other'
    else null
  end;
$$;


do $fix$
declare
  v_items integer;
  v_moved integer;
begin
  select count(*) into v_items from public.mst_items;

  -- Scoped to exactly the rows the old rule got wrong: currently 'head', the
  -- only head signal is a bare HEAD, and Tally files them under spare parts.
  update public.mst_items i
     set item_type = 'spare_parts'
    from public.mst_item_groups g
   where g.id = i.group_id
     and i.item_type = 'head'
     and upper(i.name) ~ '\yHEADS?\y'
     and upper(i.name) !~ '(PRINTHEAD|PRINT HEAD|KJ4B|\yDPI\y|RICOH GEN|MS2C|STARFIRE|XAAR|POLARIS|KYOCERA)'
     and upper(g.name) ~ '(SPARE|PART|MECHANIC|ELECTRIC)';

  get diagnostics v_moved = row_count;

  if (select count(*) from public.mst_items) <> v_items then
    raise exception 'item type refinement: mst_items row count changed';
  end if;

  raise notice 'item type refinement: moved % row(s) from Heads to Spare Parts', v_moved;
end $fix$;
