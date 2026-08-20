-- ===========================================================================
-- View-only becomes a REAL boundary, not just a hidden button.
--
-- WHY
--   20260906120000 gave app_access an access_level ('view' | 'edit') and the
--   frontend hides every write affordance from a view-only user. That is enough
--   to stop an accident; it is NOT a security boundary. The browser is only the
--   front desk — anyone who opens devtools can call an RPC directly, and the
--   database would have accepted it, because nothing down here had been told
--   what "view only" means.
--
--   This is the deadbolt behind the hidden door.
--
-- WHAT THIS DOES
--   A. public.module_can_edit(uid, app_id) — the readable yes/no over module_level().
--   B. Every FMS write predicate is wrapped so it ALSO requires 'edit':
--        <app>_can_act / _can_act_po      — may I action this step?
--        <app>_is_step_owner              — do I own this step?
--        <app>_is_master_manager          — may I CRUD this master?
--        <app>_can_raise                  — may I raise a new one?
--        fms_exit_can_tick_clearance, fms_dispatch_can_add_doc
--      35 functions across ten modules. They are what the ~250 RPC guards and
--      the master-table write policies funnel through, so gating them here
--      covers the write surface without editing 250 call sites.
--
-- ⚠ THE ORIGINAL BODIES ARE NOT RETYPED. Each function's current definition is
--   copied verbatim to <name>__ungated and the original is replaced by a two-line
--   gate that calls it. Thirty-five hand-transcribed predicates is thirty-five
--   chances to silently change who may approve a purchase order; a mechanical
--   copy has none. It also means this migration reads the SAME whether the
--   underlying rule is three lines of SQL or forty of plpgsql.
--
-- ⚠ READS ARE NOT AFFECTED, and that is the whole point of gating HERE rather
--   than in the read path. Verified before writing this:
--     · all 67 master tables whose FOR ALL policy uses one of these helpers also
--       carry a permissive "FOR SELECT USING (true)" policy. Policies are OR-ed,
--       so SELECT still passes when the write policy now fails.
--     · no snapshot/list/report function calls these helpers — every caller that
--       is not itself a write predicate raises on failure, i.e. is a write guard.
--   A view-only user therefore keeps every queue, register and report exactly as
--   before, and loses only the ability to change something.
--
-- ⚠ ADMINS ARE UNAFFECTED. module_level() returns 'edit' for an admin without
--   consulting app_access at all, so every admin path is byte-for-byte as it was.
--
-- ⚠ A NULL p_uid (the trusted cron paths) resolves to 'none' and so returns
--   false — which is what these predicates already returned for a null user, so
--   no scheduled job changes behaviour.
--
-- ⚠ KNOWN, PRE-EXISTING, NOT CAUSED BY THIS: 19 step-owner assignments across
--   five modules name people who hold no grant on that module at all. They are
--   already unable to open those apps (UNIVERSAL_APP_IDS is empty, so every app
--   is opt-in), so this changes nothing for them in practice — it only makes the
--   database agree with the front door. Worth tidying in Admin, separately.
--
-- ADDITIVE: one new function, 35 verbatim copies, 35 replaced bodies. No table,
-- column, policy or row is touched.
--
-- Reversal:
--   for each f: create or replace f from f__ungated's body, then
--   drop function f__ungated. The pairing is name -> name || '__ungated'.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. The readable yes/no. module_level() already exists and is the one place
--    that knows the rule; this is sugar so the gates below read as English.
-- ---------------------------------------------------------------------------
create or replace function public.module_can_edit(_user_id uuid, _app_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.module_level(_user_id, _app_id) = 'edit';
$fn$;

comment on function public.module_can_edit(uuid, text) is
  'May this user CHANGE anything in this app? False on a view-only grant and on no grant at all. Admins are always true. See 20260923120000.';

revoke all on function public.module_can_edit(uuid, text) from public, anon;
grant execute on function public.module_can_edit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B. Wrap every FMS write predicate.
-- ---------------------------------------------------------------------------
do $mig$
declare
  r        record;
  v_app    text;
  v_call   text;
  v_copied int := 0;
begin
  for r in
    select p.oid, p.proname,
           pg_get_function_arguments(p.oid) as decl_args,
           p.proargnames
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname ~ '(_is_step_owner|_is_master_manager|_can_act|_can_raise|_can_tick_clearance|_can_add_doc)'
       and p.proname <> 'mst_is_master_manager'   -- Central Masters: admin-only already, not an app module
       and p.proname !~ '__ungated$'
       and p.prorettype = 'boolean'::regtype
     order by p.proname
  loop
    -- Module id per table prefix. Unmapped is a hard error: a new FMS added
    -- later must be named here deliberately, never gated by accident or missed.
    v_app := case
      when r.proname like 'fms_purchase_%'   then 'procurement'
      when r.proname like 'fms_import_%'     then 'import'
      when r.proname like 'fms_hr_%'         then 'hr-recruitment'
      when r.proname like 'fms_exit_%'       then 'hr-exit'
      when r.proname like 'fms_sampling_%'   then 'sampling'
      when r.proname like 'fms_production_%' then 'production-entry'
      when r.proname like 'fms_dispatch_%'   then 'order-to-dispatch'
      when r.proname like 'fms_supplies_%'   then 'office-supplies'
      when r.proname like 'fms_asset_%'      then 'asset-maintenance'
      when r.proname like 'fms_customer_%'   then 'customer-onboarding'
    end;
    if v_app is null then
      raise exception 'view-only gate: no module mapping for %()', r.proname;
    end if;

    -- Already wrapped by an earlier run: leave it alone. Without this guard a
    -- re-run would copy the GATE into __ungated and the gate would call itself.
    if exists (
      select 1 from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
       where n2.nspname = 'public' and p2.proname = r.proname || '__ungated'
    ) then
      continue;
    end if;

    -- 1. Verbatim copy under __ungated. Only the name in the CREATE header is
    --    rewritten (anchored to the start), so a body that mentions a similarly
    --    named function — fms_sampling_is_step_owner_for calls
    --    fms_sampling_is_step_owner — is left pointing where it pointed.
    execute regexp_replace(
      pg_get_functiondef(r.oid),
      '^CREATE OR REPLACE FUNCTION public\.' || r.proname || '\(',
      'CREATE OR REPLACE FUNCTION public.' || r.proname || '__ungated('
    );

    -- 2. Replace the original IN PLACE (same oid), so every RLS policy and RPC
    --    already compiled against it picks the gate up with no edits. Renaming
    --    instead would have left the policies pointing at the ungated body.
    v_call := array_to_string(r.proargnames, ', ');

    execute format(
      'create or replace function public.%I(%s) returns boolean '
      'language sql stable security definer set search_path = public as '
      '$body$ select public.module_can_edit(p_uid, %L) and public.%I(%s); $body$',
      r.proname, r.decl_args, v_app, r.proname || '__ungated', v_call
    );

    v_copied := v_copied + 1;
  end loop;

  raise notice 'view-only gate applied to % predicate(s)', v_copied;
end $mig$;
