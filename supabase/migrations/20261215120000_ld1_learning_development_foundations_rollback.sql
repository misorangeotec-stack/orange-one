-- ===========================================================================
-- ROLLBACK for 20261215120000_ld1_learning_development_foundations.sql
--
-- Undoes the Learning & Development foundations: masters, governance, config,
-- counters, activity/notifications, the authz helpers and the storage bucket.
--
-- ⚠ RUN PART 2'S ROLLBACK FIRST
--   (20261215120100_ld1_learning_development_workflow_rollback.sql). The
--   workflow tables carry FKs into these masters with `on delete restrict`, so
--   dropping in the wrong order fails loudly — which is the right failure, but
--   it means this file alone is not "the rollback".
--
-- ⚠ NOTHING HERE IS DESTRUCTIVE TO ANY OTHER MODULE. Only fms_ld_* objects and
--   the four storage policies whose names are unique to this module are touched.
--   public.set_updated_at() and public.is_admin() are shared and are left alone.
--
-- ⚠ THE BUCKET IS NOT DROPPED, AND IT CANNOT BE — FOUND BY REHEARSING THIS FILE
--   ON THE LIVE DATABASE, 21-09-2026. Supabase installs a `storage.protect_delete()`
--   trigger that refuses a direct DELETE from BOTH storage.objects AND
--   storage.buckets:
--       ERROR 42501: Direct deletion from storage tables is not allowed.
--                    Use the Storage API instead.
--   So the two lines this file used to carry — copied from the reversal comment
--   in 20260801120000_add_fms_dispatch_foundations.sql — would have aborted the
--   whole rollback at its last step, after the tables were already gone.
--
--   ⚠ EVERY OTHER MODULE HERE DOCUMENTS THE SAME BROKEN LINE (dispatch, and the
--     ones it was copied from). Their reversals have never been run. If you are
--     rolling one of those back, expect this and drop the bucket through the
--     Storage API or the dashboard instead.
--
--   Removing the bucket is therefore a MANUAL step, deliberately left to a human
--   because it destroys files that no table backup can restore — proposals,
--   quotations, material, attendance sheets, session evidence and every
--   employee's assignment submission. Empty it and delete it from
--   Dashboard → Storage → fms-ld-docs, or leave it: an empty, unreferenced
--   private bucket costs nothing and breaks nothing.
-- ===========================================================================

-- ---- storage ---------------------------------------------------------------
-- Policies only. See the ⚠ above for why the bucket itself is left standing.
drop policy if exists "fms ld docs read"   on storage.objects;
drop policy if exists "fms ld docs insert" on storage.objects;
drop policy if exists "fms ld docs update" on storage.objects;
drop policy if exists "fms ld docs delete" on storage.objects;

-- ---- tables (reverse of creation order) ------------------------------------
-- ⚠ TABLES BEFORE FUNCTIONS, and that order is load-bearing — found by
--   rehearsing this file on 21-09-2026:
--       ERROR 2BP01: cannot drop function fms_ld_is_master_manager(text,uuid)
--                    because other objects depend on it
--                    DETAIL: policy fms_ld_session_types_write … depends on it
--   Eight RLS policies call that function, and a policy is a dependent object.
--   Dropping the function first aborts the rollback half-done; dropping the
--   tables takes their policies with them, and the functions then drop cleanly.
--   `drop … cascade` would also work and is deliberately NOT used: on a shared
--   database, cascade silently removes whatever else happens to depend on the
--   object, which is the opposite of what a rollback should do.
--
--   ⚠ The reversal comments in the other FMS foundations migrations list
--     functions first. They are wrong for the same reason, and have never run.
drop table if exists public.fms_ld_master_requests;
drop table if exists public.fms_ld_master_managers;
drop table if exists public.fms_ld_followup_actions;
drop table if exists public.fms_ld_delay_reasons;
drop table if exists public.fms_ld_trainers;
drop table if exists public.fms_ld_venues;
drop table if exists public.fms_ld_need_sources;
drop table if exists public.fms_ld_competencies;
drop table if exists public.fms_ld_session_types;
drop table if exists public.fms_ld_notifications;
drop table if exists public.fms_ld_activity;
drop table if exists public.fms_ld_counters;
drop table if exists public.fms_ld_config;
drop table if exists public.fms_ld_step_owners;

-- ---- functions (now that no policy references them) ------------------------
drop function if exists public.fms_ld_resolve_master_request(uuid, boolean, jsonb, text);
drop function if exists public.fms_ld_is_master_manager(text, uuid);
drop function if exists public.fms_ld_announce(text, uuid, text, text, uuid[], jsonb);
drop function if exists public.fms_ld_is_hod_of(uuid, uuid);
drop function if exists public.fms_ld_hods_of(uuid);
drop function if exists public.fms_ld_step_owner_ids(text);
drop function if exists public.fms_ld_is_coordinator(uuid);
drop function if exists public.fms_ld_is_step_owner(text, uuid);
drop function if exists public.fms_ld_fy_code(date);
drop function if exists public.fms_ld_next_seq(text);
