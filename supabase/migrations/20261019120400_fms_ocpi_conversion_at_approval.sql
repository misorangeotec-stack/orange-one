-- ===========================================================================
-- OCPI — STAGE E of the revision: the quotation BECOMES the order confirmation
-- when the Directors approve it, and that is the moment the number is minted.
--
-- WHAT THE CLIENT ASKED FOR
--   "At this stage, only the quotation will be converted to order confirmation."
--   Both papers go out headed ORDER QUOTATION; when the Directors approve, the
--   same pair is re-headed ORDER CONFIRMATION and `OTPL/OC/<fy>/nnnn` is minted.
--   Nothing before that approval may be printed as a signature copy.
--
-- ⚠ WHY MINTING AND RENDERING HAPPEN IN ONE ACTION. They cannot be split:
--     · Mint earlier (at submit, as today) and a quotation the Directors reject
--       has already burned a number from a series customers hold. The client was
--       explicitly promised that would not happen.
--     · Render earlier and the contract prints with no number on it.
--   So the number is minted HERE, in the approve arm, and the approving
--   Director's browser immediately re-renders both papers WITH it, uploads them
--   and calls fms_ocpi_freeze_oc. If that upload fails the number still stands —
--   ApprovedOcPreview rebuilds from the template and SAYS SO on screen, which is
--   the failure mode we can live with; a minted number that no paper carries is
--   not.
--
-- ⚠ A DIRECTOR COULD NOT WRITE THE FILE. fms_ocpi_can_add_doc mapped the `oc`
--   storage slot to the `order_confirmation` step, and its only other arm admits
--   the RAISER. A Director approving is neither, so the upload at conversion was
--   refused by the storage policy — silently, with nothing in the UI to say why,
--   and INVISIBLE TO AN ADMIN ACCOUNT because coordinators pass unconditionally.
--   The `oc` slot now also admits whoever may act on `quotation_approval`.
--
--   The old arm is KEPT rather than replaced. Deals parked at the retired
--   order-confirmation step still have to be able to file their document until
--   stage F retires the step, and an additive arm cannot break them.
--
-- ⚠ THE has_template REFUSAL IS NOT CARRIED ONTO THE APPROVAL. 18 of the 28
--   machines have no detailed template; fms_ocpi_submit_oc refuses those by
--   name, and copying that refusal here would block 64% of the catalogue at the
--   Directors' gate. Summary-only is a legal outcome. submit_oc keeps its own
--   refusal — that path is retired, not repaired, in stage F.
--
-- WHAT THIS MIGRATION DOES
--   1. fms_ocpi_deals gains `oc_summary_pdf_path` — the approved SUMMARY sheet.
--      `oc_pdf_path` already holds the detailed one; the approved pair is what
--      gets printed for signature, so both need somewhere to live.
--   2. fms_ocpi_decide_quotation mints `oc_no` on approve and stamps oc_at/oc_by.
--   3. fms_ocpi_freeze_oc takes the summary path too, and admits the approver.
--   4. fms_ocpi_can_add_doc admits the approver to the `oc` slot.
--
-- ⚠ ADDING A PARAMETER TO create or replace MAKES AN OVERLOAD. freeze_oc's
--   3-argument signature is dropped explicitly first — the same trap stage A hit
--   with fms_ocpi_set_version_pdf, where two functions sat in the catalogue and
--   only reading pg_proc showed it.
--
-- Additive only: one new nullable column, four function bodies. No data rewritten.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_freeze_oc(uuid, jsonb, text, text);
--   -- re-run 20260929121400's fms_ocpi_freeze_oc verbatim (3 args)
--   -- re-run 20260929121200's fms_ocpi_decide_quotation verbatim
--   -- re-run 20260929121600's fms_ocpi_can_add_doc verbatim
--   alter table public.fms_ocpi_deals drop column if exists oc_summary_pdf_path;
--
-- ⚠ THE REVERSAL LOSES THE APPROVED SUMMARY'S PATH, found by rehearsing it on
--   live data rather than reading it. Dropping the column drops what it held;
--   the FILES themselves survive in storage under `<deal-id>/oc/… Summary.pdf`,
--   so re-applying and re-pointing the column is a repair, not a re-render. Any
--   real rollback should copy the column out first.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Somewhere for the approved SUMMARY to live.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_deals
  add column if not exists oc_summary_pdf_path text;

comment on column public.fms_ocpi_deals.oc_summary_pdf_path is
  'The approved summary sheet, re-headed ORDER CONFIRMATION and carrying the OC number. Its sibling oc_pdf_path holds the detailed sheet. Written by fms_ocpi_freeze_oc at the Directors approval.';

-- ---------------------------------------------------------------------------
-- 2 · The approval mints the order-confirmation number.
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
  --   burns no number — that was an explicit promise — and a deal that already
  --   carries one keeps it, so a historical row that came through the old
  --   submit_oc path is never renumbered.
  if p_decision = 'approve' and v_oc is null then
    v_fy := public.fms_ocpi_fy_code(current_date);
    v_oc := 'OTPL/OC/' || v_fy || '/' ||
            lpad(public.fms_ocpi_next_seq('oc:' || v_fy)::text, 4, '0');
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
         oc_no         = coalesce(v_oc, oc_no),
         -- The order confirmation comes into being at the approval now, so this
         -- is when it was made and who made it.
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
        when 'approve' then 'approved — order confirmation ' || coalesce(v_oc, '') || ' issued'
        when 'reject'  then 'rejected'
        else 'sent back for changes' end ||
      case when nullif(btrim(coalesce(p_note,'')),'') is null then '' else ': ' || btrim(p_note) end,
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('decision', p_decision, 'quotation_no', v_no, 'oc_no', v_oc));
end $function$;

-- ---------------------------------------------------------------------------
-- 3 · Freezing takes BOTH approved papers, and the approver may do it.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_ocpi_freeze_oc(uuid, jsonb, text);

create or replace function public.fms_ocpi_freeze_oc(
  p_deal         uuid,
  p_document     jsonb,
  p_path         text default null,
  p_summary_path text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  -- ⚠ THE APPROVER IS NOW THE ONE WHO PRODUCES THIS DOCUMENT, so they must be
  --   able to freeze it. The order_confirmation arm and the raiser arm are kept
  --   so the retired step still works until stage F removes it.
  if not public.fms_ocpi_can_act('quotation_approval', p_deal, v_uid)
     and not public.fms_ocpi_can_act('order_confirmation', p_deal, v_uid)
     and not exists (select 1 from public.fms_ocpi_deals where id = p_deal and raised_by = v_uid) then
    raise exception 'Not authorized';
  end if;
  -- ⚠ Each path must live under this deal's own folder — the storage policy
  --   derives the owning deal from the first segment.
  if p_path is not null and split_part(p_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;
  if p_summary_path is not null and split_part(p_summary_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  update public.fms_ocpi_deals
     set oc_document_payload = coalesce(p_document, '{}'::jsonb),
         oc_pdf_path         = coalesce(p_path, oc_pdf_path),
         oc_summary_pdf_path = coalesce(p_summary_path, oc_summary_pdf_path)
   where id = p_deal;
end $function$;

-- ---------------------------------------------------------------------------
-- 4 · The storage policy lets the approver write the `oc` slot.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_can_add_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.fms_ocpi_deals d
     where d.id = public.fms_ocpi_doc_deal(p_name)
       and (
             public.fms_ocpi_is_coordinator(p_uid)   -- admins included
          or public.fms_ocpi_can_act(
               case split_part(p_name, '/', 2)
                 when 'quotation'         then 'quotation'
                 when 'oc'                then 'order_confirmation'
                 when 'customer-signed'   then 'customer_signoff'
                 when 'management-signed' then 'management_signoff'
               end,
               d.id,
               p_uid)
          -- ⚠ THE APPROVING DIRECTOR WRITES THE `oc` SLOT. The conversion
          --   happens in their browser — mint, re-render, upload — and without
          --   this arm the storage policy refuses them, silently, on a path no
          --   admin account can reach because coordinators pass above.
          or (split_part(p_name, '/', 2) = 'oc'
              and public.fms_ocpi_can_act('quotation_approval', d.id, p_uid))
          -- The salesperson who raised the deal files the three documents that
          -- pass through their hands. NOT the countersignature.
          or (d.raised_by = p_uid
              and public.module_can_edit(p_uid, 'ocpi')
              and split_part(p_name, '/', 2) in ('quotation', 'oc', 'customer-signed'))
       )
  );
$function$;

commit;
