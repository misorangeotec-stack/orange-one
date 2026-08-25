-- ===========================================================================
-- OCPI — STAGE G of the revision: the round-out. What the new chain says when
-- it emails somebody, and one hole the cutover left in the self-approval guard.
--
-- 1 · THE EMAIL BRANCHES
--   fms_ocpi_email_payload names, per event, the ACTION the reader has to take.
--   The cutover changed three of those actions and introduced two events that
--   had no branch at all:
--
--     · quotation_approved  said "fill in the order confirmation" and linked to
--       /deals/<id>/order-confirmation — a screen that no longer exists. The
--       approval now ISSUES the contract, so the action is to print it and get
--       it signed.
--     · management_signed   is NEW (the countersignature used to announce
--       deal_closed). With no branch it fell through to the generic arm and said
--       "was updated", which tells a reader to go and find out what changed.
--     · finance_handover    is NEW. Same problem, and this one is addressed to
--       Finance, who are the least likely to go digging.
--     · deal_closed         still said "has been countersigned". It is now fired
--       by Finance confirming receipt, two steps later.
--     · the four `oc_*` events are RETIRED but kept — historical rows carry them
--       — and their CTAs pointed at two deleted routes. Re-pointed at the deal
--       page, which exists for every deal there has ever been.
--
--   ⚠ AN EVENT WITH NO BRANCH MAILS SOMETHING USELESS, NOT NOTHING. OCPI's email
--     switch is off today, so this is cheap now and an invisible failure the day
--     it is switched on.
--
-- 2 · THE SELF-APPROVAL GUARD HAD A HOLE
--   `v_sole := (array_length(v_owners, 1) = 1 and ...)`. With NO owners named,
--   array_length returns NULL, so v_sole is NULL, so `if v_owner = v_uid and not
--   v_sole` is NULL — and plpgsql treats a NULL condition as false. The guard
--   silently did not fire. There are ZERO step-owner rows today, so a
--   coordinator who raised a deal could approve their own quotation through the
--   API; the UI blocked it, which is exactly the sort of gap where the button is
--   the only thing standing in the way.
--
--   coalesce(..., 0) makes "nobody is named" mean the guard DOES fire, matching
--   what every screen already showed.
--
-- Additive only: two function bodies. No schema change, no data rewritten.
--
-- Reversal (reverse order):
--   -- re-run 20261019120500's fms_ocpi_decide_quotation verbatim
--   -- re-run 20260929122000's fms_ocpi_email_payload verbatim
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · What each event tells its reader to do.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_email_payload(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text, p_meta jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  b text := '/ocpi';
  r record;
  v_ref       text;
  v_eyebrow   text;
  v_headline  text;
  v_action    text;
  v_subject   text;
  v_cta_label text;
  v_cta_path  text;
  v_rows      jsonb;
  v_value     text;
begin
  select d.*, m.name as machine_name
    into r
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
   where d.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_ref := coalesce(r.oc_no, r.quotation_no, r.customer_name, 'Deal');

  v_value := case
               when r.deal_value_amount is null then '-'
               when r.deal_value_currency = 'USD'
                 then '$ ' || trim(to_char(r.deal_value_amount, 'FM99,99,99,990.00'))
               else 'Rs. ' || trim(to_char(r.deal_value_amount, 'FM99,99,99,990.00'))
             end;

  v_rows := jsonb_build_array(
    jsonb_build_object('label', 'Customer',   'value', coalesce(r.customer_name, '-')),
    jsonb_build_object('label', 'Machine',    'value', coalesce(r.machine_name, '-')),
    jsonb_build_object('label', 'Deal value', 'value', v_value)
  );
  -- ⚠ A DOLLAR DEAL SHOWS ITS RUPEE EQUIVALENT AND THE RATE. The figure above is
  --   what the customer was quoted; the reader deciding anything about it needs
  --   to know what that is in rupees, and at what rate, or they will convert it
  --   themselves at today's.
  if r.deal_value_currency = 'USD' and r.deal_value_inr is not null then
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'label', 'In rupees',
      'value', 'Rs. ' || trim(to_char(r.deal_value_inr, 'FM99,99,99,990.00'))
               || case when r.fx_rate is null then ''
                       else ' (at ' || trim(to_char(r.fx_rate, 'FM990.0000')) || ' per USD)' end));
  end if;
  if coalesce(r.quotation_no, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Quotation', 'value', r.quotation_no));
  end if;
  if coalesce(r.oc_no, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Order confirmation', 'value', r.oc_no));
  end if;
  if coalesce(r.salesperson_name, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Salesperson', 'value', r.salesperson_name));
  end if;

  -- ⚠ ONE BRANCH PER EVENT, and each names the ACTION the reader has to take.
  --   "QT-M0024 was updated" tells somebody to go and find out what changed;
  --   "QT-M0024 is waiting for your approval" does not.
  if p_type = 'quotation_submitted' then
    v_eyebrow := 'Quotation';
    v_headline := v_ref || ' is waiting for your approval';
    v_action := 'sent a quotation for approval';
    v_subject := 'Approval needed - quotation ' || v_ref;
    v_cta_label := 'Review the quotation';
    v_cta_path := b || '/queues/approve-quotation';

  elsif p_type = 'quotation_approved' then
    -- The approval IS the issue of the contract now — number minted, both papers
    -- re-headed. The next act is printing it, not filling anything in.
    v_eyebrow := 'Order confirmation issued';
    v_headline := coalesce(nullif(r.oc_no, ''), v_ref)
                  || ' has been approved and issued - print it and get the customer to sign';
    v_action := 'approved a quotation and issued the order confirmation';
    v_subject := 'Approved - print and get signed: ' || coalesce(nullif(r.oc_no, ''), v_ref);
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type in ('quotation_rejected', 'quotation_returned') then
    v_eyebrow := case when p_type = 'quotation_rejected' then 'Quotation rejected' else 'Sent back' end;
    v_headline := v_ref || case when p_type = 'quotation_rejected'
                                then ' was rejected' else ' was sent back for changes' end;
    v_action := case when p_type = 'quotation_rejected' then 'rejected a quotation'
                     else 'sent a quotation back' end;
    v_subject := case when p_type = 'quotation_rejected'
                      then 'Rejected - quotation ' || v_ref
                      else 'Changes needed - quotation ' || v_ref end;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  -- ⚠ THE FOUR oc_* EVENTS ARE RETIRED AND KEPT. Nothing new fires them; rows
  --   raised before the cutover carry them, and a notification that cannot say
  --   what it was about is worse than one that links to a step that no longer
  --   runs. Their CTAs now point at the deal page — the two screens they used to
  --   open no longer exist.
  elsif p_type = 'oc_submitted' then
    v_eyebrow := 'Order confirmation';
    v_headline := v_ref || ' was sent for approval (a step that no longer runs)';
    v_action := 'sent an order confirmation for approval';
    v_subject := 'Order confirmation ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type = 'oc_approved' then
    v_eyebrow := 'Confirmed';
    v_headline := v_ref || ' was confirmed - print it and get the customer to sign';
    v_action := 'confirmed an order confirmation';
    v_subject := 'Confirmed - print and get signed: ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type in ('oc_rejected', 'oc_returned') then
    v_eyebrow := case when p_type = 'oc_rejected' then 'Rejected' else 'Sent back' end;
    v_headline := v_ref || case when p_type = 'oc_rejected'
                                then ' was rejected' else ' was sent back for changes' end;
    v_action := case when p_type = 'oc_rejected' then 'rejected an order confirmation'
                     else 'sent an order confirmation back' end;
    v_subject := case when p_type = 'oc_rejected'
                      then 'Rejected - order confirmation ' || v_ref
                      else 'Changes needed - order confirmation ' || v_ref end;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type = 'customer_signed' then
    v_eyebrow := 'Signed by the customer';
    v_headline := v_ref || ' has been signed and needs countersigning';
    v_action := 'filed a customer-signed order confirmation';
    v_subject := 'Countersignature needed - ' || v_ref;
    v_cta_label := 'Countersign it';
    v_cta_path := b || '/queues/management-signature';

  elsif p_type = 'signature_returned' then
    v_eyebrow := 'Sent back';
    v_headline := 'The signed copy of ' || v_ref || ' was sent back';
    v_action := 'sent a signed copy back';
    v_subject := 'Re-scan needed - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type = 'management_signed' then
    v_eyebrow := 'Countersigned';
    v_headline := v_ref || ' has been countersigned - it now has to reach Finance';
    v_action := 'countersigned an order confirmation';
    v_subject := 'Hand over to Finance - ' || v_ref;
    v_cta_label := 'Record the handover';
    v_cta_path := b || '/queues/finance-handover';

  elsif p_type = 'finance_handover' then
    v_eyebrow := 'Handed to Finance';
    v_headline := v_ref || ' has been handed over - please confirm you have it';
    v_action := 'handed a signed contract to Finance';
    v_subject := 'Confirm receipt - ' || v_ref;
    v_cta_label := 'Confirm receipt';
    v_cta_path := b || '/queues/finance-receipt';

  elsif p_type = 'deal_closed' then
    -- Fired by Finance confirming receipt now, two steps past the countersignature.
    v_eyebrow := 'Complete';
    v_headline := v_ref || ' has been received by Finance - the deal is complete';
    v_action := 'confirmed Finance has the signed contract';
    v_subject := 'Complete - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type in ('deal_held', 'deal_resumed', 'deal_cancelled') then
    v_eyebrow := case p_type when 'deal_held' then 'On hold'
                             when 'deal_resumed' then 'Resumed'
                             else 'Cancelled' end;
    v_headline := v_ref || case p_type when 'deal_held' then ' was put on hold'
                                       when 'deal_resumed' then ' is off hold'
                                       else ' was cancelled' end;
    v_action := case p_type when 'deal_held' then 'put a deal on hold'
                            when 'deal_resumed' then 'took a deal off hold'
                            else 'cancelled a deal' end;
    v_subject := v_eyebrow || ' - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  else
    -- Unknown type: still deliverable, still says which deal, never invents a
    -- next action it cannot vouch for.
    v_eyebrow := 'OCPI';
    v_headline := coalesce(nullif(btrim(coalesce(p_text, '')), ''), v_ref || ' was updated');
    v_action := 'updated a deal';
    v_subject := 'OCPI - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;
  end if;

  return jsonb_build_object(
    'subject',  v_subject,
    'eyebrow',  v_eyebrow,
    'headline', v_headline,
    'action',   v_action,
    'docLabel', v_ref,
    'rows',     v_rows,
    'ctaLabel', v_cta_label,
    'ctaPath',  v_cta_path
  )
  || case when coalesce(btrim(coalesce(p_text, '')), '') <> ''
          then jsonb_build_object('note', jsonb_build_object('label', 'Update', 'text', p_text))
          else '{}'::jsonb end;
end $function$;

-- ---------------------------------------------------------------------------
-- 2 · Nobody named must not mean the self-approval guard stops working.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_decide_quotation(p_deal uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_no     text;
  v_oc     text;
  v_fy     text;
  v_next   text;
  v_event  text;
  v_sole   boolean;
  v_owners uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approve', 'reject', 'rework') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select status, raised_by, quotation_no, oc_no
    into v_status, v_owner, v_no, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;

  if v_status is null then raise exception 'Quotation not found'; end if;
  if v_status <> 'awaiting_quotation_approval' then
    raise exception 'This quotation is not waiting for approval';
  end if;
  if not public.fms_ocpi_can_act('quotation_approval', p_deal, v_uid) then
    raise exception 'You are not an approver for quotations';
  end if;

  -- ⚠ coalesce(..., 0) IS THE WHOLE FIX. With no owners named, array_length
  --   returns NULL, v_sole was NULL, and `if v_owner = v_uid and not v_sole`
  --   evaluated to NULL — which plpgsql takes as false, so the guard silently
  --   did not fire. Nobody is named today, so the only thing stopping a
  --   coordinator approving their own quotation was a hidden button.
  v_owners := public.fms_ocpi_step_owner_ids('quotation_approval');
  v_sole := (coalesce(array_length(v_owners, 1), 0) = 1 and v_owners[1] = v_uid);
  if v_owner = v_uid and not v_sole then
    raise exception 'You raised this quotation, so somebody else has to approve it';
  end if;

  if p_decision in ('reject', 'rework') and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why, so the salesperson knows what to do next';
  end if;

  if p_decision = 'approve' and v_oc is null then
    v_fy := public.fms_ocpi_fy_code(current_date);
    v_oc := 'OTPL/OC/' || v_fy || '/' ||
            lpad(public.fms_ocpi_next_seq('oc:' || v_fy)::text, 4, '0');
  end if;

  v_next := case p_decision
              when 'approve' then 'awaiting_customer_sign'
              when 'reject'  then 'rejected'
              else 'draft'
            end;

  v_event := case p_decision
               when 'approve' then 'quotation_approved'
               when 'reject'  then 'quotation_rejected'
               else 'quotation_returned'
             end;

  update public.fms_ocpi_deals
     set status        = v_next,
         current_step  = case p_decision when 'approve' then 'customer_signoff' else 'quotation' end,
         oc_no         = coalesce(v_oc, oc_no),
         oc_at         = case when p_decision = 'approve' then coalesce(oc_at, now()) else oc_at end,
         oc_by         = case when p_decision = 'approve' then coalesce(oc_by, v_uid) else oc_by end,
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
      case p_decision
        when 'approve' then 'approved — order confirmation ' || coalesce(v_oc, '') ||
                            ' issued. Print it and get the customer to sign it.'
        when 'reject'  then 'rejected'
        else 'sent back for changes' end ||
      case when nullif(btrim(coalesce(p_note,'')),'') is null then '' else ': ' || btrim(p_note) end,
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('decision', p_decision, 'quotation_no', v_no, 'oc_no', v_oc));
end $function$;

commit;
