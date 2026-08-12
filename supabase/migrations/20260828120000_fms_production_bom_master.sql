-- ===========================================================================
-- PRODUCTION ENTRY FMS — BOM MASTER (FG item → BOM → raw material → split %).
--
-- Until now a BOM existed ONLY per job card, as the intake-only
-- fms_production_requests.bom_lines jsonb (20260728120000). Every issue slip was
-- therefore typed from scratch: nothing in the system linked an FG item to the
-- raw materials it consumes, so the recipe lived in people's heads and in
-- spreadsheets. This adds the standing master those cards should have been
-- reading all along, so picking an FG can auto-populate the raw-material lines.
--
-- SHAPE. An FG can have SEVERAL BOMs (alternate formulations — the source sheet
-- has three for "KY REACTIVE INK BLACK MCT"), so this is a header/line pair, not
-- a flat master. One BOM per FG is marked `is_default` and is the one a job card
-- reaches for; the user can switch to any other, or use none at all and type the
-- lines by hand exactly as before. A BOM is an accelerator, never a gate.
--
-- ⚠ `pct` IS THE SOURCE OF TRUTH — not a quantity. Everything downstream is
-- `fg_qty * pct / 100`, which is precisely the "Proportion Dosage (In %)" column
-- the printed issue slip already renders. Deliberately NOT stored:
--   • base_qty — 1000 for every row of the source sheet and display-only;
--     storing it invites someone to edit it and expect the percentages to move.
--     The importer reads the base from the sheet's own header row to derive pct.
--   • unit_id  — the unit already belongs to the raw material's master and the
--     Unit cell on a job card is read-only off it. A second copy here could
--     disagree with no rule for which wins.
--
-- ⚠ NO `check (pct <= 100)` and no "must total 100" rule anywhere. Two BOMs in
-- the source data legitimately total 333 and 428 per 1000, and a component can
-- exceed the batch base in an odd formulation. Totals are shown, never enforced.
--
-- Purely ADDITIVE — no existing table, column, constraint or function is
-- altered except the one master_managers CHECK widening in section 3, and the
-- fms_production_requests.bom_lines wire shape is untouched (the extra `pct` /
-- `bom_id` keys the UI now sends ride through the existing jsonb_agg normalise
-- in fms_production_submit_request / _update_request for free).
--
-- Reversal (in this order):
--   drop function if exists public.fms_production_import_boms(jsonb);
--   drop function if exists public.fms_production_save_bom(jsonb);
--   drop table if exists public.fms_production_bom_components;
--   drop table if exists public.fms_production_boms;
--   alter table public.fms_production_master_managers
--     drop constraint if exists fms_production_master_managers_master_type_check;
--   alter table public.fms_production_master_managers
--     add constraint fms_production_master_managers_master_type_check
--     check (master_type in ('category','raw_material','fg_item','unit','packaging_item'));
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_production_boms (
  id          uuid primary key default gen_random_uuid(),
  fg_item_id  uuid not null references public.fms_production_fg_items on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fg_item_id, name)
);
comment on table public.fms_production_boms is
  'BOM master header for Production Entry FMS: one named formulation of one FG item. An FG may have several; the one flagged is_default is what a job card auto-loads. Note a BOM name may legitimately equal its FG item name (the source sheet has such a row) — never assume they differ.';

create table if not exists public.fms_production_bom_components (
  id              uuid primary key default gen_random_uuid(),
  bom_id          uuid not null references public.fms_production_boms on delete cascade,
  raw_material_id uuid not null references public.fms_production_raw_materials on delete cascade,
  pct             numeric(12,6) not null default 0 check (pct >= 0),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (bom_id, raw_material_id)
);
comment on column public.fms_production_bom_components.pct is
  'This raw material''s share of the FG quantity, as a percentage. THE stored value — quantities are always derived as fg_qty * pct / 100, never the other way round. numeric(12,6) so the source sheet''s 0.4-per-1000 line survives as an exact 0.04%. Components are NOT required to total 100.';

-- One default BOM per FG. Enforced here rather than in the client because a
-- half-applied "clear A, set B" would silently leave an FG with no default and
-- autofill would just quietly stop working. Safe only because EVERY write goes
-- through fms_production_save_bom below, which does both halves in one
-- transaction — this table is deliberately never written directly under RLS.
create unique index if not exists fms_production_boms_one_default_idx
  on public.fms_production_boms (fg_item_id) where is_default and active;

create index if not exists fms_production_boms_fg_idx
  on public.fms_production_boms (fg_item_id);
create index if not exists fms_production_bom_components_bom_idx
  on public.fms_production_bom_components (bom_id);

drop trigger if exists trg_fms_production_boms_updated on public.fms_production_boms;
create trigger trg_fms_production_boms_updated
  before update on public.fms_production_boms for each row execute function public.set_updated_at();

drop trigger if exists trg_fms_production_bom_components_updated on public.fms_production_bom_components;
create trigger trg_fms_production_bom_components_updated
  before update on public.fms_production_bom_components for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — select for every signed-in user (dropdown + autofill fodder), write
--    for admins and the 'bom' master's assigned owner. Same shape as the four
--    flat masters in 20260725120000_add_fms_production_foundations.sql.
-- ---------------------------------------------------------------------------
alter table public.fms_production_boms enable row level security;
drop policy if exists fms_production_boms_select on public.fms_production_boms;
create policy fms_production_boms_select on public.fms_production_boms
  for select to authenticated using (true);

drop policy if exists fms_production_boms_write on public.fms_production_boms;
create policy fms_production_boms_write on public.fms_production_boms
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('bom', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('bom', auth.uid()));

alter table public.fms_production_bom_components enable row level security;
drop policy if exists fms_production_bom_components_select on public.fms_production_bom_components;
create policy fms_production_bom_components_select on public.fms_production_bom_components
  for select to authenticated using (true);

drop policy if exists fms_production_bom_components_write on public.fms_production_bom_components;
create policy fms_production_bom_components_write on public.fms_production_bom_components
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('bom', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('bom', auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Let a 'bom' owner be assigned (Setup → Master Owners).
--
--    ⚠ ONLY fms_production_master_managers is widened. 'bom' is deliberately
--    NOT added to fms_production_master_requests, and NOT given an arm in
--    fms_production_resolve_master_request: a header-plus-lines record does not
--    fit the single-payload "request a new master" modal, so BOMs are created on
--    their own screen rather than requested. The frontend keeps 'bom' out of
--    PRODUCTION_MASTER_TYPES for exactly the same reason (the same trick
--    'category' already uses), which keeps it out of that modal automatically.
-- ---------------------------------------------------------------------------
alter table public.fms_production_master_managers
  drop constraint if exists fms_production_master_managers_master_type_check;
alter table public.fms_production_master_managers
  add constraint fms_production_master_managers_master_type_check
  check (master_type in ('category','raw_material','fg_item','unit','packaging_item','bom'));

-- ---------------------------------------------------------------------------
-- 4. RPC — save one BOM (header + its complete component list) atomically.
--
--    p = { id?, fg_item_id, name, is_default?, active?, sort_order?,
--          components: [ { raw_material_id, pct, sort_order? } ] }
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_save_bom(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid    := auth.uid();
  v_id      uuid    := nullif(p->>'id', '')::uuid;
  v_fg      uuid    := nullif(p->>'fg_item_id', '')::uuid;
  v_name    text    := nullif(trim(p->>'name'), '');
  v_active  boolean := coalesce((p->>'active')::boolean, true);
  v_default boolean := coalesce((p->>'is_default')::boolean, false);
  v_sort    integer := coalesce((p->>'sort_order')::integer, 0);
  v_comps   jsonb   := coalesce(p->'components', '[]'::jsonb);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not (public.is_admin(v_uid) or public.fms_production_is_master_manager('bom', v_uid)) then
    raise exception 'Not allowed to manage BOMs';
  end if;
  if v_fg is null then raise exception 'FG item is required'; end if;
  if v_name is null then raise exception 'BOM name is required'; end if;
  if jsonb_typeof(v_comps) <> 'array' then raise exception 'components must be a JSON array'; end if;

  -- A deactivated BOM can never stay the default: it is unpickable, so leaving
  -- the flag on would strand the FG's autofill on a recipe nobody can select.
  if not v_active then v_default := false; end if;

  -- ⚠ Clear the FG's previous default BEFORE setting this one. The partial
  -- unique index permits exactly one, so setting first would raise.
  if v_default then
    update public.fms_production_boms
       set is_default = false
     where fg_item_id = v_fg
       and is_default
       and (v_id is null or id <> v_id);
  end if;

  if v_id is null then
    insert into public.fms_production_boms (fg_item_id, name, is_default, active, sort_order, created_by)
    values (v_fg, v_name, v_default, v_active, v_sort, v_uid)
    returning id into v_id;
  else
    update public.fms_production_boms
       set fg_item_id = v_fg, name = v_name, is_default = v_default,
           active = v_active, sort_order = v_sort
     where id = v_id;
    if not found then raise exception 'BOM not found'; end if;
  end if;

  -- Components are private children of their BOM, so the save REPLACES them
  -- rather than diffing. A hard delete is safe here ONLY because this runs
  -- inside one transaction — the same delete-then-insert split across two
  -- supabase-js calls could wipe a BOM outright if the insert failed.
  delete from public.fms_production_bom_components where bom_id = v_id;

  insert into public.fms_production_bom_components (bom_id, raw_material_id, pct, sort_order)
  select v_id,
         (c->>'raw_material_id')::uuid,
         greatest(coalesce((c->>'pct')::numeric, 0), 0),
         coalesce((c->>'sort_order')::integer, (ord - 1)::integer)
    from jsonb_array_elements(v_comps) with ordinality as t(c, ord)
   where coalesce(trim(c->>'raw_material_id'), '') <> ''
  on conflict (bom_id, raw_material_id) do update
    set pct = excluded.pct, sort_order = excluded.sort_order;

  return v_id;
end $$;
grant execute on function public.fms_production_save_bom(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC — apply a whole parsed spreadsheet of BOMs.
--
--    p = { boms: [ { fg_item, bom_name, components: [ { raw_material, pct } ] } ] }
--
--    ⚠ THIS MUST BE SECURITY DEFINER, and not for convenience. It creates any
--    missing FG item / raw material master rows, but those two tables' write
--    policies require is_admin OR is_master_manager('fg_item' | 'raw_material').
--    A BOM owner who does not also own those two masters would otherwise sail
--    past the check below and then hit a silent RLS failure halfway through the
--    import. So the permission check is made explicitly here, once, and the
--    inserts then run under definer rights.
--
--    Matching is case-insensitive and trimmed, and matches INACTIVE masters too
--    — they are hidden from dropdowns but the unique index still blocks a
--    duplicate insert, so a case-sensitive match would try to create "DM Water"
--    beside an existing "DM WATER" and simply fail.
--
--    Idempotent: keyed on (fg_item, bom_name), components replaced wholesale.
--    Re-running the same sheet changes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_import_boms(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid    := auth.uid();
  v_boms     jsonb   := coalesce(p->'boms', '[]'::jsonb);
  b          jsonb;
  c          jsonb;
  v_fg_id    uuid;
  v_rm_id    uuid;
  v_bom_id   uuid;
  v_fg_name  text;
  v_bom_name text;
  v_rm_name  text;
  v_added    integer := 0;
  v_updated  integer := 0;
  v_fg_new   integer := 0;
  v_rm_new   integer := 0;
  v_lines    integer := 0;
  v_idx      integer;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not (public.is_admin(v_uid) or public.fms_production_is_master_manager('bom', v_uid)) then
    raise exception 'Not allowed to manage BOMs';
  end if;
  if jsonb_typeof(v_boms) <> 'array' then raise exception 'boms must be a JSON array'; end if;

  for b in select jsonb_array_elements(v_boms) loop
    v_fg_name  := nullif(trim(b->>'fg_item'), '');
    v_bom_name := nullif(trim(b->>'bom_name'), '');
    continue when v_fg_name is null or v_bom_name is null;

    -- FG item — match case-insensitively, create if genuinely absent.
    select id into v_fg_id
      from public.fms_production_fg_items
     where upper(name) = upper(v_fg_name)
     limit 1;
    if v_fg_id is null then
      insert into public.fms_production_fg_items (name, created_by)
      values (v_fg_name, v_uid)
      returning id into v_fg_id;
      v_fg_new := v_fg_new + 1;
    end if;

    select id into v_bom_id
      from public.fms_production_boms
     where fg_item_id = v_fg_id and upper(name) = upper(v_bom_name)
     limit 1;

    if v_bom_id is null then
      -- The first BOM imported for an FG that has none becomes its default, so a
      -- fresh import is immediately usable without a manual pass.
      insert into public.fms_production_boms (fg_item_id, name, active, sort_order, created_by, is_default)
      values (
        v_fg_id, v_bom_name, true,
        coalesce((b->>'sort_order')::integer, 0), v_uid,
        not exists (
          select 1 from public.fms_production_boms
           where fg_item_id = v_fg_id and is_default and active
        )
      )
      returning id into v_bom_id;
      v_added := v_added + 1;
    else
      update public.fms_production_boms set active = true where id = v_bom_id;
      v_updated := v_updated + 1;
    end if;

    delete from public.fms_production_bom_components where bom_id = v_bom_id;

    v_idx := 0;
    for c in select jsonb_array_elements(coalesce(b->'components', '[]'::jsonb)) loop
      v_rm_name := nullif(trim(c->>'raw_material'), '');
      continue when v_rm_name is null;

      select id into v_rm_id
        from public.fms_production_raw_materials
       where upper(name) = upper(v_rm_name)
       limit 1;
      if v_rm_id is null then
        insert into public.fms_production_raw_materials (name, created_by)
        values (v_rm_name, v_uid)
        returning id into v_rm_id;
        v_rm_new := v_rm_new + 1;
      end if;

      insert into public.fms_production_bom_components (bom_id, raw_material_id, pct, sort_order)
      values (v_bom_id, v_rm_id, greatest(coalesce((c->>'pct')::numeric, 0), 0), v_idx)
      on conflict (bom_id, raw_material_id) do update
        set pct = excluded.pct, sort_order = excluded.sort_order;

      v_idx  := v_idx + 1;
      v_lines := v_lines + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'boms_added',            v_added,
    'boms_updated',          v_updated,
    'components',            v_lines,
    'fg_items_created',      v_fg_new,
    'raw_materials_created', v_rm_new
  );
end $$;
grant execute on function public.fms_production_import_boms(jsonb) to authenticated;
