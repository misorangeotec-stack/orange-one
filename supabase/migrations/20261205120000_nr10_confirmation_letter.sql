-- ===========================================================================
-- NR-10 · The confirmation letter  (KPI 1C.7 — "decision AND letter issuance")
--
-- Confirming somebody produces a letter, stored against them, stamped with who
-- issued it and when. Only CONFIRMATION gets one: the client decided extension
-- and non-confirmation are communicated outside the hub.
--
-- The letter is generated in the browser (jsPDF, the same brand furniture every
-- other document here uses) and uploaded to `fms-hr-docs`; this records where it
-- landed. Generation deliberately does NOT gate the decision — see the RPC.
--
-- ADDITIVE ONLY: four nullable columns and one function.
-- ===========================================================================

alter table public.fms_hr_probations
  add column if not exists letter_path text,
  add column if not exists letter_name text,
  add column if not exists letter_at   timestamptz,
  add column if not exists letter_by   uuid;

comment on column public.fms_hr_probations.letter_path is
  'NR-10 / KPI 1C.7. The confirmation letter in fms-hr-docs. Null on a probation that was extended or not confirmed (neither gets one), and null on a confirmed one whose letter has not been produced yet - which is a state that can happen, because issuing the letter must never be able to fail the confirmation itself.';

create or replace function public.fms_hr_set_probation_letter(
  p_probation uuid, p_path text, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req uuid;
  v_fin text;
begin
  select requisition_id, final_status into v_req, v_fin
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to issue the letter for this probation';
  end if;

  -- A letter for a decision that was not a confirmation would be a letter saying
  -- something nobody decided.
  -- 'approved' IS the confirmation: final_status is CHECK-constrained to
  -- 'approved' | 'rejected'. The UI button says "Confirm" and the KPI sheet says
  -- "confirmation", but the column does not — read the constraint, not the label.
  if v_fin is distinct from 'approved' then
    raise exception 'Only a confirmed probation has a confirmation letter (this one is %)',
      coalesce(v_fin, 'still open');
  end if;

  update public.fms_hr_probations
     set letter_path = nullif(trim(p_path), ''),
         letter_name = nullif(trim(p_name), ''),
         letter_at   = case when coalesce(trim(p_path), '') = '' then null else now() end,
         letter_by   = case when coalesce(trim(p_path), '') = '' then null else v_uid end
   where id = p_probation;
end
$fn$;

grant execute on function public.fms_hr_set_probation_letter(uuid, text, text) to authenticated;
