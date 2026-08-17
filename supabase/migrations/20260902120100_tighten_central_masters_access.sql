-- ===========================================================================
-- CENTRAL MASTERS — restrict every policy to `authenticated`.
--
-- WHY
--   20260902120000 created the mst_* policies without a TO clause, which makes
--   them apply to PUBLIC — and PUBLIC includes `anon`. Supabase grants `anon`
--   table privileges on the public schema, and the anon key ships in the
--   browser bundle, so an unauthenticated caller could read the central
--   masters. That matters more here than it would for a per-FMS master:
--   mst_parties is about to hold ~9,200 Tally ledgers carrying GSTINs, credit
--   limits and credit periods.
--
--   Every existing master table already gets this right — fms_dispatch_customers,
--   fms_dispatch_items and fms_purchase_vendors all declare `for select TO
--   AUTHENTICATED`. This migration brings the central tables back in line with
--   them; it is a correction of a divergence, not a new policy decision.
--
-- ALSO: mst_is_master_manager is SECURITY DEFINER and was left executable by
--   PUBLIC (so by `anon`, over /rest/v1/rpc). It is a permission oracle and has
--   no business being callable by a signed-out caller. Revoked below.
--
--   ⚠ The nine per-FMS fms_<mod>_is_master_manager functions have exactly the
--     same exposure and are NOT touched here — changing nine live functions is a
--     separate, deliberate decision, not a side effect of this work. Flagged for
--     the Phase 3 cleanup, which replaces all nine with this one anyway.
--
-- Purely corrective: no table, column or row is added, altered or removed. The
-- mst_* tables are still empty at this point.
--
-- Reversal: re-run 20260902120000's policy block (its policies are unqualified,
-- i.e. TO PUBLIC), and `grant execute on function
-- public.mst_is_master_manager(text, uuid) to public;`
-- ===========================================================================

do $rls$
declare
  r record;
begin
  for r in
    select * from (values
      ('mst_companies',       'company'),
      ('mst_item_groups',     'item_group'),
      ('mst_units',           'unit'),
      ('mst_parties',         'party'),
      ('mst_items',           'item'),
      ('mst_locations',       'location'),
      ('mst_party_items',     'party_item')
    ) as t(tbl, master_type)
  loop
    execute format('drop policy if exists %I on public.%I', r.tbl || '_select', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      r.tbl || '_select', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_write', r.tbl);
    execute format($f$
      create policy %I on public.%I for all to authenticated
        using (
          (select public.is_admin((select auth.uid())))
          or (select public.mst_is_master_manager(%L, (select auth.uid())))
        )
        with check (
          (select public.is_admin((select auth.uid())))
          or (select public.mst_is_master_manager(%L, (select auth.uid())))
        )
    $f$, r.tbl || '_write', r.tbl, r.master_type, r.master_type);
  end loop;
end $rls$;

-- The two governance tables get the same treatment.
drop policy if exists mst_master_managers_select on public.mst_master_managers;
create policy mst_master_managers_select
  on public.mst_master_managers for select to authenticated using (true);

drop policy if exists mst_master_managers_write on public.mst_master_managers;
create policy mst_master_managers_write
  on public.mst_master_managers for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists mst_sync_runs_select on public.mst_sync_runs;
create policy mst_sync_runs_select
  on public.mst_sync_runs for select to authenticated using (true);

drop policy if exists mst_sync_runs_write on public.mst_sync_runs;
create policy mst_sync_runs_write
  on public.mst_sync_runs for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- The permission oracle: authenticated only.
--
-- ⚠ REVOKING FROM public IS NOT ENOUGH. Supabase ships
--     alter default privileges in schema public grant execute on functions to anon
--   so every new function is created with an EXPLICIT anon grant
--   (proacl shows `anon=X/postgres`, not merely `=X/postgres`). A
--   `revoke ... from public` leaves that explicit grant untouched and the
--   function stays callable by a signed-out caller. anon must be named.
revoke all on function public.mst_is_master_manager(text, uuid) from public;
revoke all on function public.mst_is_master_manager(text, uuid) from anon;
grant execute on function public.mst_is_master_manager(text, uuid) to authenticated;


-- ============================================================== asserts ====

do $check$
declare
  v_bad text;
begin
  -- Not one mst_* policy may still apply to PUBLIC.
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename like 'mst\_%'
     and (roles is null or 'public' = any (roles));
  if v_bad is not null then
    raise exception 'central masters: policy still open to PUBLIC: %', v_bad;
  end if;

  -- Every mst_* table must still HAVE both policies - a drop without the
  -- matching create would lock the app out rather than merely tighten it.
  select string_agg(t.tbl, ', ') into v_bad
    from (values ('mst_companies'),('mst_item_groups'),('mst_units'),('mst_parties'),
                 ('mst_items'),('mst_locations'),('mst_party_items'),
                 ('mst_master_managers'),('mst_sync_runs')) as t(tbl)
   where (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.tbl) <> 2;
  if v_bad is not null then
    raise exception 'central masters: expected exactly 2 policies on %', v_bad;
  end if;

  if has_function_privilege('anon', 'public.mst_is_master_manager(text, uuid)', 'execute') then
    raise exception 'central masters: anon can still execute mst_is_master_manager';
  end if;
  if not has_function_privilege('authenticated', 'public.mst_is_master_manager(text, uuid)', 'execute') then
    raise exception 'central masters: authenticated LOST execute on mst_is_master_manager';
  end if;
end $check$;
