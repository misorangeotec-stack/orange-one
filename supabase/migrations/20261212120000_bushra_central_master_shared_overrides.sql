-- Bushra Central Master — move the item overrides off the browser and onto the server.
--
-- WHAT CHANGES, AND WHY
--   The app was built browser-only on purpose: every value typed into its grid lived
--   in that one person's localStorage, under a key carrying their user id, seen by
--   nobody else. That was the right call for a private mirror and the wrong one the
--   moment the work became the team's — the values are now asked to be visible to
--   everyone, which a per-browser store cannot do at all. This table is that move.
--
--   Asked for 24-09-2026. It reverses the "no DB table" decision this app shipped
--   with (the same one Ink IMS still holds); nothing else about the app changes.
--
-- ⚠ CENTRAL MASTERS IS STILL NEVER WRITTEN. This is an OVERLAY beside mst_items, not
--   an edit to it. The grid keeps reading items live from mst_items and keeps storing
--   only the fields that DISAGREE with what Tally and Central say, so a correction
--   made centrally still flows into every field nobody has typed over. No mst_* table,
--   column or row is touched by this migration or by the app that uses it.
--
-- ⚠ WHAT IS SHARED IS THE SAVED VALUES, AND ONLY THOSE. Two things stay in the
--   browser because they are about one reader rather than about the item:
--     · unsaved drafts — half-typed edits nobody else should see, let alone inherit
--     · the "New from central" seen-list — which items THIS person has already looked at
--   Putting either on the server would make one person's reading state everyone's.
--
-- ⚠ ONE SET OF VALUES NOW, SO THE LAST SAVE WINS. Per-browser storage could not
--   collide; a shared row can. The write is a whole-row upsert per item, so two people
--   editing the SAME item resolve to whoever saved last — the same rule every other
--   master in this portal follows. Different items never contend.
--
-- ACCESS — everyone sees, only editors change, which is what was asked for.
--   Reads need any grant on the app; writes need it at 'edit'. `module_level` is the
--   portal's own answer to "what may this person do in this app?" (20260906120000),
--   and admins always read 'edit' there, so they are covered without being named.
--   Nothing here invents a second permission model.
--
-- Purely ADDITIVE: one new table, nothing existing altered. Reuses public.set_updated_at()
-- and public.module_level(uuid, text). Apply in the Orange One *identity* project
-- (ref coshondiqdhorwvibrwu). Reversal: see the _rollback.sql beside this file.

create table if not exists public.bushra_central_master_overrides (
  -- The central item this overlays. CASCADE is safe and correct: masters-sync upserts
  -- on tally_guid and never deletes (see functions/masters-sync/index.ts), so an id
  -- disappearing means the item is genuinely gone, and an overlay on nothing is noise.
  item_id    uuid primary key references public.mst_items on delete cascade,

  /*
    ⚠ JSONB, AND DELIBERATELY NOT EIGHT COLUMNS. The app must tell "this field was
      never touched" from "this field was deliberately cleared" — an absent key from a
      null one. That distinction IS the mirror: an untouched field keeps following
      Central, a cleared one is the user's own blank and must not silently refill.
      Separate columns collapse both onto NULL and would need a second column listing
      which keys are really set; the object already says so exactly.

      Shape (every key optional, which is the point):
        itemType, category, inkType, groupName, color, code, description  — text | null
        active                                                            — boolean
      The client validates it on the way in AND on the way out (lib/store.ts,
      cleanOverride), because a row of the wrong shape would otherwise crash the grid
      on render for everyone, on every load, for as long as it sat there.
  */
  fields     jsonb not null default '{}'::jsonb,

  updated_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An object, never a list or a bare scalar. Cheap, and it stops a malformed write
  -- at the door rather than at every reader's screen.
  constraint bushra_central_master_overrides_fields_is_object
    check (jsonb_typeof(fields) = 'object')
);

comment on table public.bushra_central_master_overrides is
  'Bushra Central Master: the team''s own Type / Category / Ink type / Group / Colour / Code / Description for a central item. An OVERLAY on mst_items — only fields that differ from Central and Tally are stored, and mst_items is never written. One shared row per item; see 20261212120000.';
comment on column public.bushra_central_master_overrides.fields is
  'Only the fields that DIFFER from their source. An absent key means "follows Central/Tally"; a key set to null means "deliberately blank". Collapsing the two would refill a field the user cleared on purpose.';

drop trigger if exists trg_bushra_central_master_overrides_updated on public.bushra_central_master_overrides;
create trigger trg_bushra_central_master_overrides_updated
  before update on public.bushra_central_master_overrides
  for each row execute function public.set_updated_at();

alter table public.bushra_central_master_overrides enable row level security;

-- Read: anyone the app has been granted to, at either level.
drop policy if exists bushra_central_master_overrides_select on public.bushra_central_master_overrides;
create policy bushra_central_master_overrides_select
  on public.bushra_central_master_overrides for select
  to authenticated
  using (public.module_level(auth.uid(), 'bushra-central-master') <> 'none');

/*
  Write: 'edit' only. Split into three policies rather than one FOR ALL so that a later
  change to any single verb — keeping history instead of deleting, say — does not have
  to reopen the other two. UPDATE carries WITH CHECK as well as USING so the row is
  tested both as it was found and as it is being left: USING alone permits an editor to
  write a row into a shape the policy would no longer have let them reach.
*/
drop policy if exists bushra_central_master_overrides_insert on public.bushra_central_master_overrides;
create policy bushra_central_master_overrides_insert
  on public.bushra_central_master_overrides for insert
  to authenticated
  with check (public.module_level(auth.uid(), 'bushra-central-master') = 'edit');

drop policy if exists bushra_central_master_overrides_update on public.bushra_central_master_overrides;
create policy bushra_central_master_overrides_update
  on public.bushra_central_master_overrides for update
  to authenticated
  using (public.module_level(auth.uid(), 'bushra-central-master') = 'edit')
  with check (public.module_level(auth.uid(), 'bushra-central-master') = 'edit');

drop policy if exists bushra_central_master_overrides_delete on public.bushra_central_master_overrides;
create policy bushra_central_master_overrides_delete
  on public.bushra_central_master_overrides for delete
  to authenticated
  using (public.module_level(auth.uid(), 'bushra-central-master') = 'edit');

-- ---------------------------------------------------------------- verify --
--
-- 1 · The table is there, RLS is on, and all four policies exist.
--
--   select relrowsecurity from pg_class where oid = 'public.bushra_central_master_overrides'::regclass;
--   select policyname, cmd from pg_policies
--    where tablename = 'bushra_central_master_overrides' order by cmd;
--
-- 2 · After the first person opens the app, their browser's edits appear here.
--     `carried` counts the rows the one-time adoption brought up (see lib/store.ts).
--
--   select count(*) as rows,
--          count(*) filter (where fields ? 'description') as with_description,
--          count(*) filter (where fields ? 'color')       as with_colour,
--          max(updated_at) as last_write
--     from public.bushra_central_master_overrides;
--
-- 3 · Every row still points at a live central item (CASCADE should keep this at 0).
--
--   select count(*) from public.bushra_central_master_overrides o
--    where not exists (select 1 from public.mst_items i where i.id = o.item_id);
-- ============================================================================
