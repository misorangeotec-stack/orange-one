-- ===========================================================================
-- OCPI FMS — name the approval events properly.
--
-- 20260929120800 built the activity type by concatenating
-- `'quotation_' || p_decision || 'd'`, which is right for exactly one of the
-- three decisions:
--
--     approve → quotation_approved   ✔
--     reject  → quotation_rejectd    ✘
--     rework  → quotation_reworkd    ✘
--
-- The type is what the bell, the audit trail and (from phase 9) the email
-- payload switch on, so a misspelt one is not cosmetic: `%_reworkd` matches no
-- handler anybody would think to write, and the row reads as a typo forever
-- because activity is append-only.
--
-- Names chosen rather than derived:
--     approve → quotation_approved
--     reject  → quotation_rejected
--     rework  → quotation_returned   ("sent back", which is what the button says)
--
-- ⚠ EXISTING ROWS ARE LEFT ALONE. fms_ocpi_activity is an append-only audit
--   trail; rewriting history to tidy a label would be a worse fault than the
--   label. Only two test rows carry the old spelling and they are deleted with
--   their deal.
--
-- ADDITIVE: one function body replaced.
--
-- Reversal: re-run 20260929120800.
-- ===========================================================================

begin;

create or replace function public.fms_ocpi_decide_quotation(
  p_deal uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_no     text;
  v_next   text;
  v_event  text;
  v_sole   boolean;
  v_owners uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approve', 'reject', 'rework') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select status, raised_by, quotation_no
    into v_status, v_owner, v_no
    from public.fms_ocpi_deals where id = p_deal for update;

  if v_status is null then raise exception 'Quotation not found'; end if;
  if v_status <> 'awaiting_quotation_approval' then
    raise exception 'This quotation is not waiting for approval';
  end if;
  if not public.fms_ocpi_can_act('quotation_approval', p_deal, v_uid) then
    raise exception 'You are not an approver for quotations';
  end if;

  v_owners := public.fms_ocpi_step_owner_ids('quotation_approval');
  v_sole := (array_length(v_owners, 1) = 1 and v_owners[1] = v_uid);
  if v_owner = v_uid and not v_sole then
    raise exception 'You raised this quotation, so somebody else has to approve it';
  end if;

  if p_decision in ('reject', 'rework') and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why, so the salesperson knows what to do next';
  end if;

  v_next := case p_decision
              when 'approve' then 'awaiting_order_confirmation'
              when 'reject'  then 'rejected'
              else 'draft'
            end;

  -- Named, not derived — see the header.
  v_event := case p_decision
               when 'approve' then 'quotation_approved'
               when 'reject'  then 'quotation_rejected'
               else 'quotation_returned'
             end;

  update public.fms_ocpi_deals
     set status        = v_next,
         current_step  = case p_decision when 'approve' then 'order_confirmation' else 'quotation' end,
         qa_decision   = p_decision,
         qa_note       = nullif(btrim(coalesce(p_note, '')), ''),
         qa_at         = now(),
         qa_by         = v_uid,
         rejected_at   = case when p_decision = 'reject' then now() else rejected_at end,
         reject_stage  = case when p_decision = 'reject' then 'quotation_approval' else reject_stage end,
         reject_reason = case when p_decision = 'reject' then nullif(btrim(coalesce(p_note,'')),'') else reject_reason end,
         rework_at     = case when p_decision = 'rework' then now() else rework_at end,
         rework_stage  = case when p_decision = 'rework' then 'quotation_approval' else rework_stage end,
         rework_reason = case when p_decision = 'rework' then nullif(btrim(coalesce(p_note,'')),'') else rework_reason end,
         rework_count  = rework_count + case when p_decision = 'rework' then 1 else 0 end
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, v_event,
    coalesce(v_no, 'The quotation') || ' was ' ||
      case p_decision when 'approve' then 'approved — fill in the order confirmation'
                      when 'reject'  then 'rejected'
                      else 'sent back for changes' end ||
      case when nullif(btrim(coalesce(p_note,'')),'') is null then '' else ': ' || btrim(p_note) end,
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('decision', p_decision, 'quotation_no', v_no));
end $$;

comment on function public.fms_ocpi_decide_quotation(uuid, text, text) is
  'Approve, reject or return a quotation. Reject and rework both require a reason. Self-approval is refused unless the approver is the only one configured. Emits quotation_approved / quotation_rejected / quotation_returned.';
grant execute on function public.fms_ocpi_decide_quotation(uuid, text, text) to authenticated;

commit;
