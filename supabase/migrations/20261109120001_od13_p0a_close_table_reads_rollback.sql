-- OD-13 · P0a ROLLBACK — put every swept SELECT policy back exactly as it was.
--
-- This is NOT hand-transcribed. 20261109120000 captured the pre-state of every policy in
-- `public` and `storage` into `public._rls_baseline_20260904` before it altered anything,
-- and recorded the exact set it altered in `public._od13_p0_touched`. This file replays
-- the stored `qual` text for that set and nothing else, so it restores what was actually
-- there rather than what someone believed was there.
--
-- ⚠ REHEARSE IT, DO NOT JUST READ IT. Apply the forward migration, run this, and check the
--   counts printed below match the baseline before trusting either. A rollback that has
--   only ever been read is not a rollback.
--
-- WHAT IS DELIBERATELY NOT UNDONE
-- -------------------------------
-- `profiles.is_external` and `public.is_staff()` stay. Dropping a column would breach the
-- additive-only rule in CLAUDE.md, and both are inert on their own: with every row at
-- `is_external = false`, is_staff() is true for everyone and nothing consults the column
-- once the policies below no longer reference it.

begin;

do $rollback$
declare
  r record;
  n integer := 0;
begin
  for r in
    select b.tablename, b.policyname, b.roles, b.qual
      from public._rls_baseline_20260904 b
      join public._od13_p0_touched t
        on  t.schemaname = b.schemaname
        and t.tablename  = b.tablename
        and t.policyname = b.policyname
     where b.schemaname = 'public'
       and b.cmd = 'SELECT'
       and t.phase in ('p0a-sweep', 'p0a-narrow')
     group by b.tablename, b.policyname, b.roles, b.qual
  loop
    execute format(
      'alter policy %I on public.%I to %s using (%s)',
      r.policyname, r.tablename,
      case when r.roles like '%public%' then 'public' else 'authenticated' end,
      r.qual);
    n := n + 1;
  end loop;

  raise notice 'OD-13 P0a rollback: % policies restored from the baseline.', n;
end $rollback$;

-- Verify the restore actually put the open ones back, so a silently partial rollback
-- cannot pass unnoticed.
do $verify$
declare
  n_open     integer;
  n_expected integer;
begin
  select count(*) into n_expected
    from public._rls_baseline_20260904
   where schemaname = 'public' and cmd = 'SELECT' and qual = 'true';

  select count(*) into n_open
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual = 'true';

  if n_open <> n_expected then
    raise exception 'OD-13 P0a rollback: % policies read USING (true), baseline had % -- restore is incomplete',
      n_open, n_expected;
  end if;

  raise notice 'OD-13 P0a rollback verified: % policies match the baseline.', n_open;
end $verify$;

-- So that re-applying the forward migration records a clean, non-duplicated touch list.
delete from public._od13_p0_touched where phase in ('p0a-sweep', 'p0a-narrow');

commit;
