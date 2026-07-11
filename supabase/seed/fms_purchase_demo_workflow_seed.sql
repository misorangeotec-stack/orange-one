-- Purchase FMS — demo WORKFLOW data (Phase 6). Creates a representative spread of
-- in-flight requests / POs / PIs / GRNs / payments across every stage and value
-- band, so each screen and queue shows live data. Re-runnable (clears its own
-- 'DEMO' rows first) and fully removed by fms_purchase_demo_teardown.sql (which
-- wipes all workflow rows). Requires fms_purchase_demo_seed.sql (masters) first.
--
-- Inserts directly (bypassing the RPC state machine) as the service role, so the
-- cached rollups (po_items.received_qty, pos.advance_paid, pi.status) are set
-- explicitly and kept internally consistent. Actor/requester = the Master Admin.

do $$
declare
  v_admin    uuid := '7c82f7b4-cb51-4304-89bc-5754c8f17cdc'; -- Master Admin
  v_l1       uuid := '7cd18ada-d6a7-4636-9edd-2f6aeeedd373'; -- Yash  (L1)
  v_l2       uuid := '79174071-1f03-46dd-bdf7-a6a7d3699877'; -- Ritesh (L2)
  v_director uuid := '853f57a4-fd21-4730-9666-09c2855fc815'; -- Aayush (Director)

  -- companies
  c_ent uuid; c_otec uuid; c_colorix uuid;
  -- categories
  cat_raw uuid; cat_pack uuid; cat_cons uuid;
  -- items
  it_ipa uuid; it_ace uuid; it_blue uuid; it_red uuid; it_carton uuid; it_filter uuid;
  -- vendors
  v_acme uuid; v_bluepack uuid; v_filterpro uuid;

  r uuid; l uuid; po uuid; poi uuid; pi uuid; grn uuid;
begin
  -- ---- clear prior demo workflow rows (by DEMO numbering) ----------------
  delete from public.fms_purchase_payments       where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-DEMO-%');
  delete from public.fms_purchase_tally_bookings  where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-DEMO-%');
  delete from public.fms_purchase_grn_items       where grn_id in (select id from public.fms_purchase_grns where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-DEMO-%'));
  delete from public.fms_purchase_grns            where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-DEMO-%');
  delete from public.fms_purchase_pi_items        where pi_id in (select id from public.fms_purchase_pis where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-DEMO-%'));
  delete from public.fms_purchase_pis             where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-DEMO-%');
  delete from public.fms_purchase_po_items        where po_id in (select id from public.fms_purchase_pos where po_no like 'PO-DEMO-%');
  delete from public.fms_purchase_pos             where po_no like 'PO-DEMO-%';
  delete from public.fms_purchase_quotations      where request_item_id in (select id from public.fms_purchase_request_items where request_id in (select id from public.fms_purchase_requests where request_no like 'PR-DEMO-%'));
  delete from public.fms_purchase_activity        where entity_id in (select id from public.fms_purchase_requests where request_no like 'PR-DEMO-%');
  delete from public.fms_purchase_request_items   where request_id in (select id from public.fms_purchase_requests where request_no like 'PR-DEMO-%');
  delete from public.fms_purchase_requests        where request_no like 'PR-DEMO-%';

  -- ---- resolve masters ---------------------------------------------------
  select id into c_ent     from public.fms_purchase_companies where name='Orange O Tec Enterprise';
  select id into c_otec    from public.fms_purchase_companies where name='Orange O-tec';
  select id into c_colorix from public.fms_purchase_companies where name='Colorix';
  select id into cat_raw  from public.fms_purchase_categories where name='Raw Material';
  select id into cat_pack from public.fms_purchase_categories where name='Packing Material';
  select id into cat_cons from public.fms_purchase_categories where name='Consumables';
  select id into it_ipa    from public.fms_purchase_items where name='Isopropyl Alcohol';
  select id into it_ace    from public.fms_purchase_items where name='Acetone';
  select id into it_blue   from public.fms_purchase_items where name='Blue Pigment';
  select id into it_red    from public.fms_purchase_items where name='Red Pigment';
  select id into it_carton from public.fms_purchase_items where name='5-ply Carton';
  select id into it_filter from public.fms_purchase_items where name='Cartridge Filter';
  select id into v_acme      from public.fms_purchase_vendors where name='Acme Chemicals Pvt Ltd';
  select id into v_bluepack  from public.fms_purchase_vendors where name='BluePack Industries';
  select id into v_filterpro from public.fms_purchase_vendors where name='FilterPro Supplies';

  if c_ent is null or it_ace is null or v_acme is null then
    raise exception 'Run fms_purchase_demo_seed.sql (masters) before the workflow seed';
  end if;

  -- =======================================================================
  -- PR-DEMO-001 — SOURCING (awaiting quotations)
  -- =======================================================================
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id, note)
  values ('PR-DEMO-001', c_ent, cat_raw, v_admin, 'Solvent top-up for line 2') returning id into r;
  insert into public.fms_purchase_request_items (request_id, item_id, quantity, unit, status)
  values (r, it_ace, 50, 'LTR', 'sourcing');
  insert into public.fms_purchase_activity (entity_type, entity_id, type, actor_id, note)
  values ('request', r, 'submitted', v_admin, 'New purchase request raised — awaiting sourcing');

  -- =======================================================================
  -- PR-DEMO-002 — APPROVAL (L1 band ~₹14,160), 3 quotes
  -- =======================================================================
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id, note)
  values ('PR-DEMO-002', c_ent, cat_raw, v_admin, NULL) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status)
  values (r, it_ipa, 100, 'KGS', v_acme, 100, 120, 18, round(100*120*1.18,2), 'approval') returning id into l;
  insert into public.fms_purchase_quotations (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended) values
    (l, v_acme, 120, 18, 5, true),
    (l, v_bluepack, 128, 18, 4, false),
    (l, v_filterpro, 124, 18, 7, false);

  -- =======================================================================
  -- PR-DEMO-003 — APPROVAL (Director band ~₹3.54L), 3 quotes
  -- =======================================================================
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id, note)
  values ('PR-DEMO-003', c_otec, cat_raw, v_admin, 'Bulk pigment for export order') returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status)
  values (r, it_blue, 500, 'KGS', v_acme, 500, 600, 18, round(500*600*1.18,2), 'approval') returning id into l;
  insert into public.fms_purchase_quotations (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended) values
    (l, v_acme, 600, 18, 10, true),
    (l, v_bluepack, 615, 18, 8, false),
    (l, v_filterpro, 590, 18, 14, false);

  -- =======================================================================
  -- PR-DEMO-004 — APPROVED, in the PO pool (L2 band ~₹94,400)
  -- =======================================================================
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-DEMO-004', c_otec, cat_raw, v_admin) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_red, 200, 'KGS', v_acme, 200, 400, 18, round(200*400*1.18,2), 'approved_pending_po', v_l2, 'L2 — Department Head') returning id into l;
  insert into public.fms_purchase_quotations (request_item_id, vendor_id, rate, gst_pct, is_recommended) values
    (l, v_acme, 400, 18, true), (l, v_bluepack, 410, 18, false);

  -- =======================================================================
  -- PO-DEMO-001 — GENERATED (awaiting share), from PR-DEMO-005 carton line
  -- =======================================================================
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-DEMO-005', c_otec, cat_pack, v_admin) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_carton, 1000, 'PCS', v_bluepack, 1000, 25, 12, round(1000*25*1.12,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by)
  values ('PO-DEMO-001', v_bluepack, c_otec, 'generated', 'share_po', round(1000*25*1.12,2), 0, v_admin) returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 1000, 25, 12, round(1000*25*1.12,2), 0);
  insert into public.fms_purchase_activity (entity_type, entity_id, type, actor_id, note)
  values ('po', po, 'po_generated', v_admin, 'A new PO is ready to share with the vendor');

  -- =======================================================================
  -- PO-DEMO-002 — RECEIVING (PI + advance + partial GRN), Acetone
  -- =======================================================================
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-DEMO-006', c_ent, cat_raw, v_admin) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_ace, 100, 'LTR', v_acme, 100, 90, 18, round(100*90*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by)
  values ('PO-DEMO-002', v_acme, c_ent, 'receiving', 'inward', round(100*90*1.18,2), 3000, v_admin) returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 100, 90, 18, round(100*90*1.18,2), 60) returning id into poi;
  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, status, dispatch_status, actual_dispatch_date, lr_no, transport_details, created_by)
  values (po, 'ACME/PI/4471', 'partial_advance', round(100*90*1.18,2), current_date - 3, 'partially_received', 'dispatched', current_date - 2, 'LR-44821', 'VRL Logistics', v_admin) returning id into pi;
  insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty) values (pi, poi, 100);
  insert into public.fms_purchase_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, created_by)
  values (po, pi, 'advance', 3000, current_date - 2, 'UTR-ADV-99001', v_admin);
  insert into public.fms_purchase_grns (po_id, pi_id, gate_register_no, condition, note, received_by)
  values (po, pi, 'GATE-2207', 'good', 'Partial receipt — 60 of 100', v_admin) returning id into grn;
  insert into public.fms_purchase_grn_items (grn_id, po_item_id, received_qty, condition) values (grn, poi, 60, 'good');
  insert into public.fms_purchase_activity (entity_type, entity_id, type, actor_id, note) values
    ('po', po, 'advance_paid', v_admin, 'Advance paid — follow up on dispatch'),
    ('po', po, 'grn_recorded', v_admin, 'Goods received (GRN) — partial 60/100');
  -- a couple of unread bell notifications for the admin
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id) values
    (v_admin, 'grn_recorded', 'po', po, 'Goods received (GRN) — book the entry in Tally', v_l1);

  -- =======================================================================
  -- PO-DEMO-003 — CLOSED (full receipt + tally + paid in two installments)
  -- =======================================================================
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-DEMO-007', c_colorix, cat_cons, v_admin) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_filter, 50, 'PCS', v_filterpro, 50, 200, 18, round(50*200*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by)
  values ('PO-DEMO-003', v_filterpro, c_colorix, 'closed', 'closed', round(50*200*1.18,2), round(50*200*1.18,2), v_admin) returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 50, 200, 18, round(50*200*1.18,2), 50) returning id into poi;
  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, status, dispatch_status, actual_dispatch_date, lr_no, created_by)
  values (po, 'FP/PI/0099', 'credit', round(50*200*1.18,2), current_date - 9, 'received', 'dispatched', current_date - 8, 'LR-7781', v_admin) returning id into pi;
  insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty) values (pi, poi, 50);
  insert into public.fms_purchase_grns (po_id, pi_id, gate_register_no, condition, received_by)
  values (po, pi, 'GATE-2190', 'good', v_admin) returning id into grn;
  insert into public.fms_purchase_grn_items (grn_id, po_item_id, received_qty, condition) values (grn, poi, 50, 'good');
  insert into public.fms_purchase_tally_bookings (po_id, grn_id, tally_pi_no, booked_by) values (po, grn, 'TLY/2627/00188', v_admin);
  insert into public.fms_purchase_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, created_by) values
    (po, pi, 'advance', 5000, current_date - 7, 'UTR-ADV-77001', v_admin),
    (po, pi, 'installment', round(50*200*1.18,2) - 5000, current_date - 1, 'UTR-FIN-77002', v_admin);
  insert into public.fms_purchase_activity (entity_type, entity_id, type, actor_id, note) values
    ('po', po, 'tally_booked', v_admin, 'Booked in Tally — final payment due'),
    ('po', po, 'installment_paid', v_admin, 'Final installment recorded — PO closed');
end $$;
