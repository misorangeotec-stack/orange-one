-- ===========================================================================
-- Purchase FMS (procurement) — a PARTIALLY received PO stays at the INWARD stage.
--
-- The previous migration made an unbooked GRN park the PO at 'tally' so partial
-- receipts could be invoiced. But it did so ABOVE the inward branch, so a PO that
-- had received 100 of 500 showed the "Tally" stage badge and was measured against
-- the Tally SLA, even though the outstanding work is still receiving the other 400.
--
-- current_stage is a single pointer, so it should name the dominant outstanding
-- work: goods still owed ⇒ 'inward'. Tally QUEUE membership is separate and
-- driven by "has an unbooked GRN" (lib/queues.ts `poInTally`), so the same PO
-- correctly appears in BOTH the Inward and the Tally queue — receive the rest,
-- and book an invoice for what already arrived.
--
-- Replace-only: reorders two branches of refresh_po, then re-derives every PO.
-- ===========================================================================

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
           -- Terminal: everything received and fully settled.
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'closed'
           -- Goods still owed (partially received, or dispatched and awaiting GRN):
           -- receiving is the dominant work, so the stage stays 'inward'. The PO can
           -- still be in the Tally queue for whatever already arrived.
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           -- Fully received, an invoice still to book.
           when coalesce(v_unbooked_grn,false) then 'tally'
           -- Fully received, every GRN booked → settle the balance.
           when coalesce(v_all_recv,false) and coalesce(v_tally,false) then 'final_payment'
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- Re-derive every PO under the corrected ordering.
do $$
declare pid uuid;
begin
  for pid in select id from public.fms_purchase_pos loop
    perform public.fms_purchase_refresh_po(pid);
  end loop;
end $$;
