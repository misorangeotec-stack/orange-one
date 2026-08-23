-- ===========================================================================
-- OCPI FMS — the ways a deal leaves a queue without being signed.
--
--   fms_ocpi_hold(deal, reason)            park it, remembering where it was
--   fms_ocpi_resume(deal)                  put it back exactly where it was
--   fms_ocpi_cancel(deal, reason)          the deal is off
--   fms_ocpi_update_signed_docs(deal, slot, p)   replace a bad scan
--
-- ⚠ `on_hold` AND `cancelled` HAVE EXISTED SINCE PHASE 1 AND NOTHING SET THEM.
--   The status CHECK allowed both, OcpiStatus named both, and no code path could
--   reach either. A deal whose customer went quiet therefore had exactly two
--   futures: sit in somebody's queue for ever, or be approved through steps that
--   are no longer happening. That is worse than not offering the status at all,
--   because the queue then reports work nobody intends to do — and every
--   dashboard, scoreboard and "how much is outstanding" number inherits the lie.
--
-- ⚠ HOLD REMEMBERS. `hold_from_status` is written on the way in and is the ONLY
--   thing resume reads, so a deal parked at OC approval comes back at OC
--   approval — not at the start, and not at whatever step the code happens to
--   think is next. Recomputing the step on resume is how a deal quietly loses a
--   completed approval.
--
-- ⚠ CANCELLING GETS HARDER AS THE PAPER GETS REALER.
--     before the customer signs — the salesperson who raised it, or a coordinator
--     after the customer signs  — a coordinator only; somebody outside the deal
--                                 should be looking at a signed contract before
--                                 it is written off
--     once closed               — nobody. A completed, countersigned contract is
--                                 not undone by a status change in an internal
--                                 tool; that is a commercial matter and the
--                                 record must keep saying what happened.
--
-- ⚠ THE CORRECTION SURFACE IS DELIBERATELY ONE FUNCTION WIDE. Other modules
--   carry an `update_<step>` per step. Here almost nothing needs one:
--     · the quotation corrects itself by generating another revision, which is
--       the audited path the whole versions table exists for;
--     · part B corrects itself through rework, while the OC is still unsigned;
--     · after signature the document IS the paper in the customer's hand, so a
--       field-level "correction" would make our record disagree with theirs —
--       exactly the drift the frozen payload was built to prevent.
--   What genuinely can be wrong and otherwise unfixable is a SCAN: a dark photo,
--   a missing page, the wrong sheet. So that, and only that, is correctable.
--
-- ⚠ A CORRECTION ANNOUNCES WITH AN EMPTY RECIPIENT LIST. It belongs on the audit
--   trail; it is not news anyone must act on, and paging four people because a
--   page was re-photographed is how a notification bell stops being read.
--
-- Purely ADDITIVE: four functions, no schema change.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_update_signed_docs(uuid, text, jsonb);
--   drop function if exists public.fms_ocpi_cancel(uuid, text);
--   drop function if exists public.fms_ocpi_resume(uuid);
--   drop function if exists public.fms_ocpi_hold(uuid, text);
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. HOLD
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_hold(p_deal uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_ref    text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, coalesce(oc_no, quotation_no, customer_name)
    into v_status, v_owner, v_ref
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;

  if not (public.fms_ocpi_is_coordinator(v_uid)
          or (v_owner = v_uid and public.module_can_edit(v_uid, 'ocpi'))) then
    raise exception 'Only the salesperson who raised this deal, or a coordinator, can put it on hold';
  end if;

  -- A draft is already private and owes nobody; holding one would be a state
  -- with no observable difference. The terminal statuses are terminal.
  if v_status in ('draft', 'closed', 'cancelled', 'rejected') then
    raise exception 'A % deal cannot be put on hold', replace(v_status, '_', ' ');
  end if;
  if v_status = 'on_hold' then raise exception 'This deal is already on hold'; end if;
  if v_reason is null then
    raise exception 'Say why it is on hold, so whoever finds it later knows what to chase';
  end if;

  update public.fms_ocpi_deals
     set hold_from_status = v_status,
         status           = 'on_hold',
         hold_at          = now(),
         hold_reason      = v_reason
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'deal_held',
    coalesce(v_ref, 'The deal') || ' was put on hold: ' || v_reason,
    case when v_owner is null or v_owner = v_uid then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('from_status', v_status));
end $fn$;

comment on function public.fms_ocpi_hold(uuid, text) is
  'Park a deal, remembering the status it was at. Raiser or coordinator; a reason is required. Resume puts it back where it was.';
grant execute on function public.fms_ocpi_hold(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RESUME
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_resume(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
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
  --   would be a second opinion about where the deal is, and the two would
  --   disagree the first time the chain changed.
  if v_from is null then
    raise exception 'This deal does not record where it was held from, so it cannot be resumed automatically. A coordinator will have to set it by hand.';
  end if;

  update public.fms_ocpi_deals
     set status           = v_from,
         current_step     = coalesce(
           (select s from (values
              ('awaiting_quotation_approval','quotation_approval'),
              ('awaiting_order_confirmation','order_confirmation'),
              ('awaiting_oc_approval','oc_approval'),
              ('awaiting_customer_sign','customer_signoff'),
              ('awaiting_management_sign','management_signoff'),
              ('rework','order_confirmation')
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
end $fn$;

comment on function public.fms_ocpi_resume(uuid) is
  'Take a deal off hold, back to the status it was held from. Never recomputes the step — the remembered status is the answer.';
grant execute on function public.fms_ocpi_resume(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. CANCEL
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_cancel(p_deal uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_ref    text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_signed boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, coalesce(oc_no, quotation_no, customer_name), cs_doc_path is not null
    into v_status, v_owner, v_ref, v_signed
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;

  if v_status = 'closed' then
    raise exception 'This deal is complete and countersigned. A signed contract is not cancelled from inside this tool.';
  end if;
  if v_status = 'cancelled' then raise exception 'This deal is already cancelled'; end if;
  -- A draft is deleted, not cancelled: it burned no number and nobody has seen it.
  if v_status = 'draft' then
    raise exception 'This is still a draft — delete it instead. Nothing has been issued.';
  end if;
  if v_reason is null then
    raise exception 'Say why the deal is off — this is the only record of it';
  end if;

  if v_signed then
    if not public.fms_ocpi_is_coordinator(v_uid) then
      raise exception 'The customer has already signed this. Only a coordinator can write it off.';
    end if;
  elsif not (public.fms_ocpi_is_coordinator(v_uid)
             or (v_owner = v_uid and public.module_can_edit(v_uid, 'ocpi'))) then
    raise exception 'Only the salesperson who raised this deal, or a coordinator, can cancel it';
  end if;

  update public.fms_ocpi_deals
     set status        = 'cancelled',
         current_step  = null,
         cancelled_at  = now(),
         cancel_reason = v_reason
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'deal_cancelled',
    coalesce(v_ref, 'The deal') || ' was cancelled: ' || v_reason,
    case when v_owner is null or v_owner = v_uid then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('from_status', v_status, 'customer_had_signed', v_signed));
end $fn$;

comment on function public.fms_ocpi_cancel(uuid, text) is
  'Write a deal off. Raiser or coordinator before the customer signs, coordinator only after, nobody once closed. A reason is required.';
grant execute on function public.fms_ocpi_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. CORRECTING A SCAN
--
-- The only correction this module offers, and the header says why.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_update_signed_docs(
  p_deal uuid, p_slot text, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_ref   text;
  v_path  text := nullif(btrim(coalesce(p->>'doc_path', '')), '');
  v_pages jsonb;
  v_note  text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_have  boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_slot not in ('customer-signed', 'management-signed') then
    raise exception 'Unknown document: %', p_slot;
  end if;

  -- Coordinators only. Correcting a signed contract after the fact is exactly
  -- the act that wants a second pair of hands on it.
  if not public.fms_ocpi_is_coordinator(v_uid) then
    raise exception 'Only a coordinator can replace a filed signature';
  end if;

  select coalesce(oc_no, quotation_no, customer_name),
         case when p_slot = 'customer-signed' then cs_doc_path else ms_doc_path end is not null
    into v_ref, v_have
    from public.fms_ocpi_deals where id = p_deal for update;
  -- `found`, not `v_ref is null`: a deal with no number and no customer name yet
  -- is a real row, and testing the label would report it as missing.
  if not found then raise exception 'Deal not found'; end if;
  if not coalesce(v_have, false) then
    raise exception 'There is nothing filed in that slot yet, so there is nothing to correct';
  end if;
  if v_path is null then
    raise exception 'A correction still needs at least one page';
  end if;
  if split_part(v_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  v_pages := public.fms_ocpi_doc_pages(p->'doc_pages', v_path);

  update public.fms_ocpi_deals
     set cs_doc_path  = case when p_slot = 'customer-signed'   then v_path  else cs_doc_path  end,
         cs_doc_pages = case when p_slot = 'customer-signed'   then v_pages else cs_doc_pages end,
         ms_doc_path  = case when p_slot = 'management-signed' then v_path  else ms_doc_path  end,
         ms_doc_pages = case when p_slot = 'management-signed' then v_pages else ms_doc_pages end,
         edited_at    = now(),
         edited_by    = v_uid
   where id = p_deal;

  -- ⚠ EMPTY RECIPIENT LIST, ON PURPOSE. See the header.
  perform public.fms_ocpi_announce(
    'deal', p_deal, 'signed_doc_edited',
    'The ' || replace(p_slot, '-', ' ') || ' copy of ' || coalesce(v_ref, 'the deal')
      || ' was replaced' || case when v_note is null then '' else ': ' || v_note end,
    '{}'::uuid[],
    jsonb_build_object('slot', p_slot, 'pages', 1 + coalesce(jsonb_array_length(v_pages), 0)));
end $fn$;

comment on function public.fms_ocpi_update_signed_docs(uuid, text, jsonb) is
  'Replace the pages of an already-filed signature. Coordinators only, stamps edited_at/edited_by, and announces to NOBODY — it is an audit entry, not news.';
grant execute on function public.fms_ocpi_update_signed_docs(uuid, text, jsonb) to authenticated;

commit;
