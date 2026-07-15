-- Purchase FMS (import) — STAGE PROGRESSION through Advance & Follow-up.
--
-- Bug: nothing advanced current_stage past 'collect_pi'. share_po moved
-- share_po→collect_pi, but add_pi never advanced it and record_payment's
-- refresh only jumped to inward/tally/final on goods RECEIPT — so the
-- 'advance_payment' and 'follow_up' stages were never the current stage, and
-- the stepper showed Advance as pending even after an advance was paid.
--
-- Fix: derive the early stages in refresh_po from PO state (open, pre-receipt):
--   • an advance recorded            → follow_up   (Advance step done)
--   • a PI whose terms need an        → advance_payment
--     advance, none paid yet
--   • a PI exists, no advance needed  → follow_up   (chase dispatch)
-- and make add_pi call refresh_po so collecting a PI advances the stage.
-- Receipt-driven forward jumps (inward/tally/final) keep priority. Replace-only.

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
  -- received_qty per po_item from GRNs.
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

  -- Early-stage signals (advance / follow-up).
  select exists(select 1 from public.fms_import_payments
                 where po_id = p_po_id and kind = 'advance') into v_has_advance;
  select exists(select 1 from public.fms_import_pis
                 where po_id = p_po_id
                   and payment_terms in ('full_advance','partial_advance')) into v_needs_adv;
  select exists(select 1 from public.fms_import_pis where po_id = p_po_id) into v_has_pi;

  -- PI statuses from coverage vs received.
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
         status = case
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'closed'
           when coalesce(v_any_recv,false) then 'receiving'
           else status end,
         current_stage = case
           -- Receipt-driven stages take priority (existing behaviour).
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'final_payment'
           when coalesce(v_all_recv,false) and v_tally then 'final_payment'
           when coalesce(v_all_recv,false) then 'tally'
           when coalesce(v_any_recv,false) then 'inward'
           -- Derived early stages (open, pre-receipt) — never before share/collect.
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_has_advance then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_needs_adv then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_has_pi then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- Re-own add-PI unchanged except it now refreshes the PO so collecting a PI
-- advances the stage (collect_pi → advance_payment / follow_up).
create or replace function public.fms_import_add_pi(
  p_po_id uuid,
  p_vendor_pi_no text,
  p_items jsonb,           -- [{po_item_id, qty}]
  p_payment_terms text default 'on_delivery',
  p_pi_value numeric default 0,
  p_dispatch_date date default null,
  p_document_path text default null,
  p_document_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pi_id uuid; v_elem jsonb;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('collect_pi', auth.uid())) then
    raise exception 'Not authorized to add PIs';
  end if;
  if nullif(p_vendor_pi_no,'') is null then raise exception 'Vendor PI number is required'; end if;

  insert into public.fms_import_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, document_path, document_name, created_by)
  values (p_po_id, p_vendor_pi_no, coalesce(nullif(p_payment_terms,''),'on_delivery'), coalesce(p_pi_value,0), p_dispatch_date,
          nullif(p_document_path,''), nullif(p_document_name,''), auth.uid())
  returning id into v_pi_id;

  if p_items is not null then
    for v_elem in select * from jsonb_array_elements(p_items) loop
      if coalesce((v_elem->>'qty')::numeric,0) > 0 then
        insert into public.fms_import_pi_items (pi_id, po_item_id, qty)
        values (v_pi_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'qty')::numeric);
      end if;
    end loop;
  end if;

  update public.fms_import_pos set status = case when status='generated' then 'shared' else status end where id = p_po_id;
  perform public.fms_import_refresh_po(p_po_id);
  return v_pi_id;
end $$;
grant execute on function public.fms_import_add_pi(uuid, text, jsonb, text, numeric, date, text, text) to authenticated;
