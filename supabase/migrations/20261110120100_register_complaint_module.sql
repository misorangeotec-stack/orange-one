-- ===========================================================================
-- Complaint (RM/FG) FMS — PLATFORM REGISTRATION (Phase 2).
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
--   grant is a decision about a named person — who in Quality, who raises, who
--   confirms — and belongs in Admin → Module Access, not in a migration that
--   would hand access to whoever happened to match a query when it ran.
--
-- ⚠ 'complaint' IS THE MANIFEST ID, and the same string is the key in SIX
--   places: app_access.app_id, email_module_settings.module_id,
--   master_report_modules.app_id, the second argument to module_can_edit() /
--   module_is_viewer(), the email_outbox kind prefix ('complaint_...'), and the
--   startsWith chain in supabase/functions/send-email/index.ts. They must not
--   drift. The schema prefix is deliberately the SAME word (fms_complaint_*) —
--   three older modules where it differs (fms_purchase_* -> 'procurement',
--   fms_hr_* -> 'hr-recruitment', fms_exit_* -> 'hr-exit') are a standing tax on
--   everyone who reads them.
--
-- ⚠ THE MASTER REPORT ROW INSTALLS `enabled = false`, ON PURPOSE.
--   master_report_snapshot() builds dynamic SQL over head_table for every row
--   `where enabled`. fms_complaint_requests does not exist until phase 5, so an
--   enabled row here would break the DIRECTOR'S DAILY REPORT for all twelve
--   other modules the moment this migration landed. Phase 5 flips it on in the
--   same migration that creates the table.
--
-- ⚠ closed_statuses IS A DENY-LIST. Anything not named counts as OPEN, so a
--   status added later is never silently dropped from the report. The three
--   endings are `closed` (resolved and accepted), `cancelled` (withdrawn) and
--   `rejected` (not a valid complaint, decided at acknowledge). `on_hold` is NOT
--   among them: a held complaint is still open, and hiding it is how a parked
--   complaint is never chased.
--
-- ⚠ due_column IS DELIBERATELY NULL, so this module reports `tracks_due = false`
--   and contributes NOTHING to the overdue total. Complaint due dates are
--   derived at read time from the admin's per-step SLA and the anchor step's
--   timestamp (lib/sla.ts + complaintDueIso in lib/queues.ts) — and the
--   resolution's deadline is measured from the date PROMISED TO THE PARTY at
--   acknowledge rather than from any stored due column. A zero here would read
--   as "nothing is late" when the truth is "not measurable from SQL".
--
-- Additive. Reversal:
--   delete from public.master_report_modules  where app_id    = 'complaint';
--   delete from public.email_module_settings  where module_id = 'complaint';
-- ===========================================================================

begin;

-- 1. Email. Installed OFF: a module that starts mailing the day it deploys
--    tells people about a process they have not been trained on yet.
insert into public.email_module_settings (module_id, enabled)
values ('complaint', false)
on conflict (module_id) do nothing;

-- 2. Adoption report. Measured on complaints, anchored on created_at — correct
--    for an adoption report, whose question is "did a person do something in
--    here today".
insert into public.master_report_modules
  (app_id, label, head_table, created_column, status_column, closed_statuses,
   extra_filter, activity_table, actor_column, detail_path, enabled, sort_order)
values
  ('complaint', 'Complaint (RM/FG)', 'fms_complaint_requests', 'created_at', 'status',
   array['closed', 'cancelled', 'rejected'], null,
   'fms_complaint_activity', 'raised_by', '/complaint/monitoring', false, 160)
on conflict (app_id) do nothing;

do $mig$
begin
  if not exists (select 1 from public.email_module_settings where module_id = 'complaint') then
    raise exception 'Complaint did not register with the email gate';
  end if;

  if exists (select 1 from public.email_module_settings where module_id = 'complaint' and enabled) then
    raise exception 'Complaint email installed ON; it must install OFF';
  end if;

  if not exists (select 1 from public.master_report_modules where app_id = 'complaint') then
    raise exception 'Complaint did not register with the Master Report';
  end if;

  -- The guard that matters: an enabled row pointing at a table that does not
  -- exist would break the snapshot for every other module.
  if exists (
    select 1 from public.master_report_modules m
     where m.app_id = 'complaint'
       and m.enabled
       and to_regclass('public.' || m.head_table) is null
  ) then
    raise exception 'Complaint is enabled in the Master Report but fms_complaint_requests does not exist yet';
  end if;
end $mig$;

commit;
