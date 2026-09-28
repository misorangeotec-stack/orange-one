-- New customers arrive with a collection team instead of nobody (RC-11 follow-up, 10-09-2026).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    in its SQL editor. The repo's `supabase/migrations/` targets the identity project.
--
-- WHY
--   `collection_refresh()` auto-enrols every new debtor ledger into the two musters. It has always
--   stamped `salesperson = 'OTHERS'` on the tag row, but left `collection_team` NULL on the group
--   row — there was no team vocabulary until RC-15. So every customer Tally created arrived with
--   nobody chasing them, and once a user is scoped by collection team, a customer with no team is
--   invisible to every one of them. The client's call (10-09-2026): default new customers to
--   **Jayshree**, who runs collection and already sees everything.
--
-- ⚠️ THIS FILE PATCHES THE LIVE FUNCTION — IT DOES NOT REDEFINE IT, AND THAT IS DELIBERATE.
--   `collection_refresh` is defined in ConnectWave-App's collection_report.sql, redefined in
--   collection_group_guid_migration.sql, then patched by three more files — and that repo's own
--   APPLY-ORDER.md warns that the DEPLOYED definition is AHEAD of every file in it: *"the live
--   database definition is the source of truth — not these files."* Pasting a full body from any
--   repo copy would silently revert whichever fixes are not in it. So this reads the live body,
--   replaces ONE insert, and writes it back — and raises rather than guessing if that insert is not
--   found exactly once.
--
-- ⚠️ EXISTING ROWS ARE NOT TOUCHED. The insert carries `on conflict (ledger_id) do nothing`, so it
--    only ever fills in a customer that has no muster row at all. Nobody's current team changes.
--
-- ⚠️ WHAT THIS COSTS: the "No collection team" count on Settings → Masters → Customer Groups will
--    now stay at zero for new arrivals, so it stops being the signal that a new customer needs an
--    owner. The signal that remains is `checked = false` — the **New** filter on that same tab —
--    which is what it was always for. Say so to whoever watches that screen.
--
-- Reversal: collection_refresh_default_collection_team_rollback.sql (same folder), which puts the
-- insert back to leaving collection_team NULL.

do $patch$
declare
  v_src  text;
  v_new  text;
  v_def  text;
  v_old_block constant text :=
'  insert into public.ext_ledger_group
    (ledger_id, tally_name, group_name, checked, match_status, source)
  select d.guid, max(d.ledger), max(d.ledger), false, ''unmatched'', ''sync_stub''';
  v_new_block constant text :=
'  insert into public.ext_ledger_group
    (ledger_id, tally_name, group_name, collection_team, checked, match_status, source)
  select d.guid, max(d.ledger), max(d.ledger), ''Jayshree'', false, ''unmatched'', ''sync_stub''';
begin
  -- The team must be a real, active entry or every new customer arrives holding a value the app
  -- refuses to accept on any later edit.
  if not exists (select 1 from public.ext_collection_team_master
                  where name = 'Jayshree' and is_active) then
    raise exception 'ext_collection_team_master has no active row named Jayshree — add it first';
  end if;

  select p.prosrc, pg_get_functiondef(p.oid)
    into v_src, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'collection_refresh';

  if v_src is null then
    raise exception 'public.collection_refresh() not found';
  end if;

  if (length(v_src) - length(replace(v_src, v_old_block, ''))) / length(v_old_block) <> 1 then
    raise exception 'the ext_ledger_group auto-enrol insert was not found exactly once — the live '
                    'function has changed shape; re-read it before patching';
  end if;

  -- Replace inside the FULL definition, so the signature, volatility, owner-visible options and
  -- search_path all survive untouched. Only the one insert differs.
  v_new := replace(v_def, v_old_block, v_new_block);
  if v_new = v_def then
    raise exception 'replacement made no change';
  end if;

  execute v_new;
  raise notice 'collection_refresh patched: new customers now default to collection team Jayshree';
end
$patch$;

-- ── Verify ───────────────────────────────────────────────────────────────────
--   select position('''Jayshree''' in prosrc) > 0 as patched
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'collection_refresh';   -- t
--
-- And that nothing existing moved:
--   select coalesce(nullif(btrim(collection_team),''),'(unassigned)') as team, count(*)
--     from public.ext_ledger_group group by 1 order by 2 desc;
