-- Drop the legacy generic FMS engine (the `purchase-fms` prototype).
--
-- Context: `apps/purchase-fms` was the first, linear Purchase FMS prototype. It was
-- superseded by `apps/procurement` (tables `fms_purchase_*`) and de-registered from
-- the portal some time ago — unrouted, unreachable, invisible on the launcher. Its
-- frontend folder is deleted in the same change; these tables are its last trace and
-- were causing confusion with the live `fms_purchase_*` / `fms_import_*` namespaces.
--
-- This repo is otherwise ADDITIVE-ONLY on Supabase. This drop is a deliberate,
-- user-approved exception, taken only after confirming:
--   * no other app reads or writes any of these tables (each live FMS app has its
--     own prefixed namespace: fms_purchase_*, fms_import_*, fms_hr_*, fms_exit_*,
--     fms_supplies_*);
--   * no foreign key anywhere points at them;
--   * no view or other migration depends on them.
--
-- Data (69 rows total) was dumped first to:
--   supabase/backups/20260718_legacy_fms_engine_backup.sql
-- Restore with: psql "$SUPABASE_DB_URL" -f <that file>
--
-- DELIBERATELY NOT DROPPED:
--   * public.designations — created in the same original migration, but it is a
--     SHARED master that procurement, import, hr-recruitment, hr-exit and
--     office-supplies all read, and five live `fms_*_step_owners` tables carry a
--     `designation_id` FK to it. (Those FKs are unused in practice — all 46 rows
--     have designation_id NULL, step ownership is by employee — but the table and
--     its constraints stay.)
--   * storage bucket `fms-purchase-docs` — shared with the live procurement app.

begin;

-- Child-to-parent order; no CASCADE, so an unexpected dependency aborts the
-- transaction rather than silently dropping something else.
drop table if exists public.fms_entry_stages;
drop table if exists public.fms_entries;
drop table if exists public.fms_step_fields;
drop table if exists public.fms_field_options;
drop table if exists public.fms_workflow_steps;
drop table if exists public.fms_workflows;

-- RLS/ownership helpers and the stage-completion RPC, all exclusive to the engine.
-- Signatures verified against pg_proc — a mismatched arg list makes `if exists`
-- silently no-op and leaves the function behind.
drop function if exists public.fms_complete_stage(p_entry_id uuid, p_values jsonb, p_next_planned_date date);
drop function if exists public.fms_materialize_entry_stages();
drop function if exists public.fms_is_current_owner(p_entry_id uuid, p_uid uuid);
drop function if exists public.fms_owns_step(p_step_id uuid, p_uid uuid);

commit;
