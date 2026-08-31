-- ===========================================================================
-- PC-1 · Let the process coordinator approve a master request in ANY module.
--
-- Ten modules own a *_resolve_master_request RPC. Each authorises with
--   is_admin(uid) OR fms_<mod>_is_master_manager(type, uid)
-- so a coordinator who is not an admin and not that module's named master
-- manager cannot approve anything. This adds one more arm — and nothing else.
--
-- ⚠⚠ WHY THIS IS A PROGRAMMATIC REWRITE AND NOT TEN RETYPED FUNCTIONS.
--   The live body of fms_dispatch_resolve_master_request is NOT the body in
--   its own migration (20260801120000): the Phase 1 central-masters cutover
--   replaced it with a version that writes into mst_* instead of fms_dispatch_*
--   (see supabase/phase2/01_cutover.sql). Retyping these from migration files
--   would SILENTLY REVERT THAT CUTOVER — dispatch masters would start landing
--   back in the per-FMS tables and central masters would quietly stop being fed.
--   The same hazard exists for any function patched out-of-band since.
--
--   So: read each definition from pg_get_functiondef(), replace exactly one
--   substring, and re-execute. The body is preserved byte-for-byte by
--   construction. The block refuses to run if a pattern is missing or appears
--   more than once, so a future edit that moves the authorisation line fails
--   loudly here instead of being half-applied.
--
--   Verified 2026-08-23: all ten patterns below occur exactly once.
--
-- ⚠ EVERYTHING ELSE IS UNTOUCHED — the row lock, the "already resolved" guard,
--   the payload override, the master INSERT, the notification, the email. This
--   changes WHO may approve, never WHAT approving does.
--
-- ⚠ SHAPES THAT DIFFER, both handled explicitly below:
--     · ocpi   — uses a v_uid local instead of auth.uid()
--     · travel — has no is_admin arm at all (it lives inside
--                fms_travel_is_master_manager, which is correct), so its line
--                is a bare `if not f(...) then` needing new parentheses.
--
-- Purely ADDITIVE in behaviour: every caller authorised before is still
-- authorised. No table, column or row is touched.
--
-- Reversal: re-run this block with new_s and old_s swapped, or restore the ten
-- functions from a pre-migration pg_get_functiondef() dump.
-- ===========================================================================

do $mig$
declare
  r        record;
  v_def    text;
  v_new    text;
  v_hits   int;
  v_count  int := 0;
begin
  for r in
    select * from (values
      -- fn, substring to find, replacement
      ('fms_asset_resolve_master_request',
       'public.fms_asset_is_master_manager(v_type, auth.uid()))',
       'public.fms_asset_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_dispatch_resolve_master_request',
       'public.fms_dispatch_is_master_manager(v_type, auth.uid()))',
       'public.fms_dispatch_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_exit_resolve_master_request',
       'public.fms_exit_is_master_manager(v_type, auth.uid()))',
       'public.fms_exit_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_hr_resolve_master_request',
       'public.fms_hr_is_master_manager(v_type, auth.uid()))',
       'public.fms_hr_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_import_resolve_master_request',
       'public.fms_import_is_master_manager(v_type, auth.uid()))',
       'public.fms_import_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_ocpi_resolve_master_request',
       'public.fms_ocpi_is_master_manager(v_type, v_uid))',
       'public.fms_ocpi_is_master_manager(v_type, v_uid) or public.pc_is_coordinator(v_uid))'),
      ('fms_production_resolve_master_request',
       'public.fms_production_is_master_manager(v_type, auth.uid()))',
       'public.fms_production_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_purchase_resolve_master_request',
       'public.fms_purchase_is_master_manager(v_type, auth.uid()))',
       'public.fms_purchase_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_supplies_resolve_master_request',
       'public.fms_supplies_is_master_manager(v_type, auth.uid()))',
       'public.fms_supplies_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid()))'),
      ('fms_travel_resolve_master_request',
       'if not public.fms_travel_is_master_manager(v_type, v_uid) then',
       'if not (public.fms_travel_is_master_manager(v_type, v_uid) or public.pc_is_coordinator(v_uid)) then')
    ) as t(fn, old_s, new_s)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;

    if v_def is null then
      raise exception 'PC-1: function public.% not found', r.fn;
    end if;

    -- Idempotent: skip anything already widened.
    if position('pc_is_coordinator' in v_def) > 0 then
      raise notice 'PC-1: % already widened, skipping', r.fn;
      continue;
    end if;

    v_hits := (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s);
    if v_hits <> 1 then
      raise exception 'PC-1: expected exactly 1 authorisation match in %, found %', r.fn, v_hits;
    end if;

    v_new := replace(v_def, r.old_s, r.new_s);
    execute v_new;
    v_count := v_count + 1;
  end loop;

  raise notice 'PC-1: widened % resolve RPC(s)', v_count;
end $mig$;

-- Assert every one of the ten now admits the coordinator.
do $check$
declare
  v_missing text;
begin
  select string_agg(p.proname, ', ')
    into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'fms_%_resolve_master_request'
     and position('pc_is_coordinator' in pg_get_functiondef(p.oid)) = 0;

  if v_missing is not null then
    raise exception 'PC-1: these resolve RPCs were not widened: %', v_missing;
  end if;
end $check$;
