-- Purchase FMS (import) — ADVANCE step satisfied by ANY pre-receipt payment.
--
-- Bug: the advance step (and the Advance queue) only recognised payments of
-- kind='advance'. A user who recorded a partial payment as an 'installment'
-- (e.g. via the PO's "Record Payment") left the PO stuck at current_stage
-- 'advance_payment' and still showing in the Advance queue, even though money
-- had been paid. In the pre-receipt window any payment is effectively the
-- advance, so treat ANY payment as satisfying the advance step → the PO advances
-- to 'follow_up'. Receipt-driven stages (inward/tally/final/closed) keep priority.
-- Replace-only (single-line change to v_has_advance); then re-derive all POs.

create or replace function public.fms_import_refresh_po(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid         numeric(16,2);
  v_total        numeric(16,2);
  v_all_recv     boolean;
  v_any_recv     boolean;
  v_tally        boolean;
  v_has_advance  boolean;
  v_needs_adv    boolean;
  v_has_pi       boolean;
begin
  update public.fms_import_po_items pi
     set received_qty = coalesce((
       select sum(gi.received_qty) from public.fms_import_grn_items gi where gi.po_item_id = pi.id
     ), 0)
   where pi.po_id = p_po_id;

  select coalesce(sum(amount),0) into v_paid from public.fms_import_payments where po_id = p_po_id;
  select total_value into v_total from public.fms_import_pos where id = p_po_id;
  select bool_and(received_qty >= qty), bool_or(received_qty > 0)
    into v_all_recv, v_any_recv
    from public.fms_import_po_items where po_id = p_po_id;
  select exists(select 1 from public.fms_import_tally_bookings where po_id = p_po_id) into v_tally;

  -- Any payment made pre-receipt satisfies the advance step (advance OR a partial
  -- installment). Was: kind = 'advance' only.
  select exists(select 1 from public.fms_import_payments where po_id = p_po_id) into v_has_advance;
  select exists(select 1 from public.fms_import_pis
                 where po_id = p_po_id
                   and payment_terms in ('full_advance','partial_advance')) into v_needs_adv;
  select exists(select 1 from public.fms_import_pis where po_id = p_po_id) into v_has_pi;

  update public.fms_import_pis p
     set status = case
       when not exists (select 1 from public.fms_import_pi_items x where x.pi_id = p.id) then p.status
       when (select bool_and(poi.received_qty >= pii.qty)
               from public.fms_import_pi_items pii
               join public.fms_import_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'received'
       when (select bool_or(poi.received_qty > 0)
               from public.fms_import_pi_items pii
               join public.fms_import_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'partially_received'
       else 'open' end
   where p.po_id = p_po_id;

  update public.fms_import_pos
     set advance_paid = v_paid,
         current_stage = case
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'closed'
           when coalesce(v_all_recv,false) and v_tally then 'final_payment'
           when coalesce(v_all_recv,false) then 'tally'
           when coalesce(v_any_recv,false) then 'inward'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_has_advance then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_needs_adv then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_has_pi then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- Heal every PO under the new rule.
do $$
declare pid uuid;
begin
  for pid in select id from public.fms_import_pos loop
    perform public.fms_import_refresh_po(pid);
  end loop;
end $$;
