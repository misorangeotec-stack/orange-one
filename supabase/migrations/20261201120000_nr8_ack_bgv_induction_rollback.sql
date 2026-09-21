-- ===========================================================================
-- ROLLBACK for 20261201120000_nr8_ack_bgv_induction.sql
--
-- NR-8 added only new objects — no existing function was replaced, so there is
-- nothing to restore, only things to remove.
--
-- It DOES discard NR-8's own data: acknowledgements, BGV results and induction
-- dates. Nothing that existed before NR-8 is touched, and any onboarding CHECK
-- created against the reference-check item is kept (the item is retired instead
-- of deleted in that case — somebody's completed work is not ours to delete).
-- ===========================================================================

drop function if exists public.fms_hr_set_induction(uuid, date);
drop function if exists public.fms_hr_set_bgv(uuid, text, text);
drop function if exists public.fms_hr_acknowledge_requisition(uuid);

do $do$
begin
  if exists (select 1 from public.fms_hr_onboarding_checks where item_key = 'reference_check') then
    update public.fms_hr_onboarding_items set active = false where key = 'reference_check';
  else
    delete from public.fms_hr_onboarding_items where key = 'reference_check';
  end if;
end
$do$;

alter table public.fms_hr_onboardings
  drop constraint if exists fms_hr_onboardings_bgv_status_check;

alter table public.fms_hr_onboardings
  drop column if exists bgv_status,
  drop column if exists bgv_note,
  drop column if exists bgv_at,
  drop column if exists bgv_by,
  drop column if exists induction_on,
  drop column if exists induction_by;

alter table public.fms_hr_requisitions
  drop column if exists acknowledged_at,
  drop column if exists acknowledged_by;
