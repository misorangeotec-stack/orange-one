-- ===========================================================================
-- OCPI — STAGE F of the revision: the chain itself. The order-confirmation step
-- and its approval are retired, and the signed contract is tracked past the
-- countersignature to Finance.
--
-- THE NEW CHAIN
--   quotation → quotation_approval → customer_signoff → management_signoff
--             → finance_handover → finance_receipt → closed
--
-- THE OLD ONE, for comparison
--   quotation → quotation_approval → order_confirmation → oc_approval
--             → customer_signoff → management_signoff → closed
--
-- WHAT THE CLIENT ASKED FOR
--   "Flow will remain the same after the customer signs. The copy management
--   will sign the same copy, then the flow will end." — plus two steps after
--   that: the signed contract is HANDED OVER to Finance (who handed it over),
--   and Finance RECEIVES it (who accepted it). Only then is the deal complete.
--
-- ⚠ THE TWO RETIRED STEPS ARE RETAINED, NOT DELETED. Their statuses stay legal
--   in the CHECK, their RPCs stay callable, and the frontend keeps their step
--   definitions behind a `retired` flag. Five deals sit at
--   `awaiting_order_confirmation` and two at `awaiting_oc_approval` right now; a
--   cutover that made their status illegal would make those rows unreadable,
--   unresumable and uncancellable. Nothing NEW ever reaches them.
--
-- ⚠ THE APPROVAL NOW HANDS STRAIGHT TO THE CUSTOMER SIGNATURE. Stage E made the
--   Directors' approval the moment the order confirmation is issued — number
--   minted, both papers re-headed and frozen — so there is nothing left for a
--   separate order-confirmation step to do. It would ask a salesperson to fill
--   in a form whose answers are already on the contract the customer is holding.
--
-- ⚠ A NOTE ON THE FINANCE STEPS IS NOT A COLUMN. What the client asked to record
--   is WHO handed over and WHO accepted, and when — that is fh_at/fh_by and
--   fr_at/fr_by, added in stage A. An optional remark goes to the activity feed
--   with the event, where every other optional remark in this module goes.
--
-- ⚠ fms_ocpi_cancel NEEDS NO CHANGE, checked rather than assumed. It refuses
--   only at `closed`, so a deal parked in the Finance window is still
--   cancellable — and its existing `cs_doc_path is not null` rule already
--   restricts that to a coordinator, which is exactly the right rule for a
--   contract the customer has already signed.
--
-- Additive only: the status CHECK is widened (never narrowed), two functions are
-- re-issued, two are new. No column is dropped and no row is rewritten.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_record_finance_receipt(uuid, text);
--   drop function if exists public.fms_ocpi_record_finance_handover(uuid, text);
--   -- re-run 20261019120400's fms_ocpi_decide_quotation verbatim
--   -- re-run 20260929121400's fms_ocpi_record_management_sign verbatim
--   -- re-run 20260929121800's fms_ocpi_resume verbatim
--   -- and only then, once no row holds either new status:
--   alter table public.fms_ocpi_deals drop constraint fms_ocpi_deals_status_check;
--   alter table public.fms_ocpi_deals add constraint fms_ocpi_deals_status_check
--     check (status = any (array['draft','awaiting_quotation_approval',
--       'awaiting_order_confirmation','awaiting_oc_approval','awaiting_customer_sign',
--       'awaiting_management_sign','closed','rejected','rework','on_hold','cancelled']));
--
-- ⚠ THE CHECK CANNOT BE NARROWED WHILE A DEAL HOLDS A NEW STATUS. Move those
--   rows back to `awaiting_management_sign` first, or the ALTER fails — which is
--   the constraint doing its job, not a fault in the rollback.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Two new statuses become legal. The old ones stay legal.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_deals drop constraint if exists fms_ocpi_deals_status_check;
alter table public.fms_ocpi_deals add constraint fms_ocpi_deals_status_check
  check (status = any (array[
    'draft',
    'awaiting_quotation_approval',
    -- Retired by this migration, kept legal for the rows already holding them.
    'awaiting_order_confirmation',
    'awaiting_oc_approval',
    'awaiting_customer_sign',
    'awaiting_management_sign',
    'awaiting_finance_handover',
    'awaiting_finance_receipt',
    'closed',
    'rejected',
    'rework',
    'on_hold',
    'cancelled'
  ]));

-- ---------------------------------------------------------------------------
-- 2 · Approving hands straight to the customer signature.
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

  v_owners := public.fms_ocpi_step_owner_ids('quotation_approval');
  v_sole := (array_length(v_owners, 1) = 1 and v_owners[1] = v_uid);
  if v_owner = v_uid and not v_sole then
    raise exception 'You raised this quotation, so somebody else has to approve it';
  end if;

  if p_decision in ('reject', 'rework') and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why, so the salesperson knows what to do next';
  end if;

  -- ⚠ MINTED ONLY ON APPROVE, AND ONLY ONCE. A rejected or returned quotation
  --   burns no number, and a deal that already carries one keeps it.
  if p_decision = 'approve' and v_oc is null then
    v_fy := public.fms_ocpi_fy_code(current_date);
    v_oc := 'OTPL/OC/' || v_fy || '/' ||
            lpad(public.fms_ocpi_next_seq('oc:' || v_fy)::text, 4, '0');
  end if;

  -- ⚠ STRAIGHT TO THE CUSTOMER SIGNATURE (revision stage F). The approval IS the
  --   issue of the order confirmation now, so the old order-confirmation step
  --   has nothing left to ask.
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

-- ---------------------------------------------------------------------------
-- 3 · Countersigning no longer closes the deal — it hands it to Finance.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_record_management_sign(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_oc     text;
  v_path   text := nullif(btrim(coalesce(p->>'doc_path', '')), '');
  v_pages  jsonb;
  v_note   text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_to     uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, oc_no into v_status, v_owner, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'awaiting_management_sign' then
    raise exception 'This deal is not waiting to be countersigned';
  end if;

  -- ⚠ NO RAISER ARM HERE. One person must not hold both pens.
  if not public.fms_ocpi_can_act('management_signoff', p_deal, v_uid) then
    raise exception 'You are not authorized to countersign order confirmations';
  end if;

  if v_path is null then
    raise exception 'Attach the countersigned order confirmation before handing it to Finance';
  end if;
  if split_part(v_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  v_pages := public.fms_ocpi_doc_pages(p->'doc_pages', v_path);

  -- ⚠ THE COUNTERSIGNATURE NO LONGER CLOSES THE DEAL (revision stage F). The
  --   signed contract has to physically reach Finance, and the client asked for
  --   both halves of that to be on record: who handed it over, and who accepted
  --   it. Closing here is what made the paper go missing.
  update public.fms_ocpi_deals
     set status       = 'awaiting_finance_handover',
         current_step = 'finance_handover',
         ms_doc_path  = v_path,
         ms_doc_pages = v_pages,
         ms_at        = now(),
         ms_by        = v_uid
   where id = p_deal;

  -- Finance's own people, plus the salesperson who is usually the one carrying
  -- the paper across. Deduplicated, or somebody on both lists is told twice.
  v_to := coalesce(public.fms_ocpi_step_owner_ids('finance_handover'), '{}'::uuid[]);
  if v_owner is not null and not (v_owner = any (v_to)) then
    v_to := v_to || v_owner;
  end if;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'management_signed',
    coalesce(v_oc, 'The order confirmation') || ' has been countersigned'
      || case when v_note is null then '' else ': ' || v_note end
      || ' — it now has to be handed over to Finance.',
    v_to,
    jsonb_build_object('oc_no', v_oc, 'pages', 1 + coalesce(jsonb_array_length(v_pages), 0)));
end $function$;

-- ---------------------------------------------------------------------------
-- 4 · Handed over to Finance — who handed it, and when.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_record_finance_handover(p_deal uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_oc     text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_to     uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, oc_no into v_status, v_owner, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'awaiting_finance_handover' then
    raise exception 'This deal is not waiting to be handed over to Finance';
  end if;

  -- ⚠ THE RAISER MAY HAND IT OVER, and that is deliberate: the salesperson is
  --   usually the person physically carrying the contract to the Finance desk.
  --   Accepting it is a different matter — see fms_ocpi_record_finance_receipt,
  --   which has no such arm, because one person must not be able to record both
  --   halves of a handover.
  if not public.fms_ocpi_can_act('finance_handover', p_deal, v_uid)
     and not (v_owner = v_uid and public.module_can_edit(v_uid, 'ocpi')) then
    raise exception 'You are not authorized to hand this contract over to Finance';
  end if;

  update public.fms_ocpi_deals
     set status       = 'awaiting_finance_receipt',
         current_step = 'finance_receipt',
         fh_at        = now(),
         fh_by        = v_uid
   where id = p_deal;

  v_to := public.fms_ocpi_step_owner_ids('finance_receipt');
  perform public.fms_ocpi_announce(
    'deal', p_deal, 'finance_handover',
    coalesce(v_oc, 'The signed contract') || ' has been handed over to Finance'
      || case when v_note is null then '' else ': ' || v_note end
      || ' — Finance has to confirm they have it.',
    coalesce(v_to, '{}'::uuid[]),
    jsonb_build_object('oc_no', v_oc, 'note', v_note));
end $function$;

-- ---------------------------------------------------------------------------
-- 5 · Received by Finance — and only now is the deal complete.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_record_finance_receipt(p_deal uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_fh_by  uuid;
  v_oc     text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, oc_no, fh_by into v_status, v_owner, v_oc, v_fh_by
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'awaiting_finance_receipt' then
    raise exception 'This deal is not waiting for Finance to confirm receipt';
  end if;

  -- ⚠ NO RAISER ARM, on purpose. The whole value of this step is that somebody
  --   in Finance says "I have it" — a salesperson recording their own delivery
  --   records nothing at all.
  if not public.fms_ocpi_can_act('finance_receipt', p_deal, v_uid) then
    raise exception 'Only Finance can confirm they have received this contract';
  end if;

  -- ⚠ AND NOT THE SAME PERSON WHO HANDED IT OVER. A handover with one name on
  --   both halves is a note to self, not a transfer of custody.
  if v_fh_by = v_uid then
    raise exception 'You handed this contract over, so somebody in Finance has to confirm receiving it';
  end if;

  update public.fms_ocpi_deals
     set status       = 'closed',
         current_step = null,
         fr_at        = now(),
         fr_by        = v_uid
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'deal_closed',
    coalesce(v_oc, 'The signed contract') || ' has been received by Finance'
      || case when v_note is null then '' else ': ' || v_note end
      || ' — the deal is complete.',
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('oc_no', v_oc, 'note', v_note));
end $function$;

-- ---------------------------------------------------------------------------
-- 6 · Resuming a held deal knows the new statuses, and the retired ones.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_resume(p_deal uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_from   text;
  v_owner  uuid;
  v_ref    text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, hold_from_status, raised_by, coalesce(oc_no, quotation_no, customer_name)
    into v_status, v_from, v_owner, v_ref
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'on_hold' then raise exception 'This deal is not on hold'; end if;

  if not (public.fms_ocpi_is_coordinator(v_uid)
          or (v_owner = v_uid and public.module_can_edit(v_uid, 'ocpi'))) then
    raise exception 'Only the salesperson who raised this deal, or a coordinator, can resume it';
  end if;

  -- ⚠ NOT RECOMPUTED. The remembered status is the answer; deriving one here
  --   would be a second opinion about where the deal is.
  if v_from is null then
    raise exception 'This deal does not record where it was held from, so it cannot be resumed automatically. A coordinator will have to set it by hand.';
  end if;

  update public.fms_ocpi_deals
     set status           = v_from,
         current_step     = coalesce(
           (select s from (values
              ('awaiting_quotation_approval','quotation_approval'),
              -- ⚠ RETIRED, AND STILL LISTED. A deal held at either of these
              --   before the cutover must come back to where it was, not fall
              --   through to whatever `current_step` happens to hold.
              ('awaiting_order_confirmation','order_confirmation'),
              ('awaiting_oc_approval','oc_approval'),
              ('awaiting_customer_sign','customer_signoff'),
              ('awaiting_management_sign','management_signoff'),
              ('awaiting_finance_handover','finance_handover'),
              ('awaiting_finance_receipt','finance_receipt'),
              -- ⚠ WAS 'order_confirmation', A STEP THAT NO LONGER RUNS. A
              --   returned deal belongs with the salesperson who has to
              --   regenerate it, which is the quotation step.
              ('rework','quotation')
            ) as t(st, s) where t.st = v_from),
           current_step),
         hold_from_status = null,
         hold_at          = null,
         hold_reason      = null
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'deal_resumed',
    coalesce(v_ref, 'The deal') || ' is off hold',
    case when v_owner is null or v_owner = v_uid then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('to_status', v_from));
end $function$;

commit;
