-- Rollback for 20261212120000_bushra_central_master_shared_overrides.sql
--
-- ⚠ THIS DESTROYS EVERY SHARED VALUE THE TEAM HAS TYPED. The table IS the storage —
--   there is no second copy on the server, and the browsers that fed it retired their
--   own copies once the values were carried up. Dropping it is not a way back to the
--   old browser-only app; it is deleting the work.
--
--   Take it out first if there is any chance it is wanted:
--     \copy (select item_id, fields, updated_by, created_at, updated_at
--              from public.bushra_central_master_overrides order by item_id)
--       to 'bushra_central_master_overrides.csv' with (format csv, header);
--
--   The app's own Backup button writes the same content as JSON and is the friendlier
--   option — it restores through the app, which validates every row on the way in.
--
-- The policies and the trigger go with the table; they are listed only so the reversal
-- reads as the exact inverse of what was applied.

drop policy if exists bushra_central_master_overrides_delete on public.bushra_central_master_overrides;
drop policy if exists bushra_central_master_overrides_update on public.bushra_central_master_overrides;
drop policy if exists bushra_central_master_overrides_insert on public.bushra_central_master_overrides;
drop policy if exists bushra_central_master_overrides_select on public.bushra_central_master_overrides;
drop trigger if exists trg_bushra_central_master_overrides_updated on public.bushra_central_master_overrides;

drop table if exists public.bushra_central_master_overrides;

-- public.set_updated_at() and public.module_level(uuid, text) are shared helpers that
-- long predate this migration and are used by many other tables. Left alone.
