-- ===========================================================================
-- Purchase FMS (procurement) — approver-only PO CANCELLATION (vendor-requested).
--
-- Business rule: when a vendor asks to cancel a PO, a PO-side step owner LOGS the
-- request; only the PO's APPROVER (or an admin) may then cancel it. Remaking is
-- out of scope — if the goods are needed again the team re-punches a fresh PO.
--
-- "The approver of a PO" = the distinct set of approver_id stamped on the PO's
-- request lines (approval routes PER-LINE; fms_purchase_pos.total_value is only a
-- sum, so the matrix approver for the total could be someone who never touched
-- the PO). approver_id is non-null on any line that reached a PO.
--
-- Guardrail: a PO can be cancelled only while it has NO goods receipt (GRN) and
-- NO Tally booking. An advance already paid does NOT block (refund handled in
-- accounts); the frontend warns and requires a reason.
--
-- ADDITIVE ONLY: three nullable columns, one new table, three new RPCs, and a
-- terminal short-circuit prepended to the existing refresh_po. No business data
-- is mutated or dropped. `cancelled` is already a valid current_stage value.
--
-- Deploy ordering: apply BEFORE the frontend goes live (fetch reads the new
-- table + columns).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. PO cancellation audit columns (all nullable).
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_pos
  add column if not exists cancelled_by  uuid references auth.users on delete set null,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text;

-- ---------------------------------------------------------------------------
-- 2. Cancellation requests (owner logs the vendor's request → approver resolves).
--    Mirrors the fms_purchase_master_requests request→resolve shape.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_purchase_po_cancel_requests (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references public.fms_purchase_pos on delete cascade,
  reason       text not null,
  vendor_ref   text,
  status       text not null default 'pending' check (status in ('pending','approved','declined')),
  requested_by uuid references auth.users on delete set null,
  reviewed_by  uuid references auth.users on delete set null,
  review_note  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists fms_purchase_po_cancel_requests_po_idx
  on public.fms_purchase_po_cancel_requests (po_id);
-- At most one OPEN cancellation request per PO. A re-request after a decline is
-- allowed (the index only covers 'pending' rows).
create unique index if not exists fms_purchase_po_cancel_requests_one_pending
  on public.fms_purchase_po_cancel_requests (po_id) where status = 'pending';

drop trigger if exists trg_fms_purchase_po_cancel_requests_updated on public.fms_purchase_po_cancel_requests;
create trigger trg_fms_purchase_po_cancel_requests_updated before update on public.fms_purchase_po_cancel_requests
  for each row execute function public.set_updated_at();

-- RLS — select-all for authenticated; direct writes admin-only (the RPCs below
-- are SECURITY DEFINER and enforce the real per-role authz).
alter table public.fms_purchase_po_cancel_requests enable row level security;
drop policy if exists fms_purchase_po_cancel_requests_select on public.fms_purchase_po_cancel_requests;
create policy fms_purchase_po_cancel_requests_select on public.fms_purchase_po_cancel_requests
  for select to authenticated using (true);
drop policy if exists fms_purchase_po_cancel_requests_write_admin on public.fms_purchase_po_cancel_requests;
create policy fms_purchase_po_cancel_requests_write_admin on public.fms_purchase_po_cancel_requests
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3a. Stage 5–10 owners (or admin) may LOG a vendor cancellation request.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_request_po_cancel(
  p_po_id uuid, p_reason text, p_vendor_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage text;
  v_id    uuid;
begin
  if not (public.is_admin(auth.uid())
          or public.fms_purchase_is_step_owner('share_po', auth.uid())
          or public.fms_purchase_is_step_owner('collect_pi', auth.uid())
          or public.fms_purchase_is_step_owner('advance_payment', auth.uid())
          or public.fms_purchase_is_step_owner('follow_up', auth.uid())
          or public.fms_purchase_is_step_owner('inward', auth.uid())
          or public.fms_purchase_is_step_owner('tally', auth.uid())) then
    raise exception 'Not authorized to request a PO cancellation';
  end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;

  select current_stage into v_stage from public.fms_purchase_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;
  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % and cannot be cancelled', v_stage;
  end if;
  if exists (select 1 from public.fms_purchase_grns where po_id = p_po_id) then
    raise exception 'Goods already received — this PO can no longer be cancelled';
  end if;
  if exists (select 1 from public.fms_purchase_tally_bookings where po_id = p_po_id) then
    raise exception 'Already booked in Tally — this PO can no longer be cancelled';
  end if;

  insert into public.fms_purchase_po_cancel_requests (po_id, reason, vendor_ref, requested_by)
  values (p_po_id, btrim(p_reason), nullif(btrim(p_vendor_ref),''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.fms_purchase_request_po_cancel(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Only the PO's approver (or admin) may CANCEL it. Marks the PO + its lines
--     cancelled and, if a request id is passed, resolves that request.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_cancel_po(
  p_po_id uuid, p_reason text, p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_stage text;
begin
  select current_stage into v_stage from public.fms_purchase_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  -- Approver = a user stamped as approver_id on any of this PO's request lines.
  if not (public.is_admin(auth.uid())
          or exists (
            select 1
              from public.fms_purchase_po_items poi
              join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
             where poi.po_id = p_po_id and ri.approver_id = auth.uid())) then
    raise exception 'Only the approver of this PO can cancel it';
  end if;

  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % and cannot be cancelled', v_stage;
  end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if exists (select 1 from public.fms_purchase_grns where po_id = p_po_id) then
    raise exception 'Goods already received — this PO can no longer be cancelled';
  end if;
  if exists (select 1 from public.fms_purchase_tally_bookings where po_id = p_po_id) then
    raise exception 'Already booked in Tally — this PO can no longer be cancelled';
  end if;

  update public.fms_purchase_pos
     set current_stage = 'cancelled',
         status        = 'cancelled',
         cancelled_by  = auth.uid(),
         cancelled_at  = now(),
         cancel_reason = btrim(p_reason)
   where id = p_po_id;

  -- Drop the underlying request lines (order abandoned). They cannot be reused
  -- for a new PO (po_items.request_item_id is unique) — a re-punch is a fresh
  -- request. The existing cancel_line RPC refuses 'po' lines, so cancel here.
  update public.fms_purchase_request_items ri
     set status = 'cancelled',
         cancel_reason = btrim(p_reason)
   where ri.id in (
     select poi.request_item_id from public.fms_purchase_po_items poi where poi.po_id = p_po_id
   );

  if p_request_id is not null then
    update public.fms_purchase_po_cancel_requests
       set status = 'approved', reviewed_by = auth.uid()
     where id = p_request_id and po_id = p_po_id and status = 'pending';
  end if;
end $$;
grant execute on function public.fms_purchase_cancel_po(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. The approver (or admin) may DECLINE a cancellation request. PO stays open.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_decline_po_cancel(
  p_request_id uuid, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_po_id uuid;
begin
  select po_id into v_po_id from public.fms_purchase_po_cancel_requests
   where id = p_request_id and status = 'pending' for update;
  if v_po_id is null then raise exception 'Cancellation request not found or already resolved'; end if;

  if not (public.is_admin(auth.uid())
          or exists (
            select 1
              from public.fms_purchase_po_items poi
              join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
             where poi.po_id = v_po_id and ri.approver_id = auth.uid())) then
    raise exception 'Only the approver of this PO can decline the request';
  end if;

  update public.fms_purchase_po_cancel_requests
     set status = 'declined', reviewed_by = auth.uid(), review_note = nullif(btrim(p_note),'')
   where id = p_request_id;
end $$;
grant execute on function public.fms_purchase_decline_po_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Make `cancelled` a TERMINAL absorbing state. refresh_po (called by
--    record_payment/record_grn/book_tally) otherwise re-derives current_stage
--    unconditionally and would flip a cancelled PO with a dispatched follow-up
--    back to 'inward'. Body carried forward verbatim from 20260710120000 with a
--    single short-circuit prepended.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_refresh_po(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid          numeric(16,2);
  v_total         numeric(16,2);
  v_all_recv      boolean;
  v_any_recv      boolean;
  v_tally         boolean;
  v_has_advance   boolean;
  v_needs_adv     boolean;
  v_has_pi        boolean;
  v_dispatched    boolean;
  v_unbooked_grn  boolean;
begin
  -- Terminal states are absorbing: never re-derive a cancelled/closed PO.
  if (select current_stage from public.fms_purchase_pos where id = p_po_id) in ('cancelled','closed') then
    return;
  end if;

  update public.fms_purchase_po_items pi
     set received_qty = coalesce((
       select sum(gi.received_qty) from public.fms_purchase_grn_items gi where gi.po_item_id = pi.id
     ), 0)
   where pi.po_id = p_po_id;

  select coalesce(sum(amount),0) into v_paid from public.fms_purchase_payments where po_id = p_po_id;
  select total_value into v_total from public.fms_purchase_pos where id = p_po_id;
  select bool_and(received_qty >= qty), bool_or(received_qty > 0)
    into v_all_recv, v_any_recv
    from public.fms_purchase_po_items where po_id = p_po_id;
  select exists(select 1 from public.fms_purchase_tally_bookings where po_id = p_po_id) into v_tally;

  -- A goods receipt still awaiting its Tally invoice.
  select exists(
    select 1 from public.fms_purchase_grns gr
     where gr.po_id = p_po_id
       and not exists (select 1 from public.fms_purchase_tally_bookings t where t.grn_id = gr.id)
  ) into v_unbooked_grn;

  select exists(select 1 from public.fms_purchase_payments where po_id = p_po_id) into v_has_advance;
  select payment_terms in ('full_advance','partial_advance')
    from public.fms_purchase_pos where id = p_po_id into v_needs_adv;
  select exists(select 1 from public.fms_purchase_pis where po_id = p_po_id) into v_has_pi;
  select exists(select 1 from public.fms_purchase_followups where po_id = p_po_id and dispatch_status = 'dispatched')
      or exists(select 1 from public.fms_purchase_pis where po_id = p_po_id and dispatch_status = 'dispatched')
    into v_dispatched;

  update public.fms_purchase_pis p
     set status = case
       when not exists (select 1 from public.fms_purchase_pi_items x where x.pi_id = p.id) then p.status
       when (select bool_and(poi.received_qty >= pii.qty)
               from public.fms_purchase_pi_items pii
               join public.fms_purchase_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'received'
       when (select bool_or(poi.received_qty > 0)
               from public.fms_purchase_pi_items pii
               join public.fms_purchase_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'partially_received'
       else 'open' end
   where p.po_id = p_po_id;

  update public.fms_purchase_pos
     set advance_paid = v_paid,
         current_stage = case
           when coalesce(v_all_recv,false)
                and ( (coalesce(v_tally,false) and not coalesce(v_unbooked_grn,false))
                      or (v_paid >= v_total and v_total > 0) ) then 'closed'
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           when coalesce(v_unbooked_grn,false) then 'tally'
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;
