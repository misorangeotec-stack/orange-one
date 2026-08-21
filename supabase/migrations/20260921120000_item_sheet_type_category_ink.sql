-- ===========================================================================
-- CENTRAL MASTERS — the item sheet: TYPE, CATEGORY and INK TYPE.
--
-- WHY THIS EXISTS
--   `item_type` has been on mst_items since 20260902121100, but every value in
--   it was a GUESS: mst_guess_item_type() reading the item name and its Tally
--   group through a pile of regexes. That migration's own header calls itself
--   "a BEST-EFFORT SEED, not a source of truth".
--
--   The source of truth has now arrived — "Inventory Mapping Sales Register",
--   11,431 items typed by hand by someone who knows the product. It also
--   carries two things the masters have never had: a CATEGORY (a middle layer
--   between the type and Tally's stock group) and, for inks, an INK TYPE.
--
--   So this migration does three things: widens the type vocabulary to the
--   sheet's own words, adds the two new columns, and installs the re-runnable
--   machinery that loads a sheet into them.
--
-- THE VOCABULARY WIDENS FROM 5 TO 13
--   The sheet does not speak in five buckets. PAPER is 950 rows and RAW
--   MATERIAL 328 — collapsing those into "other" throws away the answer we
--   just paid a person to give us.
--
--   ⚠ THE FIVE EXISTING KEYS KEEP THEIR EXACT SPELLING. `ink`, `spare_parts`,
--     `head`, `machine` and `other` are the same strings receivables-hub uses
--     for SaleType, and 20260902121100 chose them deliberately so item and
--     revenue could be joined without a translation table. Nothing about them
--     moves here; eight keys are ADDED alongside. The 13 -> 5 map that keeps
--     that join alive lives in ONE place, on ITEM_TYPES in
--     frontend/src/core/platform/liveMasters.ts.
--
--   Receivables itself is untouched: its sale type is resolved in the
--   ConnectWave project from the bill-name prefix and the voucher type, never
--   from this column.
--
-- WHAT IS DELIBERATELY NOT DONE
--   mst_guess_item_type() and the mst_items_guess_type INSERT trigger are left
--   exactly as they are. The guesser still returns five of the thirteen, all
--   valid under the widened CHECK, so a new item arriving from Tally still
--   classifies itself and the next sheet load refines it.
--
--   ⚠ And there is NO re-seed here. 20260902121300 re-seeded every row and
--     warned that this was "ONLY SAFE TODAY" because nobody had hand-corrected
--     a type yet. After this migration the column holds hand-typed answers, so
--     a blanket re-seed would silently discard them. Any future classifier
--     change must be scoped by predicate to the rows the old rule got wrong.
--
-- Reversal:
--   drop function if exists public.mst_apply_item_sheet();
--   drop table if exists public.mst_item_sheet_import;
--   alter table public.mst_items drop column if exists ink_type;
--   alter table public.mst_items drop column if exists category;
--   alter table public.mst_items drop constraint if exists mst_items_item_type_check;
--   update public.mst_items set item_type = null
--    where item_type not in ('ink','spare_parts','head','machine','other');
--   alter table public.mst_items add constraint mst_items_item_type_check
--     check (item_type in ('ink','spare_parts','head','machine','other'));
--   ⚠ That restores the SHAPE, not the VALUES — 2,536 rows changed type on the
--     first load. Restore those from the snapshot the loader takes before it
--     writes anything (supabase/itemsheet/snapshot-before.json), by running
--     supabase/itemsheet/restore-snapshot.mjs --apply.
-- ===========================================================================


-- --------------------------------------------------------------- the type --
-- Drop and re-add rather than ALTER: the constraint was created inline by
-- `add column ... check (...)`, so Postgres auto-named it, and that name is
-- what has to be dropped. Every existing value stays valid under the new one,
-- so no row is touched and the table is not rewritten.
alter table public.mst_items
  drop constraint if exists mst_items_item_type_check;

alter table public.mst_items
  add constraint mst_items_item_type_check
  check (item_type in (
    -- the original five, spelled exactly as receivables-hub spells them
    'ink', 'spare_parts', 'head', 'machine', 'other',
    -- the eight the sheet added
    'paper', 'raw_material', 'packing_material', 'cartage',
    'software', 'provision_ink', 'other_ink', 'service_expense'
  ));

comment on column public.mst_items.item_type is
  'The item type, in the words of the Inventory Mapping sheet: 13 values. The first five (ink, spare_parts, head, machine, other) are spelled to match receivables-hub SaleType so item and revenue can be joined; the 13->5 map lives on ITEM_TYPES in liveMasters.ts. Portal-owned: masters-sync never writes it. NULL = not yet classified, not "other".';


-- ------------------------------------------------- category and ink type --
-- NO CHECK on either. The sheet carries 96 categories and 85 ink types today
-- and a revised sheet will bring more; a constraint here would mean a
-- migration every time the business names a new product family. The Masters
-- form offers the values that actually exist, which is the real guard.
alter table public.mst_items
  add column if not exists category text;

alter table public.mst_items
  add column if not exists ink_type text;

comment on column public.mst_items.category is
  'A middle layer between item_type and Tally stock group — MACHINERY PARTS, PAPER ROLL, REACTIVE INK, K24. NOT the stock group: only 858 of 13k rows agree with their own group. Loaded from the Inventory Mapping sheet; portal-owned, masters-sync never writes it.';

comment on column public.mst_items.ink_type is
  'The ink product family — ANTELOS, KY REACTIVE INK, RI G6 PRO. Set only on inks (1,657 rows). Loaded from the Inventory Mapping sheet; portal-owned, masters-sync never writes it.';

create index if not exists mst_items_category_idx on public.mst_items (category);
create index if not exists mst_items_ink_type_idx on public.mst_items (ink_type);

-- The key the sheet is joined on. See mst_apply_item_sheet() for why it is
-- whitespace-collapsed and nothing more.
--
-- ⚠ NOT the same as mst_items_name_key_idx (20260922120000), which strips every
--   non-alphanumeric character. That one is for the reconcile screen's
--   "is this the same product?" suggestions, where a human confirms. This one
--   must stay conservative, because nothing confirms it.
create index if not exists mst_items_name_ws_idx
  on public.mst_items (btrim(regexp_replace(name, '\s+', ' ', 'g')));


-- ----------------------------------------------------------- the staging --
-- WHY A TABLE AND NOT A ONE-OFF UPDATE: the sheet will be revised. Parking it
-- here first makes the load re-runnable — refill and apply again — and gives
-- the apply something to report against (which names matched, which did not).
create table if not exists public.mst_item_sheet_import (
  item_name  text primary key,
  item_type  text,
  category   text,
  ink_type   text,
  loaded_at  timestamptz not null default now()
);

comment on table public.mst_item_sheet_import is
  'Staging for the Inventory Mapping sheet. Truncated and refilled by supabase/itemsheet/load-item-sheet.mjs, then applied by mst_apply_item_sheet(). Not a master — it is the last sheet we loaded, kept so the load can be repeated and audited.';

alter table public.mst_item_sheet_import enable row level security;

-- Same predicate as mst_items_write: whoever may correct an item type by hand
-- may load a sheet of them. Nobody else can even read the staging table.
drop policy if exists mst_item_sheet_import_all on public.mst_item_sheet_import;
create policy mst_item_sheet_import_all on public.mst_item_sheet_import
  for all to authenticated
  using      (public.is_admin((select auth.uid())) or public.mst_is_master_manager('item', (select auth.uid())))
  with check (public.is_admin((select auth.uid())) or public.mst_is_master_manager('item', (select auth.uid())));


-- ------------------------------------------------------------- the apply --
create or replace function public.mst_apply_item_sheet()
returns table (
  sheet_rows         integer,
  matched_rows       integer,
  changed_rows       integer,
  category_filled    integer,
  ink_type_filled    integer,
  sheet_without_item integer,
  items_not_in_sheet integer
)
language plpgsql
set search_path = ''
-- ⚠ IT SETS ITS OWN TIMEOUT, and it has to. PostgREST runs as `authenticated`,
--   which Supabase caps at 8 seconds — and the first load updates 13,599 rows
--   and then counts across 14,267 more. Without this the very first real run
--   dies with 57014 half way through, which is exactly what happened. A
--   function-level SET behaves like SET LOCAL: it lasts for this call and
--   nothing else inherits it.
set statement_timeout = '300s'
as $fn$
declare
  v_before  integer;
  v_bad     integer;
  v_changed integer;
begin
  select count(*) into v_before from public.mst_items;

  -- ⚠ THE JOIN IS ON NAME, AND IT IS ONE-TO-MANY ON PURPOSE. Tally files the
  --   same stock item separately in every company book, so 11,431 sheet names
  --   reach 13,651 item rows. The type belongs to the product, so every copy
  --   of it gets the same answer.
  --
  -- ⚠ RUNS OF WHITESPACE ARE COLLAPSED, AND THAT IS NOT FUZZY MATCHING. Every
  --   non-whitespace character still has to be identical, case included. It is
  --   here because 15 names in the sheet carry a LINE BREAK inside the cell —
  --   Excel wrapped them, and "1270020061 PRINT HEAD COMM. CABLE\r\r\n020SP
  --   -070-AIAN-D" is the same name as the one-line version, not a different
  --   product. One more carries a doubled space. On a character-exact join
  --   those 16 fell out as unmatched, which read as "the sheet does not know
  --   this item" when the truth was "the cell is wrapped".
  --
  --   It is deliberately NOT the punctuation-insensitive match that would also
  --   equate "LRS-600-36-MEANWELL" with "LRS-600-36,MEANWELL". Those are
  --   different characters and might be different parts; nobody confirms this
  --   join, so it stays conservative.
  --
  --   33 keys reach master rows spelled two ways ("222-095 BENTONE  RI8
  --   CONTROLLER" and "222-095 BENTONE RI8 CONTROLLER") — the same product with
  --   a stray space in one company's book. Both get the same type, which is the
  --   point.
  --
  -- ⚠ A BLANK CELL LEAVES THE EXISTING VALUE ALONE. 425 machines have no
  --   category in the sheet; clearing them would be reading a gap as an
  --   instruction. It also means a hand-correction survives a future sheet
  --   that happens to be blank there. Clearing a wrong value is done in the
  --   Masters form, which is where someone can see what they are clearing.
  --
  -- ⚠ AND THE `is distinct from` GUARD IS NOT DECORATION. mst_items carries a
  --   BEFORE UPDATE trigger (set_updated_at), so an unguarded blanket update
  --   would stamp 13,651 rows on every re-run. With it, re-running an
  --   unchanged sheet writes nothing at all — which is what makes "run it
  --   again and changed_rows is 0" a real proof that the load is idempotent.
  update public.mst_items i
     set item_type = coalesce(nullif(btrim(s.item_type), ''), i.item_type),
         category  = coalesce(nullif(btrim(s.category ), ''), i.category),
         ink_type  = coalesce(nullif(btrim(s.ink_type ), ''), i.ink_type)
    from public.mst_item_sheet_import s
   where btrim(regexp_replace(i.name, '\s+', ' ', 'g')) = btrim(regexp_replace(s.item_name, '\s+', ' ', 'g'))
     and (i.item_type, i.category, i.ink_type) is distinct from (
           coalesce(nullif(btrim(s.item_type), ''), i.item_type),
           coalesce(nullif(btrim(s.category ), ''), i.category),
           coalesce(nullif(btrim(s.ink_type ), ''), i.ink_type));

  get diagnostics v_changed = row_count;

  -- The item list itself must be untouched — this only fills columns.
  if (select count(*) from public.mst_items) <> v_before then
    raise exception 'item sheet: mst_items row count changed (% -> %)',
      v_before, (select count(*) from public.mst_items);
  end if;

  -- Nothing outside the thirteen may exist. The CHECK would already have
  -- refused it; this says so in the report rather than in a constraint error.
  select count(*) into v_bad from public.mst_items
   where item_type is not null
     and item_type not in ('ink','spare_parts','head','machine','other',
                           'paper','raw_material','packing_material','cartage',
                           'software','provision_ink','other_ink','service_expense');
  if v_bad > 0 then
    raise exception 'item sheet: % row(s) carry a type outside the thirteen', v_bad;
  end if;

  changed_rows := v_changed;

  select count(*) into sheet_rows from public.mst_item_sheet_import;

  select count(*) into matched_rows
    from public.mst_items i
    join public.mst_item_sheet_import s on btrim(regexp_replace(i.name, '\s+', ' ', 'g')) = btrim(regexp_replace(s.item_name, '\s+', ' ', 'g'));

  select count(*) into category_filled
    from public.mst_items i
    join public.mst_item_sheet_import s on btrim(regexp_replace(i.name, '\s+', ' ', 'g')) = btrim(regexp_replace(s.item_name, '\s+', ' ', 'g'))
   where i.category is not null;

  select count(*) into ink_type_filled
    from public.mst_items i
    join public.mst_item_sheet_import s on btrim(regexp_replace(i.name, '\s+', ' ', 'g')) = btrim(regexp_replace(s.item_name, '\s+', ' ', 'g'))
   where i.ink_type is not null;

  select count(*) into sheet_without_item
    from public.mst_item_sheet_import s
   where not exists (select 1 from public.mst_items i where btrim(regexp_replace(i.name, '\s+', ' ', 'g')) = btrim(regexp_replace(s.item_name, '\s+', ' ', 'g')));

  select count(*) into items_not_in_sheet
    from public.mst_items i
   where not exists (select 1 from public.mst_item_sheet_import s where btrim(regexp_replace(s.item_name, '\s+', ' ', 'g')) = btrim(regexp_replace(i.name, '\s+', ' ', 'g')));

  return next;
end;
$fn$;

revoke all on function public.mst_apply_item_sheet() from public;
revoke all on function public.mst_apply_item_sheet() from anon;
grant execute on function public.mst_apply_item_sheet() to authenticated;

comment on function public.mst_apply_item_sheet() is
  'Applies mst_item_sheet_import onto mst_items by exact item name. Blank cells leave the existing value; unchanged rows are not written, so a re-run is a true no-op. Returns one report row. Runs as the caller, so RLS on mst_items decides who may do it.';
