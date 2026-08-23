-- ===========================================================================
-- Master Report — count OCPI.
--
-- One row in master_report_modules and the module joins the adoption report: is
-- anybody opening it, is anybody raising anything in it, how much is open, how
-- old is the oldest.
--
-- ⚠ MEASURED ON DEALS, and `created_at` is the anchor even though a deal starts
--   life as a DRAFT. That is correct for an ADOPTION report, whose question is
--   "did a person do something in here today" — writing a draft is doing
--   something. It differs on purpose from the Control Center, whose question is
--   "what does the business owe", and which excludes drafts precisely because a
--   draft owes nobody.
--
-- ⚠ CLOSED STATUSES ARE THE THREE ENDINGS. `closed` (countersigned), plus
--   `cancelled` and `rejected` — both of which are over, and neither of which
--   should be reported as work in progress for the rest of time. `on_hold` is
--   NOT among them: a held deal is still open, and hiding it is how a parked
--   deal is never chased again.
--
-- ⚠ due_column IS DELIBERATELY NULL, so this module reports `tracks_due = false`
--   and contributes NOTHING to the overdue total. OCPI's due dates are derived
--   at read time from the admin's per-step SLA and the anchor step's timestamp
--   (lib/sla.ts) — there is no stored due date to aggregate here. A zero would
--   read as "nothing is late" when the truth is "not measurable from SQL".
--
-- Additive. Reversal:
--   delete from public.master_report_modules where app_id = 'ocpi';
-- ===========================================================================

begin;

insert into public.master_report_modules
  (app_id, label, head_table, created_column, status_column, closed_statuses,
   extra_filter, activity_table, actor_column, detail_path, sort_order)
values
  ('ocpi', 'OCPI', 'fms_ocpi_deals', 'created_at', 'status',
   array['closed', 'cancelled', 'rejected'], null,
   'fms_ocpi_activity', 'raised_by', '/ocpi/monitoring', 140)
on conflict (app_id) do nothing;

do $$
begin
  if not exists (select 1 from public.master_report_modules where app_id = 'ocpi') then
    raise exception 'OCPI did not register with the Master Report';
  end if;
end $$;

commit;
