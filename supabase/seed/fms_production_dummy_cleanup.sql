-- ============================================================================
-- Production Entry FMS — scoped dummy-data cleanup
-- ============================================================================
-- The third in the series, after fms_purchase_dummy_cleanup.sql and
-- fms_other_dummy_cleanup.sql (both 17-Jul-2026). This clears the Production
-- Entry FMS (7th FMS) ahead of go-live.
--
-- Unlike the earlier two, the dummy documents here carry NO "-DEMO-" marker:
-- Production Entry was never seeded, it was hand-tested. Every one of its 17
-- job cards PRD-2627-0001..0017 (raised 22..25-Jul-2026 by Yash Agarwal and
-- Bushra) is test data, so the scope is the whole table -- which is exactly why
-- section 3 pins the expected req_no set and ABORTS on anything it does not
-- recognise. Do not relax that guard.
--
-- AUDIT (26-Jul-2026, live project icutjkrqkbzwvmnfbzpr). All 520 uuid columns
-- across the public + storage schemas were scanned for the 17 request ids:
-- ZERO hits outside the three tables deleted below. No FK points AT
-- fms_production_requests (no cascade, no child table); no DELETE trigger
-- exists (all 10 triggers are BEFORE UPDATE set_updated_at); no views.
--
-- DELETED:
--   17  fms_production_requests      PRD-2627-0001..0017
--   138 fms_production_activity      (all entity_type='request', 0 orphans)
--   219 fms_production_notifications (all entity_type='request', 0 orphans)
--   0   fms_production_master_requests (already empty; kept for parity)
--   12  email_outbox                 kind like 'production-entry\_%'
--   2   fms_production_counters      scopes 'PRD-2627' and 'BATCH'
--
-- Storage is NOT handled here -- deleting storage.objects rows over SQL orphans
-- the S3 blobs. The 10 files in bucket fms-production-docs (all owned by these
-- 17 requests; the bucket holds nothing else) are removed separately via the
-- Storage REST API, AFTER this commits.
--
-- SURVIVES -- deliberately. Real configuration and masters, NOT demo data:
--   fms_production_config          : step_sla (11 steps), batch_seq_start
--   fms_production_step_owners     : who owns each of the 12 workflow steps
--   fms_production_master_managers : per-master owners (legitimately empty)
--   fms_production_units           : KGS, PCS, LTR
--   fms_production_categories      : RAW MATERIAL
--   fms_production_raw_materials   : 73 rows
--   fms_production_fg_items        : 82 rows
--   fms_production_packaging_items : 100 rows
--   designations                   : SHARED master, read by all 7 FMS apps
-- Section 6 asserts all 9 are unchanged on BOTH count and content checksum.
-- The checksum is an upgrade over the earlier scripts' count-only snapshot: a
-- count alone cannot detect a same-count row swap.
--
-- ON email_outbox: this is the ONE genuinely shared write target across the FMS
-- apps, and `kind` is its only app discriminator. The \_ escape keeps the LIKE
-- pinned to the 'production-entry_' prefix so it cannot reach the 53 rows owned
-- by sampling_* / import_* / procurement_* / office-supplies_* / task_*.
-- Unlike the earlier scripts this delete is NOT also scoped by entity_id: all
-- 12 rows are dated 21-Jul and already point at entity ids that no longer
-- exist, so an entity-scoped delete would remove nothing.
--
-- ON THE COUNTERS: both are deleted, not zeroed -- an ABSENT row is the correct
-- "never used" state, because both counter functions are upserts:
--   next_seq('PRD-2627')  inserts last_value=1                  -> PRD-2627-0001
--   next_batch_seq()      inserts config.batch_seq_start = 1234 -> batch 1234
--   peek_batch_no()       reads null -> greatest(0+1, 1234)     -> 1234
-- This is why fms_production_config MUST survive: batch_seq_start is what makes
-- the batch reset land on 1234 rather than 1. Note req_no is UNIQUE, so the
-- reset is only safe BECAUSE all 17 rows go -- keeping any of 0001..0006 would
-- collide on the first new request.
--
-- Usage:
--   dry run : psql "$SUPABASE_DB_URL" -v commit=0 -f supabase/seed/fms_production_dummy_cleanup.sql
--   commit  : psql "$SUPABASE_DB_URL" -v commit=1 -f supabase/seed/fms_production_dummy_cleanup.sql
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------------
-- 1. Resolve the doomed document set ONCE.
-- ---------------------------------------------------------------------------
create temp table _doomed on commit drop as
select id, req_no from public.fms_production_requests;

-- ---------------------------------------------------------------------------
-- 2. Snapshot every surviving config/master table BEFORE touching anything.
--    Both count AND content checksum -- section 6 asserts byte-for-byte parity.
--    fms_production_config is keyed by `key` (no id column), so it is checksummed
--    over key||value; every other table has a uuid id.
-- ---------------------------------------------------------------------------
create temp table _config_before on commit drop as
select 'config'          t, count(*) n, md5(coalesce(string_agg(key || '=' || value::text, ',' order by key), '')) h from public.fms_production_config
union all select 'step_owners',     count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_step_owners
union all select 'master_managers', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_master_managers
union all select 'units',           count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_units
union all select 'categories',      count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_categories
union all select 'raw_materials',   count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_raw_materials
union all select 'fg_items',        count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_fg_items
union all select 'packaging_items', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_packaging_items
union all select 'designations',    count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.designations;

-- Snapshot the other apps' email_outbox rows too -- the one shared table we write to.
create temp table _outbox_before on commit drop as
select count(*) n from public.email_outbox where kind not like 'production-entry\_%';

-- ---------------------------------------------------------------------------
-- 3. Guard: the scope must be EXACTLY the 17 known test job cards. If a real
--    one has been raised since the audit, ABORT so a human can re-scope.
-- ---------------------------------------------------------------------------
do $$
declare n int; unexpected text;
begin
  select count(*) into n from _doomed;
  if n = 0   then raise exception 'ABORT: no production requests found -- already run, or wrong database'; end if;
  if n <> 17 then raise exception 'ABORT: expected 17 requests, found % -- re-scope before running', n; end if;

  select string_agg(req_no, ', ' order by req_no) into unexpected
  from _doomed
  where req_no not in ('PRD-2627-0001','PRD-2627-0002','PRD-2627-0003','PRD-2627-0004',
                       'PRD-2627-0005','PRD-2627-0006','PRD-2627-0007','PRD-2627-0008',
                       'PRD-2627-0009','PRD-2627-0010','PRD-2627-0011','PRD-2627-0012',
                       'PRD-2627-0013','PRD-2627-0014','PRD-2627-0015','PRD-2627-0016',
                       'PRD-2627-0017');
  if unexpected is not null then
    raise exception 'ABORT: unrecognised request(s) present: % -- re-scope before running', unexpected;
  end if;

  raise notice 'scope OK: 17 job cards PRD-2627-0001..0017';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Deletes, children first.
--    activity/notifications are polymorphic (entity_id has NO foreign key), so
--    nothing cascades to them -- they must go explicitly, and first.
-- ---------------------------------------------------------------------------
delete from public.fms_production_notifications where entity_id in (select id from _doomed);
delete from public.fms_production_activity      where entity_id in (select id from _doomed);

delete from public.email_outbox where kind like 'production-entry\_%';

delete from public.fms_production_master_requests;   -- already 0; parity with the earlier scripts

delete from public.fms_production_requests where id in (select id from _doomed);

delete from public.fms_production_counters where scope in ('PRD-2627', 'BATCH');

-- ---------------------------------------------------------------------------
-- 5. Snapshot AFTER.
-- ---------------------------------------------------------------------------
create temp table _config_after on commit drop as
select 'config'          t, count(*) n, md5(coalesce(string_agg(key || '=' || value::text, ',' order by key), '')) h from public.fms_production_config
union all select 'step_owners',     count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_step_owners
union all select 'master_managers', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_master_managers
union all select 'units',           count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_units
union all select 'categories',      count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_categories
union all select 'raw_materials',   count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_raw_materials
union all select 'fg_items',        count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_fg_items
union all select 'packaging_items', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.fms_production_packaging_items
union all select 'designations',    count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.designations;

-- ---------------------------------------------------------------------------
-- 6. Final assertions: every document gone, every config/master row intact,
--    every other app's outbox rows intact.
-- ---------------------------------------------------------------------------
do $$
declare
  n_req int; n_act int; n_not int; n_mr int; n_cnt int; n_ob_before int; n_ob_after int;
  bad text;
begin
  select count(*) into n_req from public.fms_production_requests;
  select count(*) into n_act from public.fms_production_activity;
  select count(*) into n_not from public.fms_production_notifications;
  select count(*) into n_mr  from public.fms_production_master_requests;
  select count(*) into n_cnt from public.fms_production_counters;

  if n_req <> 0 then raise exception 'ABORT: % request(s) left',      n_req; end if;
  if n_act <> 0 then raise exception 'ABORT: % activity row(s) left', n_act; end if;
  if n_not <> 0 then raise exception 'ABORT: % notification(s) left', n_not; end if;
  if n_mr  <> 0 then raise exception 'ABORT: % master request(s) left', n_mr; end if;
  if n_cnt <> 0 then raise exception 'ABORT: % counter row(s) left -- numbering will not reset', n_cnt; end if;

  -- No production-entry rows may remain in the shared outbox...
  if exists (select 1 from public.email_outbox where kind like 'production-entry\_%') then
    raise exception 'ABORT: production-entry rows left in email_outbox';
  end if;
  -- ...and no OTHER app's outbox rows may have been touched.
  select n into n_ob_before from _outbox_before;
  select count(*) into n_ob_after from public.email_outbox where kind not like 'production-entry\_%';
  if n_ob_before <> n_ob_after then
    raise exception 'ABORT: other apps'' email_outbox rows changed -- % -> %', n_ob_before, n_ob_after;
  end if;

  -- Every config/master table must be EXACTLY as it was, by count AND content.
  select string_agg(format('%s: %s/%s -> %s/%s', b.t, b.n, left(b.h, 8), a.n, left(a.h, 8)), ', ')
    into bad
  from _config_before b join _config_after a using (t)
  where b.n is distinct from a.n or b.h is distinct from a.h;

  if bad is not null then
    raise exception 'ABORT: configuration/master data changed -- %', bad;
  end if;

  raise notice 'OK: 17 job cards + 138 activity + 219 notifications + 12 outbox + 2 counters removed;';
  raise notice 'OK: all 9 config/master tables unchanged; % other-app outbox rows intact.', n_ob_after;
  raise notice 'NEXT: delete the 10 files in bucket fms-production-docs via the Storage REST API.';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Commit only when -v commit=1 was passed.
-- ---------------------------------------------------------------------------
\if :commit
  commit;
  \echo '>>> COMMITTED'
\else
  rollback;
  \echo '>>> DRY RUN -- rolled back, nothing changed'
\endif
