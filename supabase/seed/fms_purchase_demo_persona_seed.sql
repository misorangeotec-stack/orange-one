-- Purchase FMS — DEMO PERSONA seed for the "Act as Persona" stakeholder demo.
--
-- Wires one real directory user to each workflow step (so the persona switcher
-- lists a distinct person per role and every capability flag lights up), sets a
-- process coordinator, then parks ONE in-flight item at EVERY stage so each
-- persona's queue + bell are non-empty. Requires the masters seed
-- (fms_purchase_demo_seed.sql: companies/items/vendors/approval matrix) first.
--
-- Re-runnable: clears its own PR-PDEMO-% / PO-PDEMO-% rows (and their
-- notifications) before re-inserting. Removed by fms_purchase_demo_persona_teardown.sql.
-- Inserts directly (service role) and sets cached rollups explicitly, matching
-- the fms_purchase_refresh_po state machine so each stage is internally consistent.

do $$
declare
  -- ---- personas (real directory users; approver comes from the matrix) ------
  p_request  uuid := '1b0deef0-fbcf-40eb-b3d4-b00f8a87e3b7'; -- Riya Kumari    (Requester)
  p_source   uuid := '0a5b2a81-f741-4dcc-8ac5-570e27ad3cf8'; -- Rohan Jariwala (Sourcing)
  p_po       uuid := '261ae1c1-9389-427a-9fa3-1c8df7326f73'; -- Jyoti          (PO Desk)
  p_share    uuid := '0600d53e-8077-4ee6-9f12-239d3c198558'; -- Neha           (Share PO)
  p_pi       uuid := 'a43038e5-1c05-45b0-b316-9e87bbb2b11b'; -- Bushra         (Collect PI)
  p_adv      uuid := '0311ce96-d58a-4d2a-b580-d186d4d3673a'; -- Manisha Rane   (Advance)
  p_follow   uuid := 'fde9faec-c6f5-4670-91b6-5e4ee4c085ff'; -- Ravina         (Follow-up)
  p_inward   uuid := '1e40c1b8-3bd1-46c6-b4e7-393b0ae6168c'; -- Vishal Dabekar (Inward/GRN)
  p_tally    uuid := 'bb096b8e-bbae-4476-ae6b-89111fbad4bd'; -- Jayshree Patil (Tally)
  p_coord    uuid := '7c82f7b4-cb51-4304-89bc-5754c8f17cdc'; -- Master Admin   (Coordinator/Admin)
  v_l1       uuid := '7cd18ada-d6a7-4636-9edd-2f6aeeedd373'; -- Yash Agarwal   (Approver = matrix L1)

  -- masters
  c_ent uuid; c_otec uuid; c_colorix uuid;
  cat_raw uuid; cat_pack uuid; cat_cons uuid;
  it_ipa uuid; it_ace uuid; it_blue uuid; it_red uuid; it_carton uuid; it_label uuid; it_filter uuid;
  v_acme uuid; v_bluepack uuid; v_filterpro uuid;

  r uuid; l uuid; po uuid; poi uuid; pi uuid; grn uuid;
begin
  -- ---- clear prior persona-demo rows ------------------------------------------
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

  -- ---- resolve masters --------------------------------------------------------
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
  select id into it_label  from public.fms_purchase_items where name='Barcode Label';
  select id into it_filter from public.fms_purchase_items where name='Cartridge Filter';
  select id into v_acme      from public.fms_purchase_vendors where name='Acme Chemicals Pvt Ltd';
  select id into v_bluepack  from public.fms_purchase_vendors where name='BluePack Industries';
  select id into v_filterpro from public.fms_purchase_vendors where name='FilterPro Supplies';

  if c_ent is null or it_ace is null or v_acme is null then
    raise exception 'Run fms_purchase_demo_seed.sql (masters) before the persona seed';
  end if;

  -- ---- step owners: one persona per step (approval handled by the matrix) -----
  insert into public.fms_purchase_step_owners (step_key, employee_ids) values
    ('request',          array[p_request]),
    ('sourcing',         array[p_source]),
    ('po',               array[p_po]),
    ('share_po',         array[p_share]),
    ('collect_pi',       array[p_pi]),
    ('advance_payment',  array[p_adv]),
    ('follow_up',        array[p_follow]),
    ('inward',           array[p_inward]),
    ('tally',            array[p_tally])
  on conflict (step_key) do update set employee_ids = excluded.employee_ids, updated_at = now();

  -- ---- process coordinator (Control Center) -----------------------------------
  insert into public.fms_purchase_config (key, value)
  values ('process_coordinators', jsonb_build_object('user_ids', to_jsonb(array[p_coord])))
  on conflict (key) do update set value = excluded.value;

  -- ======================= per-stage in-flight items ==========================

  -- SOURCING (Rohan) — awaiting quotations. Also the hero item for the walk.
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id, note)
  values ('PR-PDEMO-01', c_ent, cat_raw, p_request, 'Solvent top-up for line 2 (demo)') returning id into r;
  insert into public.fms_purchase_request_items (request_id, item_id, quantity, unit, status)
  values (r, it_ace, 50, 'LTR', 'sourcing');
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_source, 'submitted', 'request', r, 'raised a request — awaiting sourcing quotes', p_request);

  -- APPROVAL (Yash, matrix L1 ≈ ₹14,160) — 3 quotes.
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-02', c_ent, cat_raw, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status)
  values (r, it_ipa, 100, 'KGS', v_acme, 100, 120, 18, round(100*120*1.18,2), 'approval') returning id into l;
  insert into public.fms_purchase_quotations (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended) values
    (l, v_acme, 120, 18, 5, true), (l, v_bluepack, 128, 18, 4, false), (l, v_filterpro, 124, 18, 7, false);
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (v_l1, 'sourced', 'line', l, 'sourced a line — needs your approval', p_source);

  -- APPROVED, in the PO pool (Jyoti).
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-03', c_otec, cat_raw, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_red, 200, 'KGS', v_acme, 200, 400, 18, round(200*400*1.18,2), 'approved_pending_po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_po, 'approved', 'line', l, 'approved a line — ready to generate a PO', v_l1);

  -- SHARE PO (Neha).
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-04', c_otec, cat_pack, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_carton, 1000, 'PCS', v_bluepack, 1000, 25, 12, round(1000*25*1.12,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by)
  values ('PO-PDEMO-01', v_bluepack, c_otec, 'generated', 'share_po', round(1000*25*1.12,2), 0, p_po) returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 1000, 25, 12, round(1000*25*1.12,2), 0);
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_share, 'po_generated', 'po', po, 'generated a PO — share it with the vendor', p_po);

  -- COLLECT PI (Bushra) — shared PO, no PI yet.
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-05', c_ent, cat_pack, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_label, 2000, 'PCS', v_bluepack, 2000, 3, 18, round(2000*3*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by, tally_po_no)
  values ('PO-PDEMO-02', v_bluepack, c_ent, 'shared', 'collect_pi', round(2000*3*1.18,2), 0, p_po, 'TPO-PDEMO-02') returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 2000, 3, 18, round(2000*3*1.18,2), 0);
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_pi, 'po_shared', 'po', po, 'shared a PO — collect the vendor PI', p_share);

  -- ADVANCE (Manisha) — PI with advance terms, nothing paid.
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-06', c_otec, cat_raw, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_blue, 300, 'KGS', v_acme, 300, 600, 18, round(300*600*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by, tally_po_no)
  values ('PO-PDEMO-03', v_acme, c_otec, 'shared', 'advance_payment', round(300*600*1.18,2), 0, p_po, 'TPO-PDEMO-03') returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 300, 600, 18, round(300*600*1.18,2), 0) returning id into poi;
  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, status, dispatch_status, created_by)
  values (po, 'ACME/PI/5521', 'partial_advance', round(300*600*1.18,2), current_date + 4, 'open', 'pending', p_pi) returning id into pi;
  insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty) values (pi, poi, 300);
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_adv, 'pi_added', 'po', po, 'added a PI with advance terms — release the advance', p_pi);

  -- FOLLOW-UP (Ravina) — PI on delivery terms, advance not required, awaiting dispatch.
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-07', c_ent, cat_raw, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_ipa, 150, 'KGS', v_acme, 150, 118, 18, round(150*118*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by, tally_po_no)
  values ('PO-PDEMO-04', v_acme, c_ent, 'shared', 'follow_up', round(150*118*1.18,2), 0, p_po, 'TPO-PDEMO-04') returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 150, 118, 18, round(150*118*1.18,2), 0) returning id into poi;
  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, status, dispatch_status, created_by)
  values (po, 'ACME/PI/5540', 'on_delivery', round(150*118*1.18,2), current_date + 2, 'open', 'pending', p_pi) returning id into pi;
  insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty) values (pi, poi, 150);
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_follow, 'pi_added', 'po', po, 'a PI is awaiting dispatch — follow up with the vendor', p_pi);

  -- INWARD (Vishal) — dispatched, partial receipt (40 of 200).
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-08', c_ent, cat_raw, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_ace, 200, 'LTR', v_acme, 200, 90, 18, round(200*90*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by, tally_po_no)
  values ('PO-PDEMO-05', v_acme, c_ent, 'receiving', 'inward', round(200*90*1.18,2), 4000, p_po, 'TPO-PDEMO-05') returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 200, 90, 18, round(200*90*1.18,2), 40) returning id into poi;
  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, status, dispatch_status, actual_dispatch_date, lr_no, transport_details, created_by)
  values (po, 'ACME/PI/5560', 'partial_advance', round(200*90*1.18,2), current_date - 3, 'partially_received', 'dispatched', current_date - 2, 'LR-55120', 'VRL Logistics', p_pi) returning id into pi;
  insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty) values (pi, poi, 200);
  insert into public.fms_purchase_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, created_by)
  values (po, pi, 'advance', 4000, current_date - 2, 'UTR-ADV-5560', p_adv);
  insert into public.fms_purchase_grns (po_id, pi_id, gate_register_no, condition, note, received_by)
  values (po, pi, 'GATE-5560', 'good', 'Partial receipt — 40 of 200', p_inward) returning id into grn;
  insert into public.fms_purchase_grn_items (grn_id, po_item_id, received_qty, condition) values (grn, poi, 40, 'good');
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_inward, 'dispatched', 'po', po, 'goods dispatched — record the GRN on arrival', p_follow);

  -- TALLY (Jayshree) — fully received, awaiting Tally booking.
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-09', c_colorix, cat_cons, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_filter, 80, 'PCS', v_filterpro, 80, 200, 18, round(80*200*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by, tally_po_no)
  values ('PO-PDEMO-06', v_filterpro, c_colorix, 'receiving', 'tally', round(80*200*1.18,2), 0, p_po, 'TPO-PDEMO-06') returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 80, 200, 18, round(80*200*1.18,2), 80) returning id into poi;
  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, status, dispatch_status, actual_dispatch_date, lr_no, created_by)
  values (po, 'FP/PI/6001', 'credit', round(80*200*1.18,2), current_date - 6, 'received', 'dispatched', current_date - 5, 'LR-6001', p_pi) returning id into pi;
  insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty) values (pi, poi, 80);
  insert into public.fms_purchase_grns (po_id, pi_id, gate_register_no, condition, received_by)
  values (po, pi, 'GATE-6001', 'good', p_inward) returning id into grn;
  insert into public.fms_purchase_grn_items (grn_id, po_item_id, received_qty, condition) values (grn, poi, 80, 'good');
  insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  values (p_tally, 'grn_recorded', 'po', po, 'goods fully received — book the invoice in Tally', p_inward);

  -- FINAL PAY (Yash Joshi) — received + Tally booked, balance to settle.
  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id)
  values ('PR-PDEMO-10', c_colorix, cat_cons, p_request) returning id into r;
  insert into public.fms_purchase_request_items
    (request_id, item_id, quantity, unit, final_vendor_id, final_qty, final_rate, gst_pct, line_value, status, approver_id, approval_tier)
  values (r, it_filter, 120, 'PCS', v_filterpro, 120, 210, 18, round(120*210*1.18,2), 'po', v_l1, 'L1 — Purchase Head') returning id into l;
  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, status, current_stage, total_value, advance_paid, created_by, tally_po_no)
  values ('PO-PDEMO-07', v_filterpro, c_colorix, 'receiving', 'closed', round(120*210*1.18,2), 8000, p_po, 'TPO-PDEMO-07') returning id into po;
  insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, received_qty)
  values (po, l, 120, 210, 18, round(120*210*1.18,2), 120) returning id into poi;
  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, status, dispatch_status, actual_dispatch_date, lr_no, created_by)
  values (po, 'FP/PI/6020', 'partial_advance', round(120*210*1.18,2), current_date - 8, 'received', 'dispatched', current_date - 7, 'LR-6020', p_pi) returning id into pi;
  insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty) values (pi, poi, 120);
  insert into public.fms_purchase_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, created_by)
  values (po, pi, 'advance', 8000, current_date - 6, 'UTR-ADV-6020', p_adv);
  insert into public.fms_purchase_grns (po_id, pi_id, gate_register_no, condition, received_by)
  values (po, pi, 'GATE-6020', 'good', p_inward) returning id into grn;
  insert into public.fms_purchase_grn_items (grn_id, po_item_id, received_qty, condition) values (grn, poi, 120, 'good');
  insert into public.fms_purchase_tally_bookings (po_id, grn_id, tally_pi_no, booked_by) values (po, grn, 'TLY/PDEMO/6020', p_tally);
  -- Tally is the last step: booking the invoice closes the PO, so there is no
  -- downstream owner to notify.
end $$;
