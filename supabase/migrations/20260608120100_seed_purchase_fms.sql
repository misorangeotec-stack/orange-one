-- FMS — seed the Purchase FMS workflow into the generic engine.
--
-- This is the "add an FMS = insert config rows, not tables" pattern in action:
-- one fms_workflows row + its 9 fms_workflow_steps + their fms_step_fields, plus
-- the category option set and the shared designation master. A second/third FMS
-- later is just another file like this — no schema change.
--
-- Source of truth (kept 1:1 with these): the Phase-1 front-end config —
--   frontend/src/apps/purchase-fms/config/stages.ts       (PURCHASE_STAGES)
--   frontend/src/apps/purchase-fms/config/categories.ts   (SEED_CATEGORIES)
--   frontend/src/apps/purchase-fms/mock/seed.ts           (SEED_DESIGNATIONS, owner names)
--
-- step_index is 0-based (origin step = 0), matching the engine + the mock.
-- owner_employee_ids are left empty here — an admin assigns live directory ids in
-- Settings -> Workflow Setup (Phase 3); owner_employee_names is the sheet-name
-- display fallback until then.
--
-- Idempotent: every insert uses `on conflict do nothing` on the table's natural
-- unique key, so re-running is safe. Purely ADDITIVE. Apply AFTER
-- `*_add_fms_engine.sql` in the identity Supabase project (ref coshondiqdhorwvibrwu).

-- ---------------------------------------------------------------------------
-- Designations (shared master) — from SEED_DESIGNATIONS.
-- ---------------------------------------------------------------------------
insert into public.designations (name, sort_order)
values
  ('Purchase Manager', 0),
  ('Purchase Executive', 1),
  ('ERP Executive', 2),
  ('Accounts Executive', 3),
  ('Accounts Manager', 4),
  ('Store / Gate Keeper', 5)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- The Purchase FMS workflow.
-- ---------------------------------------------------------------------------
insert into public.fms_workflows (key, name, description, sort_order)
values ('purchase', 'Purchase FMS', 'Enterprise Purchase procurement pipeline (9 stages).', 0)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The 9 workflow steps (0-based). what/how/when_text mirror config/stages.ts.
-- ---------------------------------------------------------------------------
insert into public.fms_workflow_steps
  (workflow_id, step_index, key, title, short, what, how, when_text, is_origin, owner_employee_names)
select w.id, v.step_index, v.key, v.title, v.short, v.what, v.how, v.when_text, v.is_origin, v.owner_names
from public.fms_workflows w,
  (values
    (0, 'generate_order', 'Generate Order', 'Order',
     'Raise a purchase requirement: pick the category, name the item, set the quantity.',
     'Entered directly here (was: the sheet).',
     'Whenever needed', true,
     array['Manisha Rane', 'Bharat Singh']),
    (1, 'approval', 'Approval — Purchase Dept', 'Approval',
     'Approve the order, then capture the vendor, final quantity and final rate.',
     'Approve here.',
     '+24 working hrs after the previous step', false,
     array['Hemant Sir', 'Rohan Jariwala']),
    (2, 'po_generation', 'Generate PO in System', 'PO Gen',
     'Generate the PO in the ERP and share it back to the purchase department.',
     'Via mail (sent to Rohan, who forwards to the supplier).',
     '+24 working hrs after the previous step', false,
     array['Jyoti']),
    (3, 'share_po', 'Share PO to Vendor & Collect PI', 'Share PO',
     'Share the PO with the vendor, collect the PI, and capture commercial terms.',
     'Via mail & sheet.',
     '+24 working hrs after the previous step', false,
     array['Rohan Jariwala']),
    (4, 'advance_payment', 'Advance Payment — Accounts', 'Adv. Pay',
     'Release the advance payment per the agreed payment terms.',
     'Via mail & sheet.',
     '+24 working hrs (driven by payment terms)', false,
     array['Ravina Madam']),
    (5, 'follow_up', 'Follow Up with Vendor', 'Follow Up',
     'Follow up for dispatch; capture transport / LR details and the actual dispatch.',
     'Based on the expected material-receipt delay.',
     'Day before the vendor''s dispatch date', false,
     array['Rohan Jariwala']),
    (6, 'inward_entry', 'Inward (Gate) Entry', 'Inward',
     'Record gate entry when material reaches the factory and check condition.',
     'As per the Material Receiving Checklist register.',
     '+24 working hrs after dispatch', false,
     array['Bharat Singh']),
    (7, 'system_entry', 'System Entry (Tally)', 'Tally',
     'Book the purchase entry in Tally and record the Tally PI number.',
     'Purchase entry in Tally.',
     '+24 working hrs after inward entry', false,
     array['Bharat Kale']),
    (8, 'final_payment', 'Final Payment', 'Final Pay',
     'Settle the pending amount on the payment due date.',
     'Update once done.',
     'On the payment due date', false,
     array['Ravina Madam'])
  ) as v(step_index, key, title, short, what, how, when_text, is_origin, owner_names)
where w.key = 'purchase'
on conflict (workflow_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- The field schema per step. type=select carries inline `options`; the
-- generate_order.category field binds to the dynamic 'category' option set.
-- sort_order = position within the stage's fields[] array.
-- ---------------------------------------------------------------------------
insert into public.fms_step_fields
  (step_id, key, label, type, options, option_set, required, half, sort_order)
select s.id, f.key, f.label, f.type, f.options::jsonb, f.option_set, f.required, f.half, f.sort_order
from (values
    -- 0 generate_order
    ('generate_order', 'category', 'Category', 'text', null, 'category', false, false, 0),
    ('generate_order', 'itemName', 'Item Name', 'text', null, null, false, false, 1),
    ('generate_order', 'quantity', 'Quantity', 'number', null, null, false, true, 2),
    ('generate_order', 'unit', 'Unit', 'text', null, null, false, true, 3),
    ('generate_order', 'remarks', 'Remarks', 'textarea', null, null, false, false, 4),
    -- 1 approval
    ('approval', 'status', 'Approval Status', 'select', '["Approved","Rejected","On Hold"]', null, true, true, 0),
    ('approval', 'vendorName', 'Vendor Name', 'text', null, null, false, true, 1),
    ('approval', 'finalQty', 'Final Qty', 'number', null, null, false, true, 2),
    ('approval', 'finalRate', 'Final Rate', 'number', null, null, false, true, 3),
    ('approval', 'purchaseRemarks', 'Remarks (Purchase Dept.)', 'textarea', null, null, false, false, 4),
    -- 2 po_generation
    ('po_generation', 'status', 'PO Status', 'select', '["Done","Pending","On Hold"]', null, true, true, 0),
    ('po_generation', 'systemPoNo', 'System-generated PO No.', 'text', null, null, false, true, 1),
    ('po_generation', 'poRemarks', 'Remarks (if any in PO)', 'textarea', null, null, false, false, 2),
    -- 3 share_po
    ('share_po', 'status', 'PO Shared Status', 'select', '["Done","Pending","On Hold"]', null, true, true, 0),
    ('share_po', 'vendorPiNo', 'Vendor PI No.', 'text', null, null, false, true, 1),
    ('share_po', 'materialDispatchDate', 'Material Dispatch Date (from vendor)', 'date', null, null, false, true, 2),
    ('share_po', 'paymentTerms', 'Payment Terms', 'select', '["Advance","Credit","Partial Advance","On Delivery"]', null, false, true, 3),
    ('share_po', 'totalGstValue', 'Total PO Value (incl. GST)', 'number', null, null, false, true, 4),
    ('share_po', 'sharedRemarks', 'Remarks (if any)', 'textarea', null, null, false, false, 5),
    -- 4 advance_payment
    ('advance_payment', 'status', 'Advance Payment Status', 'select', '["Done","Pending","On Hold"]', null, true, true, 0),
    ('advance_payment', 'advRemarks', 'Remarks (if any)', 'textarea', null, null, false, false, 1),
    -- 5 follow_up
    ('follow_up', 'status', 'Dispatch Status', 'select', '["Dispatched","Pending","Delayed"]', null, true, true, 0),
    ('follow_up', 'dispatchLr', 'Dispatch Details (LR No.)', 'text', null, null, false, true, 1),
    ('follow_up', 'transportDetails', 'Transport Details', 'text', null, null, false, false, 2),
    ('follow_up', 'followUpRemarks', 'Remarks (in follow-up)', 'textarea', null, null, false, false, 3),
    -- 6 inward_entry
    ('inward_entry', 'status', 'Inward Status', 'select', '["Received","Partial","Pending"]', null, true, true, 0),
    ('inward_entry', 'gateRegisterNo', 'Gate Register Entry No.', 'text', null, null, false, true, 1),
    ('inward_entry', 'receivedQty', 'Received Qty', 'number', null, null, false, true, 2),
    ('inward_entry', 'receivedCondition', 'Received Material Condition', 'select', '["Good","Damaged","Partial Damage"]', null, false, true, 3),
    ('inward_entry', 'remarks', 'Remarks (if any)', 'textarea', null, null, false, false, 4),
    -- 7 system_entry
    ('system_entry', 'status', 'System Status', 'select', '["Done","Pending","On Hold"]', null, true, true, 0),
    ('system_entry', 'tallyPiNo', 'Tally PI No.', 'text', null, null, false, true, 1),
    ('system_entry', 'systemRemarks', 'Remarks (system entry)', 'textarea', null, null, false, false, 2),
    -- 8 final_payment
    ('final_payment', 'dueDate', 'Due Date of Final Payment', 'date', null, null, false, true, 0),
    ('final_payment', 'pendingAmount', 'Pending Amount for Payment', 'number', null, null, false, true, 1),
    ('final_payment', 'datePaid', 'Date Pending Amount Paid', 'date', null, null, false, true, 2)
  ) as f(step_key, key, label, type, options, option_set, required, half, sort_order)
join public.fms_workflow_steps s on s.key = f.step_key
join public.fms_workflows w on w.id = s.workflow_id and w.key = 'purchase'
on conflict (step_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- The 'category' option set (category -> unit), from SEED_CATEGORIES.
-- ---------------------------------------------------------------------------
insert into public.fms_field_options (workflow_id, option_set, label, meta, sort_order)
select w.id, v.option_set, v.label, v.meta::jsonb, v.sort_order
from public.fms_workflows w,
  (values
    ('category', 'RAW MATERIAL',     '{"unit":"KGS"}', 0),
    ('category', 'PACKING MATERIAL', '{"unit":"PCS"}', 1),
    ('category', 'CARTRIDGE/FILTER', '{"unit":"PCS"}', 2)
  ) as v(option_set, label, meta, sort_order)
where w.key = 'purchase'
on conflict (workflow_id, option_set, label) do nothing;
