-- ===========================================================================
-- PF-17 · THE CENTRAL MASTERS PING THE BROWSER INSTEAD OF WAITING OUT A TIMER
--
-- WHY
-- Add a customer in Tally, press Sync now on Admin -> Masters, and the sales
-- order form still does not offer it. F5 does not help either. Everything up to
-- the database works; the last hop, database to browser, has no signal in it at
-- all. The catalogue query carries staleTime 30 min AND sits on the IndexedDB
-- persistence allowlist for 24 hours, so a reload restores the saved copy and
-- calls it fresh. From the user's seat there is no way to force it, which is
-- why this reads as "the portal is not updating" rather than "the cache is
-- warm". Measured 2026-09-07. Raised by Ritesh Bhai the same day.
--
-- ⚠ THE 30 MINUTES IS NOT THE BUG AND IS NOT SHORTENED HERE. The catalogue is
--   ~2 MB - 7,960 ledgers, 14,446 items, 8,638 pairs - and it was split onto
--   its own query key precisely so that saves stop dragging it. Shortening the
--   timer re-creates the problem that split solved, on every module at once.
--   What was missing is not a shorter timer. It is a SIGNAL.
--
-- WHAT THIS IS
-- One row holding one timestamp. Statement-level triggers on the six central
-- master tables move it. The row is published to supabase_realtime, so every
-- open browser hears one small message and re-fetches the catalogue itself.
--
-- ⚠ FOR EACH STATEMENT, NEVER FOR EACH ROW. masters-sync rewrites EVERY row of
--   mst_items and mst_parties on every pull, in upsert chunks of 500 - not only
--   the ones that changed. Row-level triggers would be ~23,000 bumps per pull.
--   Statement-level is ~70. That difference is the whole design.
--
-- ⚠ DO NOT PUBLISH mst_parties OR mst_items THEMSELVES to supabase_realtime.
--   Same arithmetic from the other end: ~23,000 realtime messages pushed to
--   every open browser, five times a day. The subscription must stay on this
--   one row, which is why this table exists at all.
--
-- ⚠ WHY A TRIGGER AND NOT A SIGNAL KEYED ON mst_sync_runs. A trigger does not
--   care who the writer is, so it catches the Edge Function's service-role
--   writes AND portal writes alike. A sync-run signal would miss a customer
--   approved through a master request - the case where the person who approved
--   it sees it at once and everybody else waits out the 30 minutes.
--
-- ⚠ THE SELECT POLICY IS `using (true)`, NOT is_staff(). DELIBERATE, AND IT
--   MUST STAY THAT WAY. A customer login is is_external, so is_staff() is FALSE
--   for them. Customer Orders never reads mst_* directly - it reaches its lists
--   through the SECURITY DEFINER functions fms_dispatch_my_companies and
--   fms_dispatch_my_items, which is the only reason an external user has a list
--   at all. postgres_changes is RLS-evaluated per subscriber, and a failed
--   check produces NO EVENT AND NO ERROR. An is_staff() policy here would
--   therefore leave every customer login on the old 30-minute lag, silently,
--   and the feature would look finished. There is nothing in this row to scope
--   anyway: a timestamp and the name of a table. No customer, no item, no
--   amount.
--
-- SAFETY
-- Additive only, per the standing rule: one new table, one new function, six
-- new triggers. No existing table, column, policy or row is altered.
--
-- ⚠ `create trigger` takes SHARE ROW EXCLUSIVE on each master table. READS are
--   not blocked, so Order to Dispatch keeps working while this runs; concurrent
--   WRITES are. masters-sync starts at :00/:15/:30/:45 and takes ~50s, so apply
--   this in a gap. Every assertion below is a catalogue lookup costing
--   microseconds, and the pre-flight one sits ABOVE the DDL on purpose.
--
-- Reversal: run 20261120120000_pf17_catalogue_version_signal_rollback.sql
-- ===========================================================================

-- ======================================================== preflight ========
-- Above the DDL deliberately: everything after the first `create trigger` runs
-- while locks are held on the six master tables. Nothing slow belongs there.

do $pre$
declare v_n int;
begin
  select count(*) into v_n
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('mst_parties', 'mst_items', 'mst_party_items',
                        'mst_companies', 'mst_locations', 'mst_company_locations');
  if v_n <> 6 then
    raise exception 'PF-17: expected the six central master tables, found %', v_n;
  end if;

  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'PF-17: publication supabase_realtime is missing - no browser could hear anything';
  end if;
end $pre$;

-- ========================================================== the row ========

create table if not exists public.mst_catalogue_version (
  -- ⚠ THE CHECK ON THE PRIMARY KEY IS WHAT HOLDS THIS TO ONE ROW. `id` may only
  --   ever be true, and true is already taken, so a second insert conflicts.
  id     boolean primary key default true check (id),
  v      timestamptz not null default now(),
  reason text
);

comment on table public.mst_catalogue_version is
  'PF-17. ONE ROW. Every write to a central master bumps v through a statement-level trigger, and '
  'this table is published to supabase_realtime so open browsers re-fetch the catalogue instead of '
  'waiting out a 30-minute timer. Holds no business data - a timestamp and the name of a table. '
  'Its SELECT policy is using(true) on purpose; see the migration header before tightening it.';

comment on column public.mst_catalogue_version.v is
  'When a central master last changed. Nothing in SQL reads this value - the VALUE is not the '
  'point, the realtime message carrying the change is.';

comment on column public.mst_catalogue_version.reason is
  'Which master table moved, from tg_table_name. For reading the log by hand; the client ignores it.';

insert into public.mst_catalogue_version (id, v, reason)
values (true, now(), 'seed')
on conflict (id) do nothing;

-- ========================================================= the bump ========

-- ⚠ SECURITY DEFINER, AND THAT IS LOAD-BEARING, NOT DECORATION. A portal master
--   edit arrives as `authenticated`, and this trigger then writes a table that
--   role may not write. PROVED both ways on 2026-09-11, as role authenticated
--   carrying a real admin's uid, inside a rolled-back transaction:
--     · with definer rights  -> the master write succeeds and v moves;
--     · the same UPDATE run directly as authenticated -> SQLSTATE 42501,
--       "permission denied for table mst_catalogue_version".
--   42501 is a HARD ERROR, so a non-definer trigger would abort the master write
--   it is attached to. Note the grant is what makes it loud: RLS alone would have
--   matched no rows and bumped nothing SILENTLY, which is worse. Both guards are
--   deliberate. The function is owned by postgres, which owns the table and has
--   not forced RLS on it, so neither applies inside. masters-sync writes as
--   service_role and would never have met this.
create or replace function public.mst_bump_catalogue_version()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.mst_catalogue_version
     set v = now(),
         reason = tg_table_name
   where id;
  -- AFTER STATEMENT has no row to return.
  return null;
end
$function$;

comment on function public.mst_bump_catalogue_version() is
  'PF-17. Statement-level AFTER trigger on the six central masters: moves the one '
  'mst_catalogue_version row so realtime tells every open browser the catalogue changed. '
  'SECURITY DEFINER because a portal master write arrives as authenticated and the version table '
  'has no write policy - without it the trigger would fail and take the master write with it.';

-- ===================================================== the triggers ========
--
-- One trigger per table, naming all three events. That is allowed here because
-- we use no transition tables (`referencing new table as ...`); a trigger that
-- did would be restricted to ONE event and this would be eighteen triggers.
--
-- mst_locations and mst_company_locations are never touched by masters-sync -
-- they are portal-owned - so those two fire only on an admin's edit. Cheap, and
-- the right thing: a new location should reach the pickers just as fast.

drop trigger if exists trg_mst_parties_bump_catalogue on public.mst_parties;
create trigger trg_mst_parties_bump_catalogue
  after insert or update or delete on public.mst_parties
  for each statement execute function public.mst_bump_catalogue_version();

drop trigger if exists trg_mst_items_bump_catalogue on public.mst_items;
create trigger trg_mst_items_bump_catalogue
  after insert or update or delete on public.mst_items
  for each statement execute function public.mst_bump_catalogue_version();

drop trigger if exists trg_mst_party_items_bump_catalogue on public.mst_party_items;
create trigger trg_mst_party_items_bump_catalogue
  after insert or update or delete on public.mst_party_items
  for each statement execute function public.mst_bump_catalogue_version();

drop trigger if exists trg_mst_companies_bump_catalogue on public.mst_companies;
create trigger trg_mst_companies_bump_catalogue
  after insert or update or delete on public.mst_companies
  for each statement execute function public.mst_bump_catalogue_version();

drop trigger if exists trg_mst_locations_bump_catalogue on public.mst_locations;
create trigger trg_mst_locations_bump_catalogue
  after insert or update or delete on public.mst_locations
  for each statement execute function public.mst_bump_catalogue_version();

drop trigger if exists trg_mst_company_locations_bump_catalogue on public.mst_company_locations;
create trigger trg_mst_company_locations_bump_catalogue
  after insert or update or delete on public.mst_company_locations
  for each statement execute function public.mst_bump_catalogue_version();

-- ============================================================== RLS ========

alter table public.mst_catalogue_version enable row level security;

-- Supabase's default ACL grants every privilege on a new public table to anon
-- and authenticated. RLS already refuses the writes - there is no write policy -
-- but say it in the grants too, so the intent survives a future reader.
revoke all on public.mst_catalogue_version from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.mst_catalogue_version from authenticated;
grant select on public.mst_catalogue_version to authenticated;

-- ⚠ using(true), NOT is_staff(). See the header. Tightening this silently
--   removes every customer login from the signal, with no error anywhere.
drop policy if exists mst_catalogue_version_select on public.mst_catalogue_version;
create policy mst_catalogue_version_select
  on public.mst_catalogue_version for select to authenticated
  using (true);

-- ========================================================= realtime ========
--
-- ⚠ THIS ONE TABLE ONLY. See the header for what publishing mst_parties or
--   mst_items would cost. Default replica identity is right: realtime carries
--   the full NEW row on update and we never look at the old one.

do $pub$
begin
  if not exists (
    select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c       on c.oid = pr.prrelid
      join pg_namespace n   on n.oid = c.relnamespace
     where p.pubname = 'supabase_realtime'
       and n.nspname = 'public'
       and c.relname = 'mst_catalogue_version'
  ) then
    execute 'alter publication supabase_realtime add table public.mst_catalogue_version';
  end if;
end $pub$;

-- ========================================================== asserts ========
--
-- Catalogue lookups only - pg_trigger, pg_publication_rel, pg_policies. No
-- table is scanned, so this costs microseconds under the locks taken above.

do $check$
declare v_n int;
begin
  select count(*) into v_n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and t.tgname like 'trg_mst_%_bump_catalogue';
  if v_n <> 6 then
    raise exception 'PF-17: expected 6 bump triggers, found %', v_n;
  end if;

  -- tgtype bit 0 is FOR EACH ROW. If it is ever set, a full Tally pull becomes
  -- ~23,000 bumps instead of ~70 and this whole migration is self-defeating.
  if exists (
    select 1 from pg_trigger t
     where not t.tgisinternal
       and t.tgname like 'trg_mst_%_bump_catalogue'
       and (t.tgtype & 1) = 1
  ) then
    raise exception 'PF-17: a bump trigger is FOR EACH ROW - that is ~23,000 bumps per pull';
  end if;

  if not exists (
    select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c       on c.oid = pr.prrelid
     where p.pubname = 'supabase_realtime'
       and c.relname = 'mst_catalogue_version'
  ) then
    raise exception 'PF-17: the version table is not in supabase_realtime - no browser will hear anything';
  end if;

  select count(*) into v_n from public.mst_catalogue_version;
  if v_n <> 1 then
    raise exception 'PF-17: the version table must hold exactly one row, found %', v_n;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'mst_catalogue_version'
       and cmd = 'SELECT'
       and qual = 'true'
  ) then
    raise exception 'PF-17: the select policy is not using(true) - customer logins would hear nothing';
  end if;
end $check$;
