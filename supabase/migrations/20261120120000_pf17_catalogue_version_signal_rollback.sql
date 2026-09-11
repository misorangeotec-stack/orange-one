-- ===========================================================================
-- ROLLBACK of 20261120120000_pf17_catalogue_version_signal.sql
--
-- Loses no data worth keeping. The table holds one timestamp and one table
-- name, both regenerated the moment a central master is next written. What it
-- DOES cost is the feature: every module goes back to learning about a new
-- customer or item up to 30 minutes late, with no way for the user to force it.
-- That is the PF-17 symptom, returning.
--
-- ⚠ REVERT THE FRONTEND FIRST, OR DEPLOY THE REVERT ALONGSIDE THIS. A browser
--   still running useCatalogueVersion() subscribes to a table that no longer
--   exists and FAILS SILENTLY - no event, no error, no clue. Order matters in
--   the same way it does on the way in.
--
-- Drop order is the reverse of creation: publication membership first (it
-- references the table), then the triggers (they reference the function), then
-- the function, then the table.
-- ===========================================================================

do $pub$
begin
  if exists (
    select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c       on c.oid = pr.prrelid
      join pg_namespace n   on n.oid = c.relnamespace
     where p.pubname = 'supabase_realtime'
       and n.nspname = 'public'
       and c.relname = 'mst_catalogue_version'
  ) then
    execute 'alter publication supabase_realtime drop table public.mst_catalogue_version';
  end if;
end $pub$;

drop trigger if exists trg_mst_parties_bump_catalogue           on public.mst_parties;
drop trigger if exists trg_mst_items_bump_catalogue             on public.mst_items;
drop trigger if exists trg_mst_party_items_bump_catalogue       on public.mst_party_items;
drop trigger if exists trg_mst_companies_bump_catalogue         on public.mst_companies;
drop trigger if exists trg_mst_locations_bump_catalogue         on public.mst_locations;
drop trigger if exists trg_mst_company_locations_bump_catalogue on public.mst_company_locations;

drop function if exists public.mst_bump_catalogue_version();

drop table if exists public.mst_catalogue_version;

do $check$
begin
  if exists (select 1 from pg_trigger t
              where not t.tgisinternal
                and t.tgname like 'trg_mst_%_bump_catalogue') then
    raise exception 'PF-17 rollback: a bump trigger survived the drop';
  end if;

  if exists (select 1 from information_schema.tables
              where table_schema = 'public'
                and table_name = 'mst_catalogue_version') then
    raise exception 'PF-17 rollback: the version table survived the drop';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'mst_bump_catalogue_version') then
    raise exception 'PF-17 rollback: the bump function survived the drop';
  end if;
end $check$;
