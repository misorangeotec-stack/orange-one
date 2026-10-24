-- ===========================================================================
-- RM IMS: the planner's sheet is saved on the server, not in one browser.
--
-- WHY
--   RM IMS went live (PR #56) as a copy of Ink IMS with sharing switched off:
--   the numbering, lead times, Import/Plant, ETD/ETA consignments and the rest
--   lived only in localStorage under `rm-mis:*`. Opening it on another PC or
--   another browser showed an empty sheet, and clearing the browser lost it.
--   This gives RM IMS the same home Ink IMS has (20261227120000).
--
-- WHY ITS OWN TABLE, NOT ink_mis_state
--   Access follows the module grant. RM IMS has its own grant ('rm-mis'),
--   separate from Ink IMS on purpose, so its sheet needs RLS on 'rm-mis'. Sharing
--   ink_mis_state would make RM readable by Ink users and unwritable by an RM-only
--   user.
--
-- WHAT THIS CREATES
--   public.rm_mis_state — one row per document (key = the browser key it
--   replaces, value = jsonb). One sheet for the company, not one per user.
--   public.rm_mis_save(key, value) — upsert, last write wins per document.
--
-- WHAT STAYS IN THE BROWSER, DELIBERATELY
--   Column widths, row heights, chart sizes and the "already seen" marker:
--   one person's view of the sheet, not the sheet.
--
-- FIRST OPEN. The app seeds the empty table from the first browser with edit
--   rights that holds a sheet; after that the server is the truth.
--
-- ACCESS — the house rule.
--   Read  : any grant on 'rm-mis' (view or edit).
--   Write : only `edit`, via public.module_can_edit(). Admins are edit.
--
-- ADDITIVE ONLY. One table, one trigger, two functions. Safe to re-run.
-- ===========================================================================

-- A. The table.
create table if not exists public.rm_mis_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

comment on table public.rm_mis_state is
  'RM IMS: the planner''s shared sheet. One row per stored document (item master, numbering, lead times, categories, ETD/ETA consignments, thresholds, holidays, godown choice). Read needs any rm-mis grant; write needs edit. See 20270122120000.';

comment on column public.rm_mis_state.key is
  'The document name, matching the browser key it replaces: rm-mis:items:v1, rm-mis:order:v1, rm-mis:plans:v1, rm-mis:lines:v1, rm-mis:groups:v1, rm-mis:shipments:v1, rm-mis:thresholds:v1, rm-mis:holidays:v1, rm-mis:godowns:v1.';

comment on column public.rm_mis_state.value is
  'The document, exactly as the app serialises it. Opaque to the database on purpose.';

comment on column public.rm_mis_state.updated_by is
  'Who last saved this document. Set by trigger from auth.uid(), never by the client.';

-- B. Stamp every write from the database session, not the browser.
create or replace function public.rm_mis_touch()
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

comment on function public.rm_mis_touch() is
  'RM IMS: stamp updated_at/updated_by on every write to rm_mis_state. See 20270122120000.';

drop trigger if exists rm_mis_state_touch on public.rm_mis_state;
create trigger rm_mis_state_touch
  before insert or update on public.rm_mis_state
  for each row execute function public.rm_mis_touch();

-- C. Access, on the existing module gates.
alter table public.rm_mis_state enable row level security;

drop policy if exists rm_mis_state_select on public.rm_mis_state;
create policy rm_mis_state_select on public.rm_mis_state
  for select to authenticated
  using (public.module_level(auth.uid(), 'rm-mis') <> 'none');

drop policy if exists rm_mis_state_write on public.rm_mis_state;
create policy rm_mis_state_write on public.rm_mis_state
  for all to authenticated
  using (public.module_can_edit(auth.uid(), 'rm-mis'))
  with check (public.module_can_edit(auth.uid(), 'rm-mis'));

grant select, insert, update, delete on public.rm_mis_state to authenticated;

-- D. Saving a document. SECURITY INVOKER: the RLS above is the gate.
create or replace function public.rm_mis_save(p_key text, p_value jsonb)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_at timestamptz;
begin
  if p_key is null or p_key = '' then
    raise exception 'rm_mis_save: key is required';
  end if;
  if p_value is null then
    raise exception 'rm_mis_save: value is required (use an empty object, not null)';
  end if;

  insert into public.rm_mis_state (key, value)
  values (p_key, p_value)
  on conflict (key) do update set value = excluded.value
  returning updated_at into v_at;

  return v_at;
end;
$fn$;

comment on function public.rm_mis_save(text, jsonb) is
  'RM IMS: save one document of the shared sheet, last write wins within that document. Refused by RLS for a view-only grant. See 20270122120000.';

revoke all on function public.rm_mis_save(text, jsonb) from public, anon;
grant execute on function public.rm_mis_save(text, jsonb) to authenticated;
