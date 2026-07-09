-- ===========================================================================
-- Purchase FMS (procurement) — a PARTIAL GRN must reach Tally (and beyond).
--
-- Each goods receipt is booked as its own invoice in the accounting software, so
-- a PO with several partial GRNs produces several Tally invoices. Until now
-- refresh_po only moved a PO to 'tally' once EVERY line was received
-- (v_all_recv), so a partial receipt sat at 'inward' and never surfaced in the
-- Tally queue — its invoice could not be booked, and the payment that follows it
-- was blocked too.
--
-- Fix: the Tally stage is driven by "is there a GRN with no Tally booking yet?",
-- regardless of whether the PO is fully received. A PO therefore cycles
-- inward → tally → inward → tally … as partial consignments arrive, and only
-- lands on final_payment once everything is received AND every GRN is booked.
--
-- To make "unbooked" well-defined, book_tally now REQUIRES the GRN it is booking
-- against (one invoice per receipt) and rejects double-booking the same GRN.
-- Legacy bookings with a null grn_id are backfilled by pairing each PO's
-- bookings to its GRNs in chronological order.
--
-- Additive / replace-only: no schema change, one data backfill.
-- ===========================================================================

-- 1. Backfill legacy bookings that were not tied to a GRN ---------------------
with b as (
  select id, po_id, row_number() over (partition by po_id order by created_at, id) as rn
    from public.fms_purchase_tally_bookings
   where grn_id is null
),
g as (
  select gr.id, gr.po_id, row_number() over (partition by gr.po_id order by gr.created_at, gr.id) as rn
    from public.fms_purchase_grns gr
   where not exists (
     select 1 from public.fms_purchase_tally_bookings t where t.grn_id = gr.id
   )
)
update public.fms_purchase_tally_bookings t
   set grn_id = g.id
  from b
  join g on g.po_id = b.po_id and g.rn = b.rn
 where t.id = b.id;

-- 2. refresh_po — an unbooked GRN (partial or full) parks the PO at 'tally' ----
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

  -- A goods receipt still awaiting its Tally invoice — the Tally step's real trigger.
  select exists(
    select 1 from public.fms_purchase_grns gr
     where gr.po_id = p_po_id
       and not exists (select 1 from public.fms_purchase_tally_bookings t where t.grn_id = gr.id)
  ) into v_unbooked_grn;

  -- Any payment made pre-receipt satisfies the advance step (advance OR installment).
  select exists(select 1 from public.fms_purchase_payments where po_id = p_po_id) into v_has_advance;
  -- Advance need comes from the PO's payment terms.
  select payment_terms in ('full_advance','partial_advance')
    from public.fms_purchase_pos where id = p_po_id into v_needs_adv;
  select exists(select 1 from public.fms_purchase_pis where po_id = p_po_id) into v_has_pi;
  -- Goods on the way: a PO-level follow-up (or a legacy PI snapshot) says dispatched.
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
           -- Terminal: everything received and fully settled.
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'closed'
           -- Any receipt (partial OR full) whose invoice is not booked yet → Tally.
           when coalesce(v_unbooked_grn,false) then 'tally'
           -- Fully received, every GRN booked → settle the balance.
           when coalesce(v_all_recv,false) and coalesce(v_tally,false) then 'final_payment'
           when coalesce(v_all_recv,false) then 'tally'
           -- Partially received, invoices booked → keep receiving the rest.
           when coalesce(v_any_recv,false) then 'inward'
           when coalesce(v_dispatched,false) then 'inward'   -- dispatched, awaiting GRN
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- 3. book_tally — one invoice per GRN; the GRN is now required ----------------
drop function if exists public.fms_purchase_book_tally(uuid, text, uuid, text, text, text);
create or replace function public.fms_purchase_book_tally(
  p_po_id uuid,
  p_tally_pi_no text,
  p_grn_id uuid default null,
  p_document_path text default null,
  p_document_name text default null,
  p_remarks text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_has_grn boolean; v_grn_po uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('tally', auth.uid())) then
    raise exception 'Not authorized to book in Tally';
  end if;
  if nullif(p_tally_pi_no,'') is null then raise exception 'Tally invoice number is required'; end if;

  select exists(select 1 from public.fms_purchase_grns where po_id = p_po_id) into v_has_grn;
  if v_has_grn and p_grn_id is null then
    raise exception 'Select the goods receipt (GRN) this invoice is booked against';
  end if;

  if p_grn_id is not null then
    select po_id into v_grn_po from public.fms_purchase_grns where id = p_grn_id;
    if v_grn_po is distinct from p_po_id then raise exception 'That GRN does not belong to this PO'; end if;
    if exists(select 1 from public.fms_purchase_tally_bookings where grn_id = p_grn_id) then
      raise exception 'That GRN is already booked in Tally';
    end if;
  end if;

  insert into public.fms_purchase_tally_bookings
    (po_id, grn_id, tally_pi_no, document_path, document_name, remarks, booked_by)
  values
    (p_po_id, p_grn_id, p_tally_pi_no, nullif(p_document_path,''), nullif(p_document_name,''), nullif(p_remarks,''), auth.uid())
  returning id into v_id;
  perform public.fms_purchase_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_purchase_book_tally(uuid, text, uuid, text, text, text) to authenticated;

-- 4. Heal every PO under the new Tally rule ----------------------------------
do $$
declare pid uuid;
begin
  for pid in select id from public.fms_purchase_pos loop
    perform public.fms_purchase_refresh_po(pid);
  end loop;
end $$;
