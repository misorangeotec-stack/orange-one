-- ===========================================================================
-- OCPI FMS — freeze the order confirmation, and approval gate 2.
--
--   fms_ocpi_deals.oc_document_payload / oc_pdf_path   the frozen document
--   fms_ocpi_freeze_oc(deal, document, path)           called at submit
--   fms_ocpi_decide_oc(deal, decision, note)           management's decision
--
-- ⚠ THE ORDER CONFIRMATION IS FROZEN FOR THE SAME REASON THE QUOTATION IS.
--   It is built from a machine template an admin can reword at any time. Without
--   a snapshot, editing the cancellation clause next month would silently change
--   the wording of a contract a customer signed last month — and this document,
--   unlike the quotation, is the one that gets signed by both parties. The
--   resolved document (spec rows with their tokens filled, section bodies, the
--   company's bank block and Ex-Works city) is stored with the deal.
--
-- ⚠ ONE SNAPSHOT PER DEAL, NOT ONE PER REVISION. The quotation may legitimately
--   be revised many times during a negotiation, so its versions are a table. The
--   order confirmation is submitted, approved and signed once; if management
--   send it back, the salesperson edits and resubmits, and the FROZEN COPY IS
--   REPLACED because nothing was signed against the old one. The moment
--   something is signed — phase 8 — the file in storage is the record.
--
-- Purely ADDITIVE: two columns, two functions.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_decide_oc(uuid, text, text);
--   drop function if exists public.fms_ocpi_freeze_oc(uuid, jsonb, text);
--   alter table public.fms_ocpi_deals drop column if exists oc_pdf_path;
--   alter table public.fms_ocpi_deals drop column if exists oc_document_payload;
-- ===========================================================================

begin;

alter table public.fms_ocpi_deals
  add column if not exists oc_document_payload jsonb,
  add column if not exists oc_pdf_path text;

comment on column public.fms_ocpi_deals.oc_document_payload is
  'The RESOLVED order confirmation as it stood when submitted — spec rows with tokens filled, section bodies, the selling company block. Rewording a machine template later cannot rewrite it.';

-- ---------------------------------------------------------------------------
-- Freeze the resolved document. Called by the browser straight after submit,
-- with exactly what the renderer used.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_freeze_oc(
  p_deal uuid, p_document jsonb, p_path text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_ocpi_can_act('order_confirmation', p_deal, v_uid)
     and not exists (select 1 from public.fms_ocpi_deals where id = p_deal and raised_by = v_uid) then
    raise exception 'Not authorized';
  end if;
  -- ⚠ The path must live under this deal's own folder — the storage policy
  --   derives the owning deal from the first segment.
  if p_path is not null and split_part(p_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  update public.fms_ocpi_deals
     set oc_document_payload = coalesce(p_document, '{}'::jsonb),
         oc_pdf_path = coalesce(p_path, oc_pdf_path)
   where id = p_deal;
end $$;

comment on function public.fms_ocpi_freeze_oc(uuid, jsonb, text) is
  'Store the resolved order confirmation and its PDF path. Replaced on resubmission — nothing has been signed against a returned draft.';
grant execute on function public.fms_ocpi_freeze_oc(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Management's decision on the order confirmation.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_decide_oc(
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
  v_oc     text;
  v_next   text;
  v_event  text;
  v_sole   boolean;
  v_owners uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approve', 'reject', 'rework') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select status, raised_by, oc_no into v_status, v_owner, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;

  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'awaiting_oc_approval' then
    raise exception 'This order confirmation is not waiting for approval';
  end if;
  if not public.fms_ocpi_can_act('oc_approval', p_deal, v_uid) then
    raise exception 'You are not an approver for order confirmations';
  end if;

  v_owners := public.fms_ocpi_step_owner_ids('oc_approval');
  v_sole := (array_length(v_owners, 1) = 1 and v_owners[1] = v_uid);
  if v_owner = v_uid and not v_sole then
    raise exception 'You raised this deal, so somebody else has to confirm it';
  end if;

  if p_decision in ('reject', 'rework') and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why, so the salesperson knows what to do next';
  end if;

  -- ⚠ APPROVAL HERE SENDS IT TO THE CUSTOMER, not to a filing cabinet. The next
  --   step is printing it and getting a signature, so the deal moves to
  --   awaiting_customer_sign and the salesperson is the one told.
  v_next := case p_decision
              when 'approve' then 'awaiting_customer_sign'
              when 'reject'  then 'rejected'
              else 'awaiting_order_confirmation'
            end;
  v_event := case p_decision
               when 'approve' then 'oc_approved'
               when 'reject'  then 'oc_rejected'
               else 'oc_returned'
             end;

  update public.fms_ocpi_deals
     set status        = v_next,
         current_step  = case p_decision when 'approve' then 'customer_signoff' else 'order_confirmation' end,
         oca_decision  = p_decision,
         oca_note      = nullif(btrim(coalesce(p_note, '')), ''),
         oca_at        = now(),
         oca_by        = v_uid,
         rejected_at   = case when p_decision = 'reject' then now() else rejected_at end,
         reject_stage  = case when p_decision = 'reject' then 'oc_approval' else reject_stage end,
         reject_reason = case when p_decision = 'reject' then nullif(btrim(coalesce(p_note,'')),'') else reject_reason end,
         rework_at     = case when p_decision = 'rework' then now() else rework_at end,
         rework_stage  = case when p_decision = 'rework' then 'oc_approval' else rework_stage end,
         rework_reason = case when p_decision = 'rework' then nullif(btrim(coalesce(p_note,'')),'') else rework_reason end,
         rework_count  = rework_count + case when p_decision = 'rework' then 1 else 0 end
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, v_event,
    coalesce(v_oc, 'The order confirmation') || ' was ' ||
      case p_decision when 'approve' then 'confirmed — print it and get the customer to sign'
                      when 'reject'  then 'rejected'
                      else 'sent back for changes' end ||
      case when nullif(btrim(coalesce(p_note,'')),'') is null then '' else ': ' || btrim(p_note) end,
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('decision', p_decision, 'oc_no', v_oc));
end $$;

comment on function public.fms_ocpi_decide_oc(uuid, text, text) is
  'Confirm, reject or return an order confirmation. Approval moves the deal to awaiting_customer_sign. Reject and rework require a reason; self-approval is refused unless the approver is the only one configured.';
grant execute on function public.fms_ocpi_decide_oc(uuid, text, text) to authenticated;

commit;
