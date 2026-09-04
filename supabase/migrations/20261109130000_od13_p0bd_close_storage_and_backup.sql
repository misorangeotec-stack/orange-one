-- OD-13 · P0b + P0d — the two holes the table-policy sweep cannot reach.
--
-- P0a (20261109120000) closed 207 `USING (true)` SELECT policies. Neither of the following
-- is a policy on a `public` table, so neither was touched by it, and both are worse than
-- what P0a fixed.
--
-- P0b · SIX STORAGE BUCKETS WERE WIDE OPEN, INCLUDING DELETE
-- ----------------------------------------------------------
-- Read off pg_policies (schema `storage`, table `objects`) on 04-09-2026, five buckets
-- carried policies whose entire condition was the bucket name:
--
--     using (bucket_id = 'fms-import-docs'::text)      -- SELECT
--     with check (bucket_id = 'fms-import-docs'::text) -- INSERT
--     ... and the same for UPDATE and DELETE
--
-- for `fms-import-docs`, `fms-purchase-docs`, `fms-production-docs`, `fms-sampling-docs`
-- and `fms-asset-docs`. Any signed-in account could therefore read every proforma invoice,
-- payment advice, GRN, QC report and asset document we hold -- and overwrite or DELETE
-- them. That is a destructive grant, not merely a disclosure one, and it is handed to the
-- first customer login on the day it is created.
--
-- The other six buckets were already properly gated and are untouched: fms-dispatch-docs
-- (fms_dispatch_can_see_doc), fms-exit-docs, fms-hr-docs, fms-ocpi-docs, fms-travel-docs,
-- fms-customer-docs.
--
-- ⚠ A 21st policy matched the same pattern and is fixed with them: `fms customer docs
--   update` had a properly-gated USING but a bare WITH CHECK, so the row you were allowed
--   to update could be rewritten to any name in that bucket. Only the WITH CHECK is
--   rewritten; its USING is left exactly as it was.
--
-- P0d · ONE TABLE HAD RLS SWITCHED OFF ENTIRELY
-- ---------------------------------------------
-- `pc_resolve_rpc_backup_20261012` had `relrowsecurity = false`, and `anon` held
-- SELECT, INSERT, UPDATE, DELETE and TRUNCATE on it -- readable and destroyable with the
-- anon key alone, no login required. A policy sweep cannot reach it, because with RLS off
-- there are no policies to rewrite. Enabling RLS with no policy denies everyone but the
-- service role, which is how `_coa_test_backup_20260902` and `email_outbox` are already
-- handled in this database. Nothing reads it; it is a backup.
--
-- SAFETY
-- ------
-- Policies only, plus one `enable row level security`. No table, column or row is dropped
-- or altered. Both halves are idempotent: the storage rewrite matches only the bare
-- `(bucket_id = '…'::text)` form, so a second run finds nothing, and ENABLE RLS on an
-- already-enabled table is a no-op. Pre-state for the storage policies is in
-- `public._rls_baseline_20260904` (captured by P0a, which snapshotted `storage` as well as
-- `public`); the set altered is recorded in `public._od13_p0_touched`.

begin;

-- ---------------------------------------------------------------------------
-- P0b · storage.objects
-- ---------------------------------------------------------------------------
-- Generated from the catalogue, not a hand-written bucket list -- the same reason P0a's
-- sweep is generated. Only the clause that is bare gets rewritten; a policy whose USING is
-- already gated keeps it.
do $storage$
declare
  r record;
  v_sql   text;
  v_bare  constant text := '^\(bucket_id = ''[a-z0-9-]+''::text\)$';
  v_guard constant text := '(select public.is_staff((select auth.uid())))';
  n integer := 0;
begin
  for r in
    select policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and (qual ~ v_bare or with_check ~ v_bare)
     order by policyname, cmd
  loop
    v_sql := format('alter policy %I on storage.objects', r.policyname);

    if r.qual ~ v_bare then
      v_sql := v_sql || format(' using ((%s) and %s)', r.qual, v_guard);
    end if;
    if r.with_check ~ v_bare then
      v_sql := v_sql || format(' with check ((%s) and %s)', r.with_check, v_guard);
    end if;

    execute v_sql;

    insert into public._od13_p0_touched (schemaname, tablename, policyname, phase)
    values ('storage', 'objects', r.policyname || ' [' || r.cmd || ']', 'p0b-storage');

    n := n + 1;
  end loop;

  raise notice 'OD-13 P0b: % storage policies guarded with is_staff().', n;
end $storage$;

-- ---------------------------------------------------------------------------
-- P0d · the backup table with no RLS
-- ---------------------------------------------------------------------------
alter table public.pc_resolve_rpc_backup_20261012 enable row level security;
-- Deliberately no policy: RLS on with none defined denies every role except service_role.

-- ---------------------------------------------------------------------------
-- Prove both, before anyone can see the result.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n_bare    integer;
  n_no_rls  integer;
  n_policies integer;
begin
  select count(*) into n_bare
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and ( qual       ~ '^\(bucket_id = ''[a-z0-9-]+''::text\)$'
        or with_check ~ '^\(bucket_id = ''[a-z0-9-]+''::text\)$' );
  if n_bare <> 0 then
    raise exception 'OD-13 P0b: % storage policies still gate on the bucket name alone', n_bare;
  end if;

  select count(*) into n_no_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if n_no_rls <> 0 then
    raise exception 'OD-13 P0d: % tables in public still have RLS switched off', n_no_rls;
  end if;

  select count(*) into n_policies
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'pc_resolve_rpc_backup_20261012';
  if n_policies <> 0 then
    raise exception 'OD-13 P0d: the backup table has % policies -- it must have none (deny all)', n_policies;
  end if;

  raise notice 'OD-13 P0b/P0d verified: 0 bare storage policies, 0 tables without RLS, backup denies all.';
end $verify$;

commit;
