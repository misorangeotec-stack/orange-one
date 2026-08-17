-- ===========================================================================
-- CENTRAL MASTERS — item type (Ink / Spare Parts / Heads / Machine / Others).
--
-- WHY IT IS OURS AND NOT TALLY'S
--   Tally has no item-type field. The Outstanding Dashboard already splits
--   REVENUE five ways with exactly these buckets (`SaleType` in
--   receivables-hub/lib/types.ts: ink | spare_parts | machine | head | other),
--   but it gets them per INVOICE from the Python pipeline's voucher-type
--   mapping — nothing classifies the item itself. This column does, using the
--   SAME KEYS so the two can be joined later without a translation table.
--
--   Portal-owned, like `location` and `modules`: masters-sync never writes it.
--
-- HOW EACH ITEM WAS CLASSIFIED
--   mst_guess_item_type() reads the item name FIRST and its Tally group second,
--   in a deliberate order, because the obvious keyword is often a trap:
--
--     "SUBLIMATION PAPER"        -> Others  (paper, not ink)
--     "SUBLIMATION DIGITAL PRINTER" -> Machine (a printer, not ink)
--     "KYOCERA PIGMENT INK RED"  -> Ink     (Kyocera is a head brand reused on ink)
--     "HEAD CONNECTION DATA CABLE" -> Spare (a cable, not a head)
--     "PRINTHEAD WIPER"          -> Spare   (a wiper, not a head)
--     "KYOCERA 600 DPI - NEW"    -> Head    (the head itself)
--
--   So: material nouns beat everything, then component nouns, then the literal
--   word INK, then whole machines, then head models, then ink product families.
--   Only if the name says nothing does the group get a vote.
--
-- ⚠ WHAT IS DELIBERATELY LEFT NULL
--   396 items (2.8%) where neither the name nor the group carries any signal —
--   "Panasonic KXTG3611", "TOUCH SCREEN MONITOR", bare part codes like
--   "OR-16-00-01-0000". Calling those "Others" would claim knowledge we do not
--   have; "Others" here means genuinely other (paper, fabric, scrap, software).
--   They read as "Not set" in the Masters grid and filter as their own value,
--   which is how they get found and fixed.
--
-- This is a BEST-EFFORT SEED, not a source of truth. Every value is editable in
-- Masters and survives every sync.
--
-- Reversal:
--   drop trigger if exists mst_items_guess_type on public.mst_items;
--   drop function if exists public.mst_items_set_type();
--   drop function if exists public.mst_guess_item_type(text, text);
--   alter table public.mst_items drop column if exists item_type;
-- ===========================================================================

alter table public.mst_items
  add column if not exists item_type text
    check (item_type in ('ink', 'spare_parts', 'head', 'machine', 'other'));

comment on column public.mst_items.item_type is
  'Ink / Spare Parts / Heads / Machine / Others. Keys match receivables-hub SaleType so item and revenue can be joined. Portal-owned: masters-sync never writes it. NULL = not yet classified, not "other".';

create index if not exists mst_items_item_type_idx on public.mst_items (item_type);


-- ---------------------------------------------------------------------------
-- The classifier. Kept in the database so the seed below and the trigger that
-- catches new Tally items cannot drift apart into two different opinions.
-- ---------------------------------------------------------------------------
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
    when upper(coalesce(p_item,'')) ~ '\y(CABLE|WIRE|BOARD|PCB|BELT|BEARING|MOTOR|VALVE|PUMP|FILTER|SENSOR|SWITCH|GEAR|SCREW|BOLT|NUT|WASHER|ROLLER|WIPER|DAMPER|PLATE|BLOCK|SPRING|RUBBER|SEAL|FAN|FUSE|RELAY|CONNECTOR|COUPLING|BUSH|PULLEY|CHAIN|HOSE|TUBE|PIPE|CLAMP|BRACKET|GASKET|NOZZLE|SOLENOID|ENCODER|SERVO|CARRIAGE|RAIL|SLIDER|BUSHING|CLOTH|SPONGE|GREASE|O-RING)\y'
      then 'spare_parts'
    -- 3. The literal word INK. "INKJET" does not match - no word boundary.
    when upper(coalesce(p_item,'')) ~ '(\yINKS?\y|REACTIVEINK)'
      then 'ink'
    -- 4. Whole machines.
    when upper(coalesce(p_item,'')) ~ '\y(MACHINE|MACHINERY|PRINTER|DRYER|CALENDER|PLANT|CHILLER|COMPRESSOR)\y'
      then 'machine'
    -- 5. The head itself, reached only once cables/wipers/boards are gone.
    when upper(coalesce(p_item,'')) ~ '(PRINTHEAD|PRINT HEAD|\yHEAD\y|KJ4B|\yDPI\y|RICOH GEN|MS2C|STARFIRE|XAAR|POLARIS|KYOCERA)'
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
    -- 12. No evidence. NULL, never a guessed 'other'.
    else null
  end;
$$;

revoke all on function public.mst_guess_item_type(text, text) from public;
revoke all on function public.mst_guess_item_type(text, text) from anon;
grant execute on function public.mst_guess_item_type(text, text) to authenticated;

comment on function public.mst_guess_item_type(text, text) is
  'Best-effort item type from an item name and its Tally group. Order matters: material nouns, then component nouns, then INK, then machines, then heads, then ink families, then the group. Returns NULL when nothing in either name carries a signal.';


-- ---------------------------------------------------------------------------
-- New items arriving from Tally classify themselves.
--
-- ⚠ INSERT ONLY, AND ONLY WHEN NULL. It can never overwrite a value an admin
--   typed: an UPDATE does not fire it, and masters-sync's upsert does not name
--   item_type in its update list, so a re-sync leaves human edits alone.
-- ---------------------------------------------------------------------------
create or replace function public.mst_items_set_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_type is null then
    new.item_type := public.mst_guess_item_type(
      new.name,
      (select g.name from public.mst_item_groups g where g.id = new.group_id));
  end if;
  return new;
end;
$$;

drop trigger if exists mst_items_guess_type on public.mst_items;
create trigger mst_items_guess_type
  before insert on public.mst_items
  for each row execute function public.mst_items_set_type();


-- ---------------------------------------------------------------------------
-- Seed the 14,228 items already here.
-- ---------------------------------------------------------------------------
do $seed$
declare
  v_items    integer;
  v_before   integer;
  v_filled   integer;
  v_unset    integer;
  v_bad      integer;
begin
  select count(*) into v_items from public.mst_items;
  select count(*) into v_before from public.mst_items where item_type is not null;

  update public.mst_items i
     set item_type = public.mst_guess_item_type(i.name, g.name)
    from public.mst_item_groups g
   where g.id = i.group_id
     and i.item_type is null;

  get diagnostics v_filled = row_count;

  -- The item list itself must be untouched - this only fills one new column.
  if (select count(*) from public.mst_items) <> v_items then
    raise exception 'item type: mst_items row count changed (% -> %)',
      v_items, (select count(*) from public.mst_items);
  end if;

  -- Nothing outside the five agreed buckets may exist.
  select count(*) into v_bad from public.mst_items
   where item_type is not null
     and item_type not in ('ink','spare_parts','head','machine','other');
  if v_bad > 0 then
    raise exception 'item type: % row(s) carry a type outside the five buckets', v_bad;
  end if;

  select count(*) into v_unset from public.mst_items where item_type is null;

  raise notice 'item type: classified % of % item(s); % left unset for review',
    v_filled, v_items, v_unset;
end $seed$;
