-- ===========================================================================
-- ROLLBACK for 20261115140000_fms_production_draft_slip.sql
--
-- ⚠ DRAFTS ARE DELETED. 'draft' is removed from the status CHECK, so any row
--   still holding it would make the constraint un-addable. There is nowhere else
--   for a half-filled slip to go — it was never a job card — so the guard below
--   reports how many exist and stops. Delete them deliberately, then re-run.
--
--   Their reserved PRD and Lot/Batch numbers are NOT returned to the sequences.
-- ===========================================================================

do $do$
declare v_drafts int;
begin
  select count(*) into v_drafts from public.fms_production_requests where status = 'draft';
  if v_drafts > 0 then
    raise exception
      'Cannot roll back: % draft slip(s) exist. They are not job cards and have nowhere to go. Review them, then: delete from public.fms_production_requests where status = ''draft'';',
      v_drafts;
  end if;
end
$do$;

drop function if exists public.fms_production_submit_draft(uuid, jsonb);
drop function if exists public.fms_production_save_draft(uuid, jsonb);
drop function if exists public.fms_production_delete_draft(uuid);

alter table public.fms_production_requests drop constraint if exists fms_production_requests_status_check;
alter table public.fms_production_requests add constraint fms_production_requests_status_check
  check (status in (
    'awaiting_material_handover','awaiting_rm_transfer','awaiting_transfer_slip',
    'awaiting_production','awaiting_quality','awaiting_additional_issue_slip',
    'awaiting_mc_testing','awaiting_pm_handover','awaiting_pm_transfer',
    'awaiting_packing','awaiting_ready_to_dispatch','awaiting_fg_transfer',
    'closed','on_hold','cancelled'));
