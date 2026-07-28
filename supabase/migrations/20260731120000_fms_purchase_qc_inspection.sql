-- ===========================================================================
-- RM DOMESTIC PURCHASE FMS — QC INSPECTION (step 11) + the rejection branch.
--
--   … → Inward (GRN) → System Entry (Tally) → QC Inspection
--                                                ├── APPROVE → Process Closed
--                                                └── REJECT  → Purchase Return
--                                                              Entry in Tally (12)
--                                                            → Gate Register
--                                                              Outward (13)
--                                                            → Process Closed
--
-- QC attaches to a goods receipt (GRN), because the Tally step already books ONE
-- invoice per GRN and a PO legitimately cycles inward → tally → inward → tally on
-- partial consignments. Within an inspection the decision is ITEM-WISE: each line
-- carries its own rejected quantity, and only the rejected items flow into the
-- purchase return.
--
-- QC is OPT-IN PER CATEGORY (`fms_purchase_categories.qc_required`), seeded true
-- for RAW MATERIAL only. Every other kind of purchase — Ink, Head, Machine, Spare
-- Parts, Packing Material, Cartridge/Filter — is untouched: Tally stays its last
-- step and the PO closes exactly as it does today.
--
-- Additive throughout: two new tables, one new column on the categories master,
-- one grandfathering column on GRNs, and create-or-replace on refresh_po /
-- tally_editable.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CATEGORY GATE. `default false` is what makes this safe — every existing
--    and future category is opt-in, so nothing outside Raw Material changes.
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_categories
  add column if not exists qc_required boolean not null default false;

comment on column public.fms_purchase_categories.qc_required is
  'When true, a goods receipt containing this category must pass QC Inspection after its Tally entry before the PO can close. Seeded true for RAW MATERIAL only; everything else ends at Tally.';

update public.fms_purchase_categories set qc_required = true where upper(name) = 'RAW MATERIAL';

-- ---------------------------------------------------------------------------
-- 2. GRANDFATHERING. Receipts that already exist predate the QC step; pulling
--    them back out of `closed` on the next unrelated write would be a nasty
--    surprise. Stamp them waived once, here.
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_grns
  add column if not exists qc_waived_at timestamptz;

comment on column public.fms_purchase_grns.qc_waived_at is
  'Set on receipts that predate the QC Inspection step (stamped once by the QC migration). A waived receipt never raises a QC work-item.';

update public.fms_purchase_grns set qc_waived_at = now() where qc_waived_at is null;

-- ---------------------------------------------------------------------------
-- 3. THE INSPECTION — one row per inspected receipt.
--
--    QC repeats (per GRN) so it earns its own table. The return entry and the
--    gate outward are exactly ONE per rejected inspection, so they live here as
--    columns — the same "repeating step gets a child table, one-shot step gets
--    columns" split the rest of this app uses.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_purchase_qc_inspections (
  id      uuid primary key default gen_random_uuid(),
  po_id   uuid not null references public.fms_purchase_pos on delete cascade,
  grn_id  uuid not null references public.fms_purchase_grns on delete cascade,
  -- Derived server-side from the item rows; never trusted from the client.
  result  text not null check (result in ('approved','rejected')),

  -- Step 11 — QC Inspection.
  remarks        text,
  document_path  text,
  document_name  text,
  inspected_at   timestamptz not null default now(),
  inspected_by   uuid references auth.users on delete set null,
  edited_at      timestamptz,
  edited_by      uuid references auth.users on delete set null,

  -- Step 12 — Purchase Return Entry in Tally (rejected inspections only).
  return_tally_ref  text,
  return_remarks    text,
  return_doc_path   text,
  return_doc_name   text,
  returned_at       timestamptz,
  returned_by       uuid references auth.users on delete set null,
  return_edited_at  timestamptz,
  return_edited_by  uuid references auth.users on delete set null,

  -- Step 13 — Gate Register Outward.
  gate_register_no  text,
  gate_out_date     date,
  gate_remarks      text,
  gate_doc_path     text,
  gate_doc_name     text,
  gate_out_at       timestamptz,
  gate_out_by       uuid references auth.users on delete set null,
  gate_edited_at    timestamptz,
  gate_edited_by    uuid references auth.users on delete set null,

  created_at timestamptz not null default now()
);
create unique index if not exists fms_purchase_qc_grn_uniq on public.fms_purchase_qc_inspections (grn_id);
create index if not exists fms_purchase_qc_po_idx on public.fms_purchase_qc_inspections (po_id);

-- The item-wise decision. `received_qty` is a SNAPSHOT of what this receipt
-- delivered for the line — po_items.received_qty is the rollup across every GRN
-- and is therefore the wrong number to cap against.
create table if not exists public.fms_purchase_qc_items (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.fms_purchase_qc_inspections on delete cascade,
  po_item_id    uuid not null references public.fms_purchase_po_items on delete cascade,
  received_qty  numeric(14,3) not null,
  rejected_qty  numeric(14,3) not null default 0 check (rejected_qty >= 0),
  remark        text,
  created_at    timestamptz not null default now(),
  unique (inspection_id, po_item_id)
);
create index if not exists fms_purchase_qc_items_inspection_idx on public.fms_purchase_qc_items (inspection_id);

-- RLS — select-all; direct writes admin-only (the RPCs below are definer).
do $$
declare t text;
begin
  foreach t in array array['fms_purchase_qc_inspections','fms_purchase_qc_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_write_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t||'_write_admin', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. DOES THIS RECEIPT NEED QC? Walks grn_item → po_item → request_item →
--    category. A receipt with no qc_required line never raises a work-item.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_grn_needs_qc(p_grn_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.fms_purchase_grn_items gi
      join public.fms_purchase_po_items poi on poi.id = gi.po_item_id
      join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
      join public.fms_purchase_categories c on c.id = ri.category_id
     where gi.grn_id = p_grn_id
       and c.qc_required
  );
$$;
grant execute on function public.fms_purchase_grn_needs_qc(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. STEP 11 — RECORD QC.
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
  v_po uuid; v_id uuid; v_rejected boolean; v_po_no text;
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
  insert into public.fms_purchase_qc_items (inspection_id, po_item_id, received_qty, rejected_qty, remark)
  select v_id, gi.po_item_id, gi.received_qty,
         coalesce(nullif(x->>'rejected_qty','')::numeric, 0),
         nullif(trim(x->>'remark'),'')
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    join public.fms_purchase_grn_items gi
      on gi.grn_id = p_grn_id and gi.po_item_id = (x->>'po_item_id')::uuid
    join public.fms_purchase_po_items poi on poi.id = gi.po_item_id
    join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
    join public.fms_purchase_categories c on c.id = ri.category_id and c.qc_required;

  if exists (select 1 from public.fms_purchase_qc_items
              where inspection_id = v_id and rejected_qty > received_qty) then
    raise exception 'Rejected quantity cannot exceed the quantity received on this goods receipt';
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

-- Editable until the NEXT step captures it — i.e. until the return entry is made.
-- An approved inspection has no next step, so it stays correctable while the PO
-- lives (a closed PO is re-derivable here, see refresh_po below).
create or replace function public.fms_purchase_qc_editable(p_inspection_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_qc_inspections q
      join public.fms_purchase_pos po on po.id = q.po_id
     where q.id = p_inspection_id
       and po.current_stage <> 'cancelled'
       and q.return_tally_ref is null
  );
$$;
grant execute on function public.fms_purchase_qc_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_qc(
  p_inspection_id uuid,
  p_items         jsonb,
  p_remarks       text default null,
  p_document_path text default null,   -- null => keep the existing QC document
  p_document_name text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_grn uuid; v_rejected boolean; v_po_no text;
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
         coalesce(nullif(x->>'rejected_qty','')::numeric, 0),
         nullif(trim(x->>'remark'),'')
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    join public.fms_purchase_grn_items gi
      on gi.grn_id = v_grn and gi.po_item_id = (x->>'po_item_id')::uuid
    join public.fms_purchase_po_items poi on poi.id = gi.po_item_id
    join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
    join public.fms_purchase_categories c on c.id = ri.category_id and c.qc_required;

  if exists (select 1 from public.fms_purchase_qc_items
              where inspection_id = p_inspection_id and rejected_qty > received_qty) then
    raise exception 'Rejected quantity cannot exceed the quantity received on this goods receipt';
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
-- 6. STEP 12 — PURCHASE RETURN ENTRY IN TALLY.
--
--    The Tally reference AND the document are both MANDATORY, enforced here and
--    not just in the UI. This step has no legacy rows to grandfather, which is
--    exactly why it can be a hard server rule where the Book-in-Tally document
--    could only ever be a client-side one.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_record_purchase_return(
  p_inspection_id uuid,
  p_tally_ref     text,
  p_document_path text,
  p_document_name text,
  p_remarks       text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_result text; v_existing text; v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('purchase_return', auth.uid())) then
    raise exception 'Not authorized to record a purchase return entry';
  end if;
  select po_id, result, return_tally_ref into v_po, v_result, v_existing
    from public.fms_purchase_qc_inspections where id = p_inspection_id for update;
  if v_po is null then raise exception 'QC inspection not found'; end if;
  if v_result <> 'rejected' then raise exception 'This inspection was approved — there is nothing to return'; end if;
  if v_existing is not null then raise exception 'The purchase return has already been entered for this inspection'; end if;
  if nullif(trim(p_tally_ref),'') is null then raise exception 'The Tally reference number is required'; end if;
  if nullif(p_document_path,'') is null then raise exception 'Attach the purchase return document'; end if;

  update public.fms_purchase_qc_inspections
     set return_tally_ref = trim(p_tally_ref),
         return_remarks   = nullif(trim(p_remarks),''),
         return_doc_path  = p_document_path,
         return_doc_name  = nullif(p_document_name,''),
         returned_at      = now(),
         returned_by      = auth.uid()
   where id = p_inspection_id;

  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('po', v_po, 'purchase_return_entered',
    format('Purchase return booked in Tally for %s', coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'inspection_id', p_inspection_id, 'tally_ref', trim(p_tally_ref)));
end $$;
grant execute on function public.fms_purchase_record_purchase_return(uuid, text, text, text, text) to authenticated;

create or replace function public.fms_purchase_purchase_return_editable(p_inspection_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_qc_inspections q
      join public.fms_purchase_pos po on po.id = q.po_id
     where q.id = p_inspection_id
       and po.current_stage <> 'cancelled'
       and q.return_tally_ref is not null
       and q.gate_register_no is null
  );
$$;
grant execute on function public.fms_purchase_purchase_return_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_purchase_return(
  p_inspection_id uuid,
  p_tally_ref     text,
  p_document_path text default null,   -- null => keep the existing return document
  p_document_name text default null,
  p_remarks       text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('purchase_return', auth.uid())) then
    raise exception 'Not authorized to edit a purchase return entry';
  end if;
  select po_id into v_po from public.fms_purchase_qc_inspections where id = p_inspection_id for update;
  if v_po is null then raise exception 'QC inspection not found'; end if;
  if not public.fms_purchase_purchase_return_editable(p_inspection_id) then
    raise exception 'The gate outward has already been recorded — this return entry can no longer be edited.';
  end if;
  if nullif(trim(p_tally_ref),'') is null then raise exception 'The Tally reference number is required'; end if;

  update public.fms_purchase_qc_inspections
     set return_tally_ref  = trim(p_tally_ref),
         return_doc_path   = coalesce(nullif(p_document_path,''), return_doc_path),
         return_doc_name   = coalesce(nullif(p_document_name,''), return_doc_name),
         return_remarks    = nullif(trim(p_remarks),''),
         return_edited_at  = now(),
         return_edited_by  = auth.uid()
   where id = p_inspection_id;

  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('po', v_po, 'purchase_return_edited',
    format('Purchase return entry on %s edited', coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'inspection_id', p_inspection_id));
end $$;
grant execute on function public.fms_purchase_update_purchase_return(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. STEP 13 — GATE REGISTER OUTWARD. Closes the rejection branch.
--    The outward date may not be in the future — same rule the follow-up's actual
--    dispatch date already carries, and for the same reason: you cannot record a
--    movement that has not happened.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_record_gate_outward(
  p_inspection_id   uuid,
  p_gate_register_no text,
  p_out_date        date default null,
  p_remarks         text default null,
  p_document_path   text default null,
  p_document_name   text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_return text; v_existing text; v_date date; v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('gate_outward', auth.uid())) then
    raise exception 'Not authorized to record a gate register outward';
  end if;
  select po_id, return_tally_ref, gate_register_no into v_po, v_return, v_existing
    from public.fms_purchase_qc_inspections where id = p_inspection_id for update;
  if v_po is null then raise exception 'QC inspection not found'; end if;
  if v_return is null then raise exception 'Book the purchase return in Tally before recording the gate outward'; end if;
  if v_existing is not null then raise exception 'The gate outward has already been recorded for this inspection'; end if;
  if nullif(trim(p_gate_register_no),'') is null then raise exception 'The gate register number is required'; end if;

  v_date := coalesce(p_out_date, (now() at time zone 'Asia/Kolkata')::date);
  if v_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'The outward date cannot be in the future';
  end if;

  update public.fms_purchase_qc_inspections
     set gate_register_no = trim(p_gate_register_no),
         gate_out_date    = v_date,
         gate_remarks     = nullif(trim(p_remarks),''),
         gate_doc_path    = nullif(p_document_path,''),
         gate_doc_name    = nullif(p_document_name,''),
         gate_out_at      = now(),
         gate_out_by      = auth.uid()
   where id = p_inspection_id;

  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('po', v_po, 'gate_outward_recorded',
    format('Rejected material gated out for %s', coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'inspection_id', p_inspection_id));
end $$;
grant execute on function public.fms_purchase_record_gate_outward(uuid, text, date, text, text, text) to authenticated;

create or replace function public.fms_purchase_gate_outward_editable(p_inspection_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_qc_inspections q
      join public.fms_purchase_pos po on po.id = q.po_id
     where q.id = p_inspection_id
       and po.current_stage <> 'cancelled'
       and q.gate_register_no is not null
  );
$$;
grant execute on function public.fms_purchase_gate_outward_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_gate_outward(
  p_inspection_id    uuid,
  p_gate_register_no text,
  p_out_date         date default null,
  p_remarks          text default null,
  p_document_path    text default null,   -- null => keep the existing gate document
  p_document_name    text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_date date; v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('gate_outward', auth.uid())) then
    raise exception 'Not authorized to edit a gate register outward';
  end if;
  select po_id into v_po from public.fms_purchase_qc_inspections where id = p_inspection_id for update;
  if v_po is null then raise exception 'QC inspection not found'; end if;
  if not public.fms_purchase_gate_outward_editable(p_inspection_id) then
    raise exception 'This PO is cancelled — its gate outward can no longer be edited.';
  end if;
  if nullif(trim(p_gate_register_no),'') is null then raise exception 'The gate register number is required'; end if;

  v_date := coalesce(p_out_date, (select gate_out_date from public.fms_purchase_qc_inspections where id = p_inspection_id));
  if v_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'The outward date cannot be in the future';
  end if;

  update public.fms_purchase_qc_inspections
     set gate_register_no = trim(p_gate_register_no),
         gate_out_date    = v_date,
         gate_remarks     = nullif(trim(p_remarks),''),
         gate_doc_path    = coalesce(nullif(p_document_path,''), gate_doc_path),
         gate_doc_name    = coalesce(nullif(p_document_name,''), gate_doc_name),
         gate_edited_at   = now(),
         gate_edited_by   = auth.uid()
   where id = p_inspection_id;

  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('po', v_po, 'gate_outward_edited',
    format('Gate register outward on %s edited', coalesce(v_po_no,'the PO')),
    '{}'::uuid[], jsonb_build_object('po_id', v_po, 'inspection_id', p_inspection_id));
end $$;
grant execute on function public.fms_purchase_update_gate_outward(uuid, text, date, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. LOCK THE TALLY BOOKING ONCE QC HAS CAPTURED IT.
--    `fms_purchase_tally_editable` gated only on "is the PO open". A PO now stays
--    open THROUGH QC, so without this a booking would silently remain editable
--    after the inspection — breaking the app-wide "editable until the next step
--    captures it" rule. Body carried forward from 20260718130000 with the extra
--    clause. (`fms_purchase_grn_editable` needs no change: it is already locked
--    by the existence of the Tally booking, which always precedes QC.)
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_tally_editable(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_tally_bookings t
     where t.id = p_booking_id
       and public.fms_purchase_po_open(t.po_id)
       and not exists (select 1 from public.fms_purchase_qc_inspections q where q.grn_id = t.grn_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. THE STAGE MACHINE. Body carried forward verbatim from 20260715120000 with
--    three changes:
--
--    (a) Only 'cancelled' is absorbing now. 'closed' is DERIVED, so it must stay
--        re-derivable: a domestic PO closes on fully-received + fully-paid, which
--        can happen before its Tally entry, and such a PO must still be able to
--        walk into QC when the booking lands. This is exactly what
--        fms_import_refresh_po has done since 20260724130000. Re-derivation is
--        idempotent for a genuinely finished PO.
--    (b) Three new arms — qc_inspection / purchase_return / gate_outward — sitting
--        between the Tally arms and the legacy stage arms.
--    (c) The close arm additionally requires the QC branch to be clear. Without
--        this the `v_paid >= v_total` shortcut would close a PO straight past a
--        pending inspection.
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
  v_qc_pending    boolean;
  v_return_pending boolean;
  v_gate_pending  boolean;
begin
  -- Cancellation is absorbing. `closed` is derived and stays re-derivable.
  if (select current_stage from public.fms_purchase_pos where id = p_po_id) = 'cancelled' then
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

  -- A Tally-booked receipt that carries QC-required material and has not been
  -- inspected. Receipts stamped `qc_waived_at` predate the QC step entirely.
  select exists(
    select 1 from public.fms_purchase_grns gr
     join public.fms_purchase_tally_bookings t on t.grn_id = gr.id
     where gr.po_id = p_po_id
       and gr.qc_waived_at is null
       and public.fms_purchase_grn_needs_qc(gr.id)
       and not exists (select 1 from public.fms_purchase_qc_inspections q where q.grn_id = gr.id)
  ) into v_qc_pending;

  select exists(
    select 1 from public.fms_purchase_qc_inspections q
     where q.po_id = p_po_id and q.result = 'rejected' and q.return_tally_ref is null
  ) into v_return_pending;

  select exists(
    select 1 from public.fms_purchase_qc_inspections q
     where q.po_id = p_po_id and q.result = 'rejected'
       and q.return_tally_ref is not null and q.gate_register_no is null
  ) into v_gate_pending;

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
                      or (v_paid >= v_total and v_total > 0) )
                and not coalesce(v_qc_pending,false)
                and not coalesce(v_return_pending,false)
                and not coalesce(v_gate_pending,false) then 'closed'
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           when coalesce(v_unbooked_grn,false) then 'tally'
           when coalesce(v_qc_pending,false) then 'qc_inspection'
           when coalesce(v_return_pending,false) then 'purchase_return'
           when coalesce(v_gate_pending,false) then 'gate_outward'
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;
