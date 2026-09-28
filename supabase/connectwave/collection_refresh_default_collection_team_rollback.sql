-- ROLLBACK for collection_refresh_default_collection_team.sql (RC-11 follow-up).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb), in its SQL editor.
--
-- Puts the auto-enrol insert back to leaving `collection_team` NULL, so a new customer arrives with
-- nobody assigned and shows up on the "No collection team" view again.
--
-- ⚠️ IT DOES NOT UN-ASSIGN ANYONE. Customers already stamped 'Jayshree' by the patched function keep
--    that team — this only changes what happens to the NEXT new customer. To find the ones the patch
--    assigned, look for a group row that is still an unchecked sync stub:
--      select ledger_id, tally_name from public.ext_ledger_group
--       where collection_team = 'Jayshree' and source = 'sync_stub' and checked = false;
--
-- Patches the LIVE function for the same reason the forward file does: the deployed definition is
-- ahead of every repo copy, so a full redefinition would revert fixes that live only in the database.

do $patch$
declare
  v_src text;
  v_def text;
  v_new text;
  v_new_block constant text :=
'  insert into public.ext_ledger_group
    (ledger_id, tally_name, group_name, collection_team, checked, match_status, source)
  select d.guid, max(d.ledger), max(d.ledger), ''Jayshree'', false, ''unmatched'', ''sync_stub''';
  v_old_block constant text :=
'  insert into public.ext_ledger_group
    (ledger_id, tally_name, group_name, checked, match_status, source)
  select d.guid, max(d.ledger), max(d.ledger), false, ''unmatched'', ''sync_stub''';
begin
  select p.prosrc, pg_get_functiondef(p.oid)
    into v_src, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'collection_refresh';

  if v_src is null then
    raise exception 'public.collection_refresh() not found';
  end if;

  if (length(v_src) - length(replace(v_src, v_new_block, ''))) / length(v_new_block) <> 1 then
    raise exception 'the patched insert was not found exactly once — nothing to roll back, or the '
                    'live function has changed shape since';
  end if;

  v_new := replace(v_def, v_new_block, v_old_block);
  execute v_new;
  raise notice 'collection_refresh reverted: new customers arrive with no collection team';
end
$patch$;

-- ── Verify ───────────────────────────────────────────────────────────────────
--   select prosrc like '%group_name, collection_team, checked%' as still_patched
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname='collection_refresh';    -- f
