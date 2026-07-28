-- ===========================================================================
-- QC INSPECTION — WHOLE-ITEM APPROVE / REJECT (both purchase FMS apps).
--
-- The inspection used to be captured as a rejected QUANTITY per line, which made
-- "approved" the silent default: an untouched grid of zeroes saved as a clean
-- pass, whether or not anybody had actually looked at the material.
--
-- The decision is now whole-item and explicit:
--   • every QC-required line of the receipt must carry a verdict — a payload
--     that skips a line is refused, so nothing is approved by omission;
--   • a rejected line goes back IN FULL (rejected_qty = received_qty), so a
--     partial rejection is no longer expressible;
--   • a rejected line must say why — the remark is mandatory.
--
-- Storage is UNCHANGED: `rejected_qty` still carries the verdict (0 = approved,
-- = received_qty = rejected), so the purchase-return and gate-outward steps,
-- `rejectedItemsFor` and every queue column read exactly what they always did,
-- and existing inspections keep their meaning. Only the four record/update RPCs
-- are replaced; no table, column or row is touched.
--
-- The item payload accepts BOTH shapes so it is correct either side of this
-- migration landing: `rejected` (boolean, authoritative) with the legacy
-- `rejected_qty > 0` as the fallback when the flag is absent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. RM DOMESTIC PURCHASE — record.
--    Body carried forward from 20260731120000 with the three new rules.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_record_qc(
  p_grn_id        uuid,
  p_items         jsonb,
  p_remarks       text default null,
  p_document_path text default null,
  p_document_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_po uuid; v_id uuid; v_rejected boolean; v_po_no text; v_expected int;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('qc_inspection', auth.uid())) then
    raise exception 'Not authorized to record a QC inspection';
  end if;

  select po_id into v_po from public.fms_purchase_grns where id = p_grn_id;
  if v_po is null then raise exception 'Goods receipt not found'; end if;
  if not exists (select 1 from public.fms_purchase_tally_bookings where grn_id = p_grn_id) then
    raise exception 'Book this receipt in Tally before recording its QC inspection';
  end if;
  if exists (select 1 from public.fms_purchase_qc_inspections where grn_id = p_grn_id) then
    raise exception 'This receipt has already been inspected';
  end if;
  if not public.fms_purchase_grn_needs_qc(p_grn_id) then
    raise exception 'No QC-required items on this receipt';
  end if;

  insert into public.fms_purchase_qc_inspections
    (po_id, grn_id, result, remarks, document_path, document_name, inspected_by)
  values
    (v_po, p_grn_id, 'approved', nullif(trim(p_remarks),''),
     nullif(p_document_path,''), nullif(p_document_name,''), auth.uid())
  returning id into v_id;

  -- Only QC-required lines of THIS receipt are recorded; anything else the client
  -- sends is ignored rather than rejected, so a stale grid can't block the step.
  -- A rejection is stored as the WHOLE received quantity, whichever form the
  -- client used to express it.
  insert into public.fms_purchase_qc_items (inspection_id, po_item_id, received_qty, rejected_qty, remark)
  select v_id, gi.po_item_id, gi.received_qty,
         case when coalesce((x->>'rejected')::boolean,
                            coalesce(nullif(x->>'rejected_qty','')::numeric, 0) > 0)
              then gi.received_qty else 0 end,
         nullif(trim(x->>'remark'),'')
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    join public.fms_purchase_grn_items gi
      on gi.grn_id = p_grn_id and gi.po_item_id = (x->>'po_item_id')::uuid
    join public.fms_purchase_po_items poi on poi.id = gi.po_item_id
    join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
    join public.fms_purchase_categories c on c.id = ri.category_id and c.qc_required;

  -- No approval by omission: every inspected line has to carry a verdict.
  select count(*) into v_expected
    from public.fms_purchase_grn_items gi
    join public.fms_purchase_po_items poi on poi.id = gi.po_item_id
    join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
    join public.fms_purchase_categories c on c.id = ri.category_id and c.qc_required
   where gi.grn_id = p_grn_id;
  if (select count(*) from public.fms_purchase_qc_items where inspection_id = v_id) <> v_expected then
    raise exception 'Approve or reject every item on this receipt before recording the inspection';
  end if;

  if exists (select 1 from public.fms_purchase_qc_items
              where inspection_id = v_id and rejected_qty > 0 and coalesce(trim(remark),'') = '') then
    raise exception 'A rejected item needs a remark saying why it was rejected';
  end if;

  select exists(select 1 from public.fms_purchase_qc_items where inspection_id = v_id and rejected_qty > 0)
    into v_rejected;
  update public.fms_purchase_qc_inspections
     set result = case when v_rejected then 'rejected' else 'approved' end
   where id = v_id;

  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('po', v_po,
    case when v_rejected then 'qc_rejected' else 'qc_approved' end,
    format('QC inspection %s on %s',
           case when v_rejected then 'REJECTED' else 'approved' end, coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'grn_id', p_grn_id, 'inspection_id', v_id));
  return v_id;
end $$;
grant execute on function public.fms_purchase_record_qc(uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RM DOMESTIC PURCHASE — edit.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_update_qc(
  p_inspection_id uuid,
  p_items         jsonb,
  p_remarks       text default null,
  p_document_path text default null,   -- null => keep the existing QC document
  p_document_name text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_grn uuid; v_rejected boolean; v_po_no text; v_expected int;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('qc_inspection', auth.uid())) then
    raise exception 'Not authorized to edit a QC inspection';
  end if;
  select po_id, grn_id into v_po, v_grn from public.fms_purchase_qc_inspections where id = p_inspection_id for update;
  if v_po is null then raise exception 'QC inspection not found'; end if;
  if not public.fms_purchase_qc_editable(p_inspection_id) then
    raise exception 'The purchase return has already been entered against this inspection — it can no longer be edited.';
  end if;

  delete from public.fms_purchase_qc_items where inspection_id = p_inspection_id;
  insert into public.fms_purchase_qc_items (inspection_id, po_item_id, received_qty, rejected_qty, remark)
  select p_inspection_id, gi.po_item_id, gi.received_qty,
         case when coalesce((x->>'rejected')::boolean,
                            coalesce(nullif(x->>'rejected_qty','')::numeric, 0) > 0)
              then gi.received_qty else 0 end,
         nullif(trim(x->>'remark'),'')
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    join public.fms_purchase_grn_items gi
      on gi.grn_id = v_grn and gi.po_item_id = (x->>'po_item_id')::uuid
    join public.fms_purchase_po_items poi on poi.id = gi.po_item_id
    join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
    join public.fms_purchase_categories c on c.id = ri.category_id and c.qc_required;

  select count(*) into v_expected
    from public.fms_purchase_grn_items gi
    join public.fms_purchase_po_items poi on poi.id = gi.po_item_id
    join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
    join public.fms_purchase_categories c on c.id = ri.category_id and c.qc_required
   where gi.grn_id = v_grn;
  if (select count(*) from public.fms_purchase_qc_items where inspection_id = p_inspection_id) <> v_expected then
    raise exception 'Approve or reject every item on this receipt before saving the inspection';
  end if;

  if exists (select 1 from public.fms_purchase_qc_items
              where inspection_id = p_inspection_id and rejected_qty > 0 and coalesce(trim(remark),'') = '') then
    raise exception 'A rejected item needs a remark saying why it was rejected';
  end if;

  select exists(select 1 from public.fms_purchase_qc_items where inspection_id = p_inspection_id and rejected_qty > 0)
    into v_rejected;
  update public.fms_purchase_qc_inspections
     set result        = case when v_rejected then 'rejected' else 'approved' end,
         remarks       = nullif(trim(p_remarks),''),
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_inspection_id;

  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('po', v_po, 'qc_edited',
    format('QC inspection on %s edited', coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'inspection_id', p_inspection_id));
end $$;
grant execute on function public.fms_purchase_update_qc(uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. IMPORT PURCHASE — record. Same three rules, same shape.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_record_qc(
  p_grn_id        uuid,
  p_items         jsonb,
  p_remarks       text default null,
  p_document_path text default null,
  p_document_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_po uuid; v_id uuid; v_rejected boolean; v_po_no text; v_expected int;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('qc_inspection', auth.uid())) then
    raise exception 'Not authorized to record a QC inspection';
  end if;

  select po_id into v_po from public.fms_import_grns where id = p_grn_id;
  if v_po is null then raise exception 'Goods receipt not found'; end if;
  if not exists (select 1 from public.fms_import_tally_bookings where grn_id = p_grn_id) then
    raise exception 'Book this receipt in Tally before recording its QC inspection';
  end if;
  if exists (select 1 from public.fms_import_qc_inspections where grn_id = p_grn_id) then
    raise exception 'This receipt has already been inspected';
  end if;
  if not public.fms_import_grn_needs_qc(p_grn_id) then
    raise exception 'No QC-required items on this receipt';
  end if;

  insert into public.fms_import_qc_inspections
    (po_id, grn_id, result, remarks, document_path, document_name, inspected_by)
  values
    (v_po, p_grn_id, 'approved', nullif(trim(p_remarks),''),
     nullif(p_document_path,''), nullif(p_document_name,''), auth.uid())
  returning id into v_id;

  insert into public.fms_import_qc_items (inspection_id, po_item_id, received_qty, rejected_qty, remark)
  select v_id, gi.po_item_id, gi.received_qty,
         case when coalesce((x->>'rejected')::boolean,
                            coalesce(nullif(x->>'rejected_qty','')::numeric, 0) > 0)
              then gi.received_qty else 0 end,
         nullif(trim(x->>'remark'),'')
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    join public.fms_import_grn_items gi
      on gi.grn_id = p_grn_id and gi.po_item_id = (x->>'po_item_id')::uuid
    join public.fms_import_po_items poi on poi.id = gi.po_item_id
    join public.fms_import_request_items ri on ri.id = poi.request_item_id
    join public.fms_import_categories c on c.id = ri.category_id and c.qc_required;

  select count(*) into v_expected
    from public.fms_import_grn_items gi
    join public.fms_import_po_items poi on poi.id = gi.po_item_id
    join public.fms_import_request_items ri on ri.id = poi.request_item_id
    join public.fms_import_categories c on c.id = ri.category_id and c.qc_required
   where gi.grn_id = p_grn_id;
  if (select count(*) from public.fms_import_qc_items where inspection_id = v_id) <> v_expected then
    raise exception 'Approve or reject every item on this receipt before recording the inspection';
  end if;

  if exists (select 1 from public.fms_import_qc_items
              where inspection_id = v_id and rejected_qty > 0 and coalesce(trim(remark),'') = '') then
    raise exception 'A rejected item needs a remark saying why it was rejected';
  end if;

  select exists(select 1 from public.fms_import_qc_items where inspection_id = v_id and rejected_qty > 0)
    into v_rejected;
  update public.fms_import_qc_inspections
     set result = case when v_rejected then 'rejected' else 'approved' end
   where id = v_id;

  perform public.fms_import_refresh_po(v_po);
  select po_no into v_po_no from public.fms_import_pos where id = v_po;
  perform public.fms_import_announce('po', v_po,
    case when v_rejected then 'qc_rejected' else 'qc_approved' end,
    format('QC inspection %s on %s',
           case when v_rejected then 'REJECTED' else 'approved' end, coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'grn_id', p_grn_id, 'inspection_id', v_id));
  return v_id;
end $$;
grant execute on function public.fms_import_record_qc(uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. IMPORT PURCHASE — edit.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_update_qc(
  p_inspection_id uuid,
  p_items         jsonb,
  p_remarks       text default null,
  p_document_path text default null,   -- null => keep the existing QC document
  p_document_name text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_grn uuid; v_rejected boolean; v_po_no text; v_expected int;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('qc_inspection', auth.uid())) then
    raise exception 'Not authorized to edit a QC inspection';
  end if;
  select po_id, grn_id into v_po, v_grn from public.fms_import_qc_inspections where id = p_inspection_id for update;
  if v_po is null then raise exception 'QC inspection not found'; end if;
  if not public.fms_import_qc_editable(p_inspection_id) then
    raise exception 'The purchase return has already been entered against this inspection — it can no longer be edited.';
  end if;

  delete from public.fms_import_qc_items where inspection_id = p_inspection_id;
  insert into public.fms_import_qc_items (inspection_id, po_item_id, received_qty, rejected_qty, remark)
  select p_inspection_id, gi.po_item_id, gi.received_qty,
         case when coalesce((x->>'rejected')::boolean,
                            coalesce(nullif(x->>'rejected_qty','')::numeric, 0) > 0)
              then gi.received_qty else 0 end,
         nullif(trim(x->>'remark'),'')
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    join public.fms_import_grn_items gi
      on gi.grn_id = v_grn and gi.po_item_id = (x->>'po_item_id')::uuid
    join public.fms_import_po_items poi on poi.id = gi.po_item_id
    join public.fms_import_request_items ri on ri.id = poi.request_item_id
    join public.fms_import_categories c on c.id = ri.category_id and c.qc_required;

  select count(*) into v_expected
    from public.fms_import_grn_items gi
    join public.fms_import_po_items poi on poi.id = gi.po_item_id
    join public.fms_import_request_items ri on ri.id = poi.request_item_id
    join public.fms_import_categories c on c.id = ri.category_id and c.qc_required
   where gi.grn_id = v_grn;
  if (select count(*) from public.fms_import_qc_items where inspection_id = p_inspection_id) <> v_expected then
    raise exception 'Approve or reject every item on this receipt before saving the inspection';
  end if;

  if exists (select 1 from public.fms_import_qc_items
              where inspection_id = p_inspection_id and rejected_qty > 0 and coalesce(trim(remark),'') = '') then
    raise exception 'A rejected item needs a remark saying why it was rejected';
  end if;

  select exists(select 1 from public.fms_import_qc_items where inspection_id = p_inspection_id and rejected_qty > 0)
    into v_rejected;
  update public.fms_import_qc_inspections
     set result        = case when v_rejected then 'rejected' else 'approved' end,
         remarks       = nullif(trim(p_remarks),''),
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_inspection_id;

  perform public.fms_import_refresh_po(v_po);
  select po_no into v_po_no from public.fms_import_pos where id = v_po;
  perform public.fms_import_announce('po', v_po, 'qc_edited',
    format('QC inspection on %s edited', coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'inspection_id', p_inspection_id));
end $$;
grant execute on function public.fms_import_update_qc(uuid, jsonb, text, text, text) to authenticated;
