-- ===========================================================================
-- Travel Desk FMS — PLATFORM REGISTRATION (Phase 1).
--
-- Two rows. That is the whole of it.
--
--   1. email_module_settings — the notification kill switch, installed OFF.
--   2. master_report_modules — the director's adoption report, installed
--      DISABLED (see below).
--
-- ⚠ NO app_access ROWS ARE SEEDED, DELIBERATELY. Admins bypass module checks
--   entirely (module_level() returns 'edit' for them without consulting
--   app_access), so the module is reachable the moment it deploys. Every other
--   grant is a decision about a named person — who in HR, who in Finance, which
--   Directors — and belongs in Admin → Module Access, not in a migration that
--   would hand access to whoever happened to match a query when it ran.
--
-- ⚠ 'travel-desk' IS THE MANIFEST ID, and the same string is the key in four
--   places: app_access.app_id, email_module_settings.module_id,
--   master_report_modules.app_id, and the second argument to
--   module_can_edit() / module_is_viewer(). They must not drift. It is also the
--   prefix of every email_outbox kind this module enqueues ('travel_...').
--
-- ⚠ THE MASTER REPORT ROW INSTALLS `enabled = false`, ON PURPOSE.
--   master_report_snapshot() builds dynamic SQL over head_table for every row
--   `where enabled` (20260830120000, line 246). fms_travel_trips does not exist
--   until phase 3, so an enabled row here would break the DIRECTOR'S DAILY
--   REPORT for all eleven other modules the moment this migration landed.
--   Phase 3 flips it on in the same migration that creates the table.
--
--   Registering it here rather than in phase 3 keeps one migration answering
--   "does this module exist yet", which is the question someone reads this file
--   to settle.
--
-- ⚠ closed_statuses IS A DENY-LIST. Anything not named counts as OPEN, so a
--   status added later is never silently dropped from the report. The three
--   endings are `closed` (settled and paid), `cancelled` (the trip was not
--   taken) and `rejected` (approval refused). `on_hold` is NOT among them: a
--   held trip is still open, and hiding it is how a parked trip is never chased.
--
-- ⚠ due_column IS DELIBERATELY NULL, so this module reports `tracks_due = false`
--   and contributes NOTHING to the overdue total. Travel Desk due dates are
--   derived at read time from the admin's per-step SLA and the anchor step's
--   timestamp (lib/sla.ts + the ANCHOR_AT map in lib/queues.ts) — several of
--   them, like the claim deadline, are measured from the trip's RETURN DATE
--   rather than from any stored due column. A zero here would read as "nothing
--   is late" when the truth is "not measurable from SQL".
--
-- Additive. Reversal:
--   delete from public.master_report_modules  where app_id    = 'travel-desk';
--   delete from public.email_module_settings  where module_id = 'travel-desk';
-- ===========================================================================

begin;

-- 1. Email. Installed OFF: a module that starts mailing the day it deploys
--    tells people about a process they have not been trained on yet.
insert into public.email_module_settings (module_id, enabled)
values ('travel-desk', false)
on conflict (module_id) do nothing;

-- 2. Adoption report. Measured on trips, anchored on created_at — correct for
--    an adoption report, whose question is "did a person do something in here
--    today", and writing a draft is doing something. That differs on purpose
--    from the Control Center, whose question is "what does the business owe",
--    and which excludes drafts precisely because a draft owes nobody.
insert into public.master_report_modules
  (app_id, label, head_table, created_column, status_column, closed_statuses,
   extra_filter, activity_table, actor_column, detail_path, enabled, sort_order)
values
  ('travel-desk', 'Travel Desk', 'fms_travel_trips', 'created_at', 'status',
   array['closed', 'cancelled', 'rejected'], null,
   'fms_travel_activity', 'raised_by', '/travel-desk/monitoring', false, 150)
on conflict (app_id) do nothing;

do $mig$
begin
  if not exists (select 1 from public.email_module_settings where module_id = 'travel-desk') then
    raise exception 'Travel Desk did not register with the email gate';
  end if;

  if exists (select 1 from public.email_module_settings where module_id = 'travel-desk' and enabled) then
    raise exception 'Travel Desk email installed ON; it must install OFF';
  end if;

  if not exists (select 1 from public.master_report_modules where app_id = 'travel-desk') then
    raise exception 'Travel Desk did not register with the Master Report';
  end if;

  -- The guard that matters: an enabled row pointing at a table that does not
  -- exist would break the snapshot for every other module.
  if exists (
    select 1 from public.master_report_modules m
     where m.app_id = 'travel-desk'
       and m.enabled
       and to_regclass('public.' || m.head_table) is null
  ) then
    raise exception 'Travel Desk is enabled in the Master Report but fms_travel_trips does not exist yet';
  end if;
end $mig$;

commit;
