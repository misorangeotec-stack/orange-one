-- ===========================================================================
-- PC-1 · Process Coordinator Dashboard — register the module and its identity.
--
-- Two things:
--   1. email_module_settings row, seeded OFF (house rule for a new module).
--   2. pc_is_coordinator(uuid) — the identity the whole dashboard hangs off.
--
-- ⚠ THE GRANT *IS* THE PERMISSION. There is no new role, no coordinator config
--   table and no new admin screen: holding the app_access row for
--   'process-coordinator' makes you the coordinator. This is the Master Report
--   precedent verbatim — "the grant for master-report IS the permission" — and
--   it is the shape six existing functions already hand-write rather than
--   calling module_level() (see 20260906120000_add_app_access_level.sql:27-35).
--
-- ⚠ THIS DELIBERATELY DOES **NOT** TOUCH fms_<mod>_is_coordinator().
--   Widening those twelve functions was the obvious-looking route and it is a
--   trap. `isProcessCoordinator` is `return true` as the FIRST arm of ~15
--   predicates across twelve stores — canActOn, canRaise, canCancelOrder,
--   canTickCheck, and HR Exit's canReadConfidential, which guards the exit
--   interview PII tier. ORing a global list into them would hand the
--   coordinator authority over every step of every case in every module.
--   The codebase already met this problem and answered it by adding a NARROW
--   flag (canMonitor) instead of widening, and says so in five separate files.
--   We widen exactly one thing, in a later migration: the authorisation line of
--   the ten *_resolve_master_request RPCs.
--
-- ⚠ HOW THE COORDINATOR ACTUALLY REACHES OTHER MODULES' DATA — and the sharp
--   edge in it. FMS read policies are not uniform: fms_purchase_requests and
--   fms_asset_jobs are `using (true)`, but fms_dispatch_orders, fms_ocpi_deals
--   and fms_exit_cases each require one of
--     is_admin | that module's own coordinator | raised_by | step owner
--     | module_is_viewer(uid, '<app-id>')
--   so reach comes from granting the coordinator **view** on every module.
--   module_is_viewer() is `module_level() = 'view'` EXACTLY, therefore an
--   'edit' grant makes it FALSE and gives the coordinator LESS read than a
--   'view' grant — they would silently see zeros for dispatch, OCPI and HR
--   Exit. The grant must be 'view'. Verified 2026-08-23: fms_exit_can_read_case
--   (the strictest policy in the app) does admit module_is_viewer.
--   Verified too: no email/recipient/announce/notify function anywhere reads
--   module_is_viewer, so view grants add no mail traffic.
--
-- ⚠ NO app_access ROWS ARE SEEDED, DELIBERATELY — same reason as every other
--   module registration: a grant is a decision about a named person and belongs
--   in Admin → Module Access, not in a migration that hands access to whoever
--   matched a query when it ran. Admins bypass module checks anyway, so the
--   dashboard is reachable the moment this deploys.
--
-- ⚠ 'process-coordinator' IS THE MANIFEST ID, and the same string is the key in
--   three places: app_access.app_id, email_module_settings.module_id, and the
--   second argument to module_can_edit()/module_is_viewer(). They must not drift.
--
-- Purely ADDITIVE: one seeded row, one new function. Nothing is altered.
--
-- Reversal:
--   drop function if exists public.pc_is_coordinator(uuid);
--   delete from public.email_module_settings where module_id = 'process-coordinator';
-- ===========================================================================

begin;

insert into public.email_module_settings (module_id, enabled)
values ('process-coordinator', false)
on conflict (module_id) do nothing;

create or replace function public.pc_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or exists (
        select 1 from public.app_access a
        where a.user_id = p_uid
          and a.app_id = 'process-coordinator'
      );
$$;

comment on function public.pc_is_coordinator(uuid) is
  'True for admins and for anyone holding the app_access row for the process-coordinator module. '
  'The gate on every pc_* RPC. Deliberately NOT related to fms_<mod>_is_coordinator, which '
  'short-circuits ~15 act-authority predicates and must not be widened.';

commit;

-- ---------------------------------------------------------------------------
-- Verification (run after applying):
--   select public.pc_is_coordinator(id) from public.profiles p
--     join public.user_roles r on r.user_id = p.id and r.role = 'admin' limit 1;  -- expect true
--   select public.pc_is_coordinator('00000000-0000-0000-0000-000000000000');      -- expect false
-- ---------------------------------------------------------------------------
