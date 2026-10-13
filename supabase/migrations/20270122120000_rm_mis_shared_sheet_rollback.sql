-- ===========================================================================
-- ROLLBACK for 20270122120000_rm_mis_shared_sheet.sql
--
-- ⚠ THIS DROPS THE RM PLANNER'S SHEET from the server (numbering, lead times,
--   consignments). Export a copy first:
--
--       copy (select key, value from public.rm_mis_state order by key)
--         to '/tmp/rm_mis_state.csv' with (format csv, header);
--
--   Each browser keeps its last copy and falls back to it, so the app keeps
--   working; what is lost is the sharing.
--
-- Nothing else is touched.
-- ===========================================================================

drop function if exists public.rm_mis_save(text, jsonb);

drop trigger if exists rm_mis_state_touch on public.rm_mis_state;

drop policy if exists rm_mis_state_select on public.rm_mis_state;
drop policy if exists rm_mis_state_write on public.rm_mis_state;

drop table if exists public.rm_mis_state;

drop function if exists public.rm_mis_touch();
