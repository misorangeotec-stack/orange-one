-- ===========================================================================
-- INK IMS: the planner's sheet becomes shared, instead of living in one browser.
--
-- WHY
--   Ink IMS was built browser-local on purpose — no table, no migration, every
--   typed value in localStorage under `ink-mis:*`. That was the right call while
--   one person was proving the sheet out, and it is why the stock figures were
--   live and identical everywhere while the NUMBERING was not: open the app on a
--   second PC and the dashboard reads "Inks 0", because the dashboard shows only
--   items the planner has numbered and that numbering never left her machine.
--   Logging in as Admin on the SAME desktop showed the data, which looks like a
--   permission bug and is not: localStorage belongs to the browser profile, not
--   to the app login.
--
--   The sheet now has more than one reader, so it needs one home.
--
-- WHAT THIS CREATES
--   public.ink_mis_state — one row per stored key, value as jsonb. One shared
--   sheet for the whole company, not one per user.
--
-- WHY KEY/VALUE AND NOT A TABLE PER CONCERN
--   The app already serialises each part of the sheet to JSON under its own key,
--   and reads it back the same way. Keeping that shape means the planning logic
--   is untouched by this migration: the same nine documents, in a place everyone
--   can reach. Normalising the item master into columns would be a second,
--   larger change to make on top of a live sheet, and buys nothing until
--   something other than this app needs to query it.
--
-- WHAT STAYS IN THE BROWSER, DELIBERATELY
--   Column widths, row heights, the chart label width and the "lines I have
--   already seen" marker for the new-arrival prompt. Those are one person's view
--   of the sheet, not the sheet. Sharing them would mean one user's column drag
--   resizing everybody's screen.
--
-- ACCESS — the house rule, nothing new invented.
--   Read   : anyone with any grant on 'ink-mis' (view or edit).
--   Write  : only `edit`, via public.module_can_edit(). Admins resolve to 'edit'
--            inside module_level(), so they keep working as they do today.
--   Grants are given on the ordinary Users → app access screen, exactly like
--   every other module. There is no separate Ink IMS permission screen.
--
-- ADDITIVE ONLY. One new table, one trigger, one function. Nothing existing is
-- dropped, narrowed or rewritten. Written to be safe if re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.ink_mis_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

comment on table public.ink_mis_state is
  'Ink IMS: the planner''s shared sheet. One row per stored document (item master, numbering, lead times, categories, ETD/ETA consignments, thresholds, holidays, godown choice). One sheet for the company, not one per user. Read needs any ink-mis grant; write needs edit. See 20261227120000.';

comment on column public.ink_mis_state.key is
  'The document name, matching the browser key it replaces: ink-mis:items:v1, ink-mis:order:v1, ink-mis:plans:v1, ink-mis:lines:v1, ink-mis:groups:v1, ink-mis:shipments:v1, ink-mis:thresholds:v1, ink-mis:holidays:v1, ink-mis:godowns:v1.';

comment on column public.ink_mis_state.value is
  'The document, exactly as the app serialises it. Opaque to the database on purpose — the planning logic owns its shape.';

comment on column public.ink_mis_state.updated_by is
  'Who last saved this document. Set by trigger from auth.uid(), never by the client.';

-- ---------------------------------------------------------------------------
-- B. Stamp every write here, not in the browser.
--
-- A client clock can be wrong or simply lie, and "who changed the numbering"
-- is the first question asked when a number moves unexpectedly. Both answers
-- are taken from the database session instead.
-- ---------------------------------------------------------------------------
create or replace function public.ink_mis_touch()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$fn$;

comment on function public.ink_mis_touch() is
  'Ink IMS: stamp updated_at/updated_by from the database session on every write to ink_mis_state. See 20261227120000.';

drop trigger if exists ink_mis_state_touch on public.ink_mis_state;
create trigger ink_mis_state_touch
  before insert or update on public.ink_mis_state
  for each row execute function public.ink_mis_touch();

-- ---------------------------------------------------------------------------
-- C. Access, on the existing module gates.
--
-- module_level() already resolves an admin to 'edit' and a missing grant to
-- 'none', so both policies are one call each and there is no second rule to
-- keep in step with the Users screen.
-- ---------------------------------------------------------------------------
alter table public.ink_mis_state enable row level security;

drop policy if exists ink_mis_state_select on public.ink_mis_state;
create policy ink_mis_state_select on public.ink_mis_state
  for select to authenticated
  using (public.module_level(auth.uid(), 'ink-mis') <> 'none');

drop policy if exists ink_mis_state_write on public.ink_mis_state;
create policy ink_mis_state_write on public.ink_mis_state
  for all to authenticated
  using (public.module_can_edit(auth.uid(), 'ink-mis'))
  with check (public.module_can_edit(auth.uid(), 'ink-mis'));

grant select, insert, update, delete on public.ink_mis_state to authenticated;

-- ---------------------------------------------------------------------------
-- D. Saving a document.
--
-- The app hands over one document at a time and expects last-write-wins within
-- that document, which is what an upsert on the primary key gives. It is a
-- function rather than a bare upsert from the client so that the write surface
-- is one named thing that can be tightened later (a version check, an audit
-- row) without touching the app.
--
-- SECURITY INVOKER on purpose: the RLS policy above is the gate, so a view-only
-- grant is refused by the database and not merely by a hidden button.
-- ---------------------------------------------------------------------------
create or replace function public.ink_mis_save(p_key text, p_value jsonb)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_at timestamptz;
begin
  if p_key is null or p_key = '' then
    raise exception 'ink_mis_save: key is required';
  end if;
  if p_value is null then
    raise exception 'ink_mis_save: value is required (use an empty object, not null)';
  end if;

  insert into public.ink_mis_state (key, value)
  values (p_key, p_value)
  on conflict (key) do update set value = excluded.value
  returning updated_at into v_at;

  return v_at;
end;
$fn$;

comment on function public.ink_mis_save(text, jsonb) is
  'Ink IMS: save one document of the shared sheet, last write wins within that document. Refused by RLS for a view-only grant. See 20261227120000.';

revoke all on function public.ink_mis_save(text, jsonb) from public, anon;
grant execute on function public.ink_mis_save(text, jsonb) to authenticated;
