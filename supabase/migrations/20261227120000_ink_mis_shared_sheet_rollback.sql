-- ===========================================================================
-- ROLLBACK for 20261227120000_ink_mis_shared_sheet.sql
--
-- ⚠ THIS DROPS THE PLANNER'S SHEET. The numbering series, lead times, item
--   codes, categories and the ETD/ETA consignments all live in
--   public.ink_mis_state and nowhere else on the server. Export a copy first:
--
--       copy (select key, value from public.ink_mis_state order by key)
--         to '/tmp/ink_mis_state.csv' with (format csv, header);
--
--   or from the app: Ink IMS → ETD / ETA → Export backup, on a machine whose
--   browser already holds the sheet.
--
--   Rolling back does NOT strand the planner: the app keeps its browser copy of
--   every document and falls back to it when the table is unreachable, so an
--   individual machine carries on with what it last saw. What is lost is the
--   sharing, and anything typed on another machine that this browser never read.
--
-- Nothing else is touched. app_access, module_level() and module_can_edit() are
-- untouched by the forward migration and untouched here.
-- ===========================================================================

drop function if exists public.ink_mis_save(text, jsonb);

drop trigger if exists ink_mis_state_touch on public.ink_mis_state;

drop policy if exists ink_mis_state_select on public.ink_mis_state;
drop policy if exists ink_mis_state_write on public.ink_mis_state;

drop table if exists public.ink_mis_state;

drop function if exists public.ink_mis_touch();
