-- Purchase FMS — remove everything added by fms_purchase_demo_persona_seed.sql:
-- the PR-PDEMO-% / PO-PDEMO-% workflow rows (+ their notifications), the demo
-- step-owner assignments, and the process_coordinators config key. Masters and
-- the approval matrix are left in place (owned by the masters seed). Safe to
-- re-run.

do $$
begin
  delete from public.fms_purchase_notifications where entity_id in (
    select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%'
    union select id from public.fms_purchase_requests where request_no like 'PR-PDEMO-%'
    union select ri.id from public.fms_purchase_request_items ri
      join public.fms_purchase_requests rq on rq.id = ri.request_id where rq.request_no like 'PR-PDEMO-%'
  );
  delete from public.fms_purchase_payments      where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%');
  delete from public.fms_purchase_tally_bookings where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%');
  delete from public.fms_purchase_grn_items      where grn_id in (select id from public.fms_purchase_grns where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%'));
  delete from public.fms_purchase_grns           where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%');
  delete from public.fms_purchase_pi_items       where pi_id in (select id from public.fms_purchase_pis where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%'));
  delete from public.fms_purchase_pis            where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%');
  delete from public.fms_purchase_po_items       where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-PDEMO-%');
  delete from public.fms_purchase_pos            where po_no like 'PO-PDEMO-%';
  delete from public.fms_purchase_quotations     where request_item_id in (select id from public.fms_purchase_request_items where request_id in (select id from public.fms_purchase_requests where request_no like 'PR-PDEMO-%'));
  delete from public.fms_purchase_activity       where entity_id in (select id from public.fms_purchase_requests where request_no like 'PR-PDEMO-%');
  delete from public.fms_purchase_request_items  where request_id in (select id from public.fms_purchase_requests where request_no like 'PR-PDEMO-%');
  delete from public.fms_purchase_requests       where request_no like 'PR-PDEMO-%';

  -- Demo persona wiring.
  delete from public.fms_purchase_step_owners where step_key in
    ('request','sourcing','po','share_po','collect_pi','advance_payment','follow_up','inward','tally');
  delete from public.fms_purchase_config where key = 'process_coordinators';
end $$;
