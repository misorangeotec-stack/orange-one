-- ===========================================================================
-- Import Purchase FMS — two changes the import desk asked for:
--
--   1. SHIPMENT TYPE on the requisition. After Company and Vendor, the raiser
--      now says how the goods are coming: By Air, By Sea, or LCL. It is a
--      property of the ORDER, not of a line, so it lives on the request header
--      and is copied onto every PO generated from it — that way every PO-side
--      step (Share PO, Collect PI, Follow-up, Inward) can name it without
--      walking back to the requisition.
--
--   2. COLLECT PI is back, as step 5, straight after Share PO.
--      20260727120000 stripped Import to a pure quantity requisition and retired
--      Collect PI along with the money-side steps. The step returns, but NOT the
--      money-side version of it: the old Collect PI made you cover each PO line
--      with a quantity and priced the PI. The new one captures exactly three
--      things — the vendor's PI number (required), the PI document (required),
--      and remarks (optional). No line coverage, no PI value, no payment terms.
--
--      Hence two NEW, purpose-built RPCs (fms_import_collect_pi /
--      fms_import_update_collect_pi) rather than un-neutering fms_import_add_pi:
--      that function's frozen 8-arg signature is built around p_items / p_pi_value
--      and re-shaping it would mean either an overload or a lie. add_pi and
--      update_pi are left exactly as they are (add_pi still raises), and nothing
--      calls them any more.
--
-- Additive-only, per the repo rule: no column or table is dropped. The PI
-- quantity columns (pi_value, payment_terms, dispatch_date, fms_import_pi_items)
-- stay and are simply never written by the new flow.
--
-- STAGE MACHINE: share_po now advances to `collect_pi` instead of jumping to
-- `follow_up`; recording the PI advances to `follow_up`. Every legacy PO already
-- past that point is untouched — refresh_po only ever walks these early stages
-- FORWARD, and a PO that already has a follow-up or a receipt is caught by an
-- earlier branch.
--
-- DEPLOY ORDER: apply this BEFORE the frontend. Both new columns are read by the
-- new client; the RPCs stay backward-compatible (p_shipment_type is optional and
-- an omitted value never blanks a stored one), so the currently-deployed client
-- keeps working in the window between the two.
--
-- POST-DEPLOY: seed the `collect_pi` step owners in Setup → Step Owners.
-- Until then only an admin can record a PI and the step has no queue owner.
--
-- Import owns a DEDICATED fms_import_* namespace — procurement (fms_purchase_*)
-- is a separate object set and is NOT touched by anything here.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema — three nullable columns, no backfill.
--    Existing requests/POs simply have no shipment type; the UI renders "—".
-- ---------------------------------------------------------------------------
alter table public.fms_import_requests add column if not exists shipment_type text;
alter table public.fms_import_pos      add column if not exists shipment_type text;
alter table public.fms_import_pis      add column if not exists remarks       text;

do $$
begin
  alter table public.fms_import_requests
    add constraint fms_import_requests_shipment_type_chk
    check (shipment_type is null or shipment_type in ('air','sea','lcl'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.fms_import_pos
    add constraint fms_import_pos_shipment_type_chk
    check (shipment_type is null or shipment_type in ('air','sea','lcl'));
exception when duplicate_object then null;
end $$;

comment on column public.fms_import_requests.shipment_type is
  'How the goods travel: air | sea | lcl. Chosen on the requisition, copied onto every PO it produces. Null on requests raised before the field existed.';
comment on column public.fms_import_pos.shipment_type is
  'Copied from the source requisition at generate_po. Denormalised on purpose: every PO-side step form names it without walking back to the request.';
comment on column public.fms_import_pis.remarks is
  'Free-text note captured at the Collect PI step.';


-- ---------------------------------------------------------------------------
-- 2. submit_request — carries the shipment type.
--    Base body = 20260727120000 (the quantity-requisition rewrite). The only
--    deltas are the new parameter, its validation and the extra INSERT column.
--
--    DROPPED and recreated rather than replaced: adding a defaulted parameter to
--    the existing signature would create a PostgREST OVERLOAD, not a
--    replacement, and a 7-arg call would then be ambiguous. The old 7-arg
--    signature still resolves against the new function (the 8th has a default),
--    so an in-flight client is unaffected.
--
--    The shipment type is NOT required server-side: the client makes it
--    mandatory, but enforcing it here would break the currently-deployed
--    frontend in the window between this migration and the deploy.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_import_submit_request(uuid, uuid, uuid, text, text, numeric, jsonb);

create or replace function public.fms_import_submit_request(
  p_company_id    uuid,
  p_vendor_id     uuid,
  p_category_id   uuid,
  p_note          text,
  p_currency      text,
  p_fx_rate       numeric,   -- ignored: the flow no longer converts currency
  p_items         jsonb,     -- [{item_id, category_id, quantity, unit, line_remark}]
  p_shipment_type text default null   -- air | sea | lcl
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_no         text;
  v_seq        integer;
  v_fy         text;
  v_elem       jsonb;
  v_qty        numeric(14,3);
  v_hdr_cat    uuid;
  v_cat        uuid;
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'Company and vendor are required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;
  if nullif(p_shipment_type,'') is not null and p_shipment_type not in ('air','sea','lcl') then
    raise exception 'Invalid shipment type';
  end if;

  -- Header category = the explicit param, else the FIRST line's. Order is
  -- preserved by jsonb_array_elements, so "first" is deterministic.
  v_hdr_cat := p_category_id;
  if v_hdr_cat is null then
    select nullif(e->>'category_id','')::uuid
      into v_hdr_cat
      from jsonb_array_elements(p_items) e
     where nullif(e->>'category_id','') is not null
     limit 1;
  end if;
  if v_hdr_cat is null then
    raise exception 'Every line needs a category';
  end if;

  v_fy  := public.fms_import_fy_code(current_date);
  v_seq := public.fms_import_next_seq('request:' || v_fy);
  v_no  := 'IPR-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_import_requests
    (request_no, company_id, category_id, vendor_id, currency, requester_id, note, shipment_type)
  values
    (v_no, p_company_id, v_hdr_cat, p_vendor_id, nullif(p_currency,''), auth.uid(), nullif(p_note, ''),
     nullif(p_shipment_type,''))
  returning id into v_request_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_elem->>'quantity')::numeric, 0);
    v_cat := coalesce(nullif(v_elem->>'category_id','')::uuid, v_hdr_cat);
    if v_qty <= 0 then raise exception 'Each item needs a quantity greater than 0'; end if;

    -- No rate, no FX, no value: the line carries quantity only. The money
    -- columns stay (NOT NULL downstream on the PO) and are written 0.
    insert into public.fms_import_request_items (
      request_id, item_id, category_id, quantity, unit, line_remark,
      final_vendor_id, final_qty, final_rate, gst_pct, currency,
      fx_rate_at_request, line_value_fx, line_value,
      status, sourced_at
    )
    values (
      v_request_id,
      (v_elem->>'item_id')::uuid,
      v_cat,
      v_qty,
      coalesce(v_elem->>'unit', ''),
      nullif(v_elem->>'line_remark', ''),
      p_vendor_id, v_qty, 0, null, nullif(p_currency,''),
      null, 0, 0,
      'approval', now()   -- no sourcing: line enters straight at approval; sourced_at anchors the SLA
    );
  end loop;

  return v_request_id;
end $function$;

grant execute on function public.fms_import_submit_request(uuid, uuid, uuid, text, text, numeric, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. update_request — the same treatment, so the requester can correct the
--    shipment type while the requisition is still pre-approval.
--    Base body = 20260722120000, verbatim apart from the new parameter, its
--    validation, and the one extra column in the header UPDATE.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_import_update_request(uuid, text, numeric, jsonb);

create or replace function public.fms_import_update_request(
  p_request_id uuid,
  p_note       text,
  p_fx_rate    numeric,
  p_items      jsonb,  -- [{id?, item_id, category_id, quantity, unit, rate, line_remark}]
  p_shipment_type text default null   -- NEW; null/'' keeps the stored value
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_status    text;
  v_vendor    uuid;
  v_ccy       text;
  v_no        text;
  v_uid       uuid := auth.uid();
  v_fx        numeric(18,6);
  v_elem      jsonb;
  v_id        uuid;
  v_qty       numeric(14,3);
  v_rate      numeric(16,4);
  v_cat       uuid;
  v_val_fx    numeric(16,2);
  v_val_inr   numeric(16,2);
  v_keep      uuid[] := '{}';
  v_hdr_cat   uuid;
  v_old_total numeric(16,2);
  v_new_total numeric(16,2);
  v_old_appr  uuid[];
  v_new_appr  uuid[];
  v_cleared   int := 0;
  v_removed   int := 0;
begin
  select requester_id, status, vendor_id, currency, request_no
    into v_requester, v_status, v_vendor, v_ccy, v_no
    from public.fms_import_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not (v_requester = v_uid or public.is_admin(v_uid)) then
    raise exception 'Only the requester or an admin can edit this request';
  end if;

  -- Re-check state server-side. The hidden button is a courtesy, never the gate.
  if not public.fms_import_request_editable(p_request_id) then
    if v_status = 'cancelled' then
      raise exception 'This request has been cancelled — it can no longer be edited.';
    end if;
    raise exception 'This request can no longer be edited: a decision has already been recorded on at least one of its lines.';
  end if;

  v_fx := coalesce(p_fx_rate, 0);
  if v_fx <= 0 then raise exception 'A valid exchange rate is required'; end if;

  -- Shipment type is validated only when supplied: an omitted (or empty) value
  -- leaves whatever the request already carries, so an in-flight client that
  -- predates the column cannot blank it.
  if nullif(p_shipment_type,'') is not null and p_shipment_type not in ('air','sea','lcl') then
    raise exception 'Invalid shipment type';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;

  -- Who owns these lines TODAY, before the write. A coordinator's override wins
  -- over the matrix band, exactly as decide_approval treats it.
  select coalesce(array_agg(distinct a) filter (where a is not null), '{}')
    into v_old_appr
    from (
      select coalesce(ri.assigned_approver_id,
             (select m.approver_user_id from public.fms_import_approval_matrix m
               where m.active and ri.line_value >= m.min_amount
                 and (m.max_amount is null or ri.line_value <= m.max_amount)
               order by m.sort_order, m.min_amount limit 1)) as a
        from public.fms_import_request_items ri where ri.request_id = p_request_id
    ) t;
  select coalesce(sum(line_value), 0) into v_old_total
    from public.fms_import_request_items where request_id = p_request_id;

  -- ---- upsert the lines ------------------------------------------------------
  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_id   := nullif(v_elem->>'id','')::uuid;
    v_qty  := coalesce((v_elem->>'quantity')::numeric, 0);
    v_rate := coalesce((v_elem->>'rate')::numeric, 0);
    v_cat  := nullif(v_elem->>'category_id','')::uuid;
    if v_qty <= 0 then raise exception 'Each item needs a quantity greater than 0'; end if;
    if v_rate < 0 then raise exception 'Rate cannot be negative'; end if;
    if v_cat is null then raise exception 'Every line needs a category'; end if;

    -- Mirrors submit_request's math exactly — no GST on an import line.
    v_val_fx  := round(v_qty * v_rate, 2);
    v_val_inr := round(v_val_fx * v_fx, 2);

    if v_id is not null then
      -- EXISTING LINE. status / approver_id / approval_tier / assigned_approver_id
      -- / sourced_at / created_at are deliberately untouched: identity and
      -- history survive an edit.
      update public.fms_import_request_items
         set item_id            = (v_elem->>'item_id')::uuid,
             category_id        = v_cat,
             quantity           = v_qty,
             unit               = coalesce(v_elem->>'unit',''),
             line_remark        = nullif(v_elem->>'line_remark',''),
             final_qty          = v_qty,
             final_rate         = v_rate,
             currency           = v_ccy,
             fx_rate_at_request = v_fx,
             line_value_fx      = v_val_fx,
             line_value         = v_val_inr,
             edited_at          = now(),
             edited_by          = v_uid
       -- Scoped to the request, so a forged id cannot reach another request's line.
       where id = v_id and request_id = p_request_id;
      if not found then
        raise exception 'Line % does not belong to this request', v_id;
      end if;
    else
      -- NEW LINE, born exactly as submit_request births one.
      insert into public.fms_import_request_items (
        request_id, item_id, category_id, quantity, unit, line_remark,
        final_vendor_id, final_qty, final_rate, gst_pct, currency,
        fx_rate_at_request, line_value_fx, line_value, status, sourced_at
      ) values (
        p_request_id, (v_elem->>'item_id')::uuid, v_cat, v_qty,
        coalesce(v_elem->>'unit',''), nullif(v_elem->>'line_remark',''),
        v_vendor, v_qty, v_rate, null, v_ccy,
        v_fx, v_val_fx, v_val_inr, 'approval', now()
      )
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- Drop the lines the user removed. Safe: the predicate proved no po_item
  -- (ON DELETE RESTRICT) exists, and quotations cascade. Activity keyed to a
  -- REMOVED line is knowingly orphaned — that is the cost of removal, not of
  -- editing.
  delete from public.fms_import_request_items
   where request_id = p_request_id and not (id = any(v_keep));
  get diagnostics v_removed = row_count;

  -- ---- header ----------------------------------------------------------------
  -- requests.category_id is NOT NULL and holds the FIRST line's category, so an
  -- edit that dropped line 1 must re-derive it.
  select category_id into v_hdr_cat
    from public.fms_import_request_items
   where request_id = p_request_id and category_id is not null
   order by created_at, id
   limit 1;
  if v_hdr_cat is null then raise exception 'Every line needs a category'; end if;

  update public.fms_import_requests
     set note        = nullif(p_note,''),
         category_id = v_hdr_cat,
         shipment_type = coalesce(nullif(p_shipment_type,''), shipment_type),
         edited_at   = now(),
         edited_by   = v_uid
   where id = p_request_id;

  -- ---- re-route --------------------------------------------------------------
  select coalesce(sum(line_value), 0) into v_new_total
    from public.fms_import_request_items where request_id = p_request_id;

  -- A coordinator's manual reassignment was a decision about the OLD amount. If
  -- the matrix band has moved, keeping it would make "edit the qty" a way to
  -- park a large line with a junior approver. Cleared ONLY where the band
  -- actually changed — an untouched line keeps its override.
  with banded as (
    select ri.id, ri.assigned_approver_id,
           (select m.approver_user_id from public.fms_import_approval_matrix m
             where m.active and ri.line_value >= m.min_amount
               and (m.max_amount is null or ri.line_value <= m.max_amount)
             order by m.sort_order, m.min_amount limit 1) as band_approver
      from public.fms_import_request_items ri
     where ri.request_id = p_request_id
  )
  update public.fms_import_request_items ri
     set assigned_approver_id = null
    from banded b
   where ri.id = b.id
     and b.assigned_approver_id is not null
     and b.band_approver is distinct from b.assigned_approver_id;
  get diagnostics v_cleared = row_count;

  select coalesce(array_agg(distinct a) filter (where a is not null), '{}')
    into v_new_appr
    from (
      select coalesce(ri.assigned_approver_id,
             (select m.approver_user_id from public.fms_import_approval_matrix m
               where m.active and ri.line_value >= m.min_amount
                 and (m.max_amount is null or ri.line_value <= m.max_amount)
               order by m.sort_order, m.min_amount limit 1)) as a
        from public.fms_import_request_items ri where ri.request_id = p_request_id
    ) t;

  -- In-transaction audit + fan-out. ONE announce to the UNION of the old and new
  -- approvers: the previous owner learns it left their queue, the new one learns
  -- it arrived. announce already dedupes and skips the actor, so the raw union is
  -- safe. One call, not two — two would write two activity rows for one edit.
  perform public.fms_import_announce(
    'request', p_request_id, 'request_edited',
    format('Request %s was edited by the requester — please re-check before approving',
           coalesce(v_no, '')),
    v_old_appr || v_new_appr,
    jsonb_build_object(
      'total_from', v_old_total,
      'total_to',   v_new_total,
      'fx_rate_to', v_fx,
      'lines_to',   jsonb_array_length(p_items),
      'lines_removed', v_removed,
      'band_changed', (v_old_appr is distinct from v_new_appr),
      'reassignments_cleared', v_cleared
    )
  );
end $$;

grant execute on function public.fms_import_update_request(uuid, text, numeric, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. generate_po — copies the requisition's shipment type onto the PO.
--    Base body = 20260804120100, verbatim apart from `r.shipment_type` joining
--    the per-line SELECT and the closing UPDATE that stamps the header totals.
--
--    Read per line rather than up front because the RPC never receives a request
--    id — it takes request_item_ids and derives the request from them. Every
--    line on one PO belongs to one requisition (the PO desk is requisition
--    scoped), so the last line's value is the requisition's value.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_generate_po(
  p_vendor_id uuid,
  p_company_id uuid,
  p_request_item_ids uuid[],
  p_po_no text default null,
  p_tally_po_no text default null,
  p_document_path text default null,
  p_document_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $function$
declare
  v_po_id   uuid;
  v_no      text;
  v_seq     integer;
  v_fy      text;
  v_id      uuid;
  v_total   numeric(16,2) := 0;
  v_totalfx numeric(16,2) := 0;
  v_fqty    numeric(14,3);
  v_frate   numeric(14,2);
  v_lval    numeric(16,2);
  v_lvalfx  numeric(16,2);
  v_vendor  uuid;
  v_lstatus text;
  v_company uuid;
  v_ccy     text;
  v_ship    text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to generate POs';
  end if;
  if p_request_item_ids is null or array_length(p_request_item_ids, 1) is null then
    raise exception 'Select at least one line for the PO';
  end if;

  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required to generate the PO';
  end if;
  if nullif(p_document_path,'') is null then
    raise exception 'The PO PDF is required to generate the PO';
  end if;

  if p_po_no is not null and exists (select 1 from public.fms_import_pos where po_no = p_po_no) then
    raise exception 'PO number % already exists', p_po_no;
  end if;
  if p_po_no is null then
    v_fy  := public.fms_import_fy_code(current_date);
    v_seq := public.fms_import_next_seq('po:' || v_fy);
    v_no  := 'IPO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');
  else
    v_no := p_po_no;
  end if;

  insert into public.fms_import_pos
    (po_no, vendor_id, company_id, created_by, tally_po_no, document_path, document_name)
  values
    (v_no, p_vendor_id, p_company_id, auth.uid(),
     nullif(p_tally_po_no,''), nullif(p_document_path,''), nullif(p_document_name,''))
  returning id into v_po_id;

  foreach v_id in array p_request_item_ids loop
    select ri.status, ri.final_vendor_id, ri.final_qty, ri.final_rate,
           ri.line_value, ri.line_value_fx, ri.currency, r.company_id, r.shipment_type
      into v_lstatus, v_vendor, v_fqty, v_frate, v_lval, v_lvalfx, v_ccy, v_company, v_ship
    from public.fms_import_request_items ri
    join public.fms_import_requests r on r.id = ri.request_id
    where ri.id = v_id
    for update of ri;

    if v_lstatus is null then raise exception 'Line % not found', v_id; end if;
    if v_lstatus <> 'approved_pending_po' then
      raise exception 'Line % is not an approved pool line (status %)', v_id, v_lstatus;
    end if;
    if v_vendor is distinct from p_vendor_id then raise exception 'Line % is for a different vendor', v_id; end if;
    if v_company is distinct from p_company_id then raise exception 'Line % belongs to a different company', v_id; end if;

    insert into public.fms_import_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value)
    values (v_po_id, v_id, v_fqty, v_frate, null, v_lval);

    update public.fms_import_request_items set status = 'po' where id = v_id;
    v_total   := v_total + coalesce(v_lval, 0);
    v_totalfx := v_totalfx + coalesce(v_lvalfx, 0);
  end loop;

  update public.fms_import_pos
     set total_value = v_total, total_value_fx = v_totalfx, currency = v_ccy, shipment_type = v_ship
   where id = v_po_id;
  return v_po_id;
end $function$;

grant execute on function public.fms_import_generate_po(uuid, uuid, uuid[], text, text, text, text) to authenticated;


-- ===========================================================================
--                    STEP 5 — COLLECT PI comes back
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5. refresh_po — the stage machine learns about `collect_pi` again.
--    Base body = 20260727120000. The single delta is the early-stage branch:
--    it used to walk every pre-receipt stage to `follow_up`; it now stops at
--    `collect_pi` until a PI exists.
--
--    `v_has_followup` is part of the test on purpose: refresh_po is called at the
--    end of record_followup, and without it a PO whose PI predates this feature
--    (or was deleted) would be walked BACKWARDS from follow_up to collect_pi
--    every time someone logged a follow-up.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_refresh_po(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_all_recv      boolean;
  v_any_recv      boolean;
  v_tally         boolean;
  v_dispatched    boolean;
  v_unbooked_grn  boolean;
  v_has_pi        boolean;
  v_has_followup  boolean;
begin
  -- Only cancellation is absorbing. 'closed' is derived and re-derivable: a GRN
  -- edit on a closed PO must be free to recompute quantities and, if the goods
  -- are no longer fully received, walk the PO back to 'inward'.
  if (select current_stage from public.fms_import_pos where id = p_po_id) = 'cancelled' then
    return;
  end if;

  update public.fms_import_po_items pi
     set received_qty = coalesce((
       select sum(gi.received_qty) from public.fms_import_grn_items gi where gi.po_item_id = pi.id
     ), 0)
   where pi.po_id = p_po_id;

  select bool_and(received_qty >= qty), bool_or(received_qty > 0)
    into v_all_recv, v_any_recv
    from public.fms_import_po_items where po_id = p_po_id;
  select exists(select 1 from public.fms_import_tally_bookings where po_id = p_po_id) into v_tally;

  -- A goods receipt still awaiting its Tally invoice.
  select exists(
    select 1 from public.fms_import_grns gr
     where gr.po_id = p_po_id
       and not exists (select 1 from public.fms_import_tally_bookings t where t.grn_id = gr.id)
  ) into v_unbooked_grn;

  select exists(select 1 from public.fms_import_followups where po_id = p_po_id and dispatch_status = 'dispatched')
    into v_dispatched;

  select exists(select 1 from public.fms_import_pis where po_id = p_po_id) into v_has_pi;
  select exists(select 1 from public.fms_import_followups where po_id = p_po_id) into v_has_followup;

  update public.fms_import_pos
     set current_stage = case
           when coalesce(v_all_recv,false) and coalesce(v_tally,false) and not coalesce(v_unbooked_grn,false) then 'closed'
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           when coalesce(v_unbooked_grn,false) then 'tally'
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') then
             case when coalesce(v_has_pi,false) or coalesce(v_has_followup,false) then 'follow_up' else 'collect_pi' end
           else current_stage end
   where id = p_po_id;
end $function$;


-- ---------------------------------------------------------------------------
-- 6. share_po / update_share_po — hand the PO to Collect PI, not to Follow-up.
--    Base bodies = 20260804120100. The only delta in each is the target stage.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_share_po(
  p_po_id uuid,
  p_document_path text default null,   -- ignored: captured at the PO stage
  p_document_name text default null,   -- ignored: captured at the PO stage
  p_tally_po_no text default null,     -- ignored: captured at the PO stage
  p_remarks text default null,
  p_payment_terms text default null,
  p_dispatch_date date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_shared_at timestamptz;
  v_stage     text;
  v_tally     text;
  v_doc       text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;

  select shared_at, current_stage, tally_po_no, document_path
    into v_shared_at, v_stage, v_tally, v_doc
    from public.fms_import_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % — it can no longer be shared.', v_stage;
  end if;

  if v_shared_at is not null then
    raise exception 'This PO has already been shared. Use Edit on the Share PO stage to correct its details.';
  end if;

  -- Checked against the PO, not the caller: these belong to the PO stage now.
  if nullif(v_tally,'') is null or nullif(v_doc,'') is null then
    raise exception 'This PO has no Tally PO number or PDF yet — add them on the PO stage before sharing it.';
  end if;

  if p_dispatch_date is null then
    raise exception 'The expected dispatch date is required to mark the PO shared';
  end if;
  if nullif(p_payment_terms,'') is not null
     and p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;

  update public.fms_import_pos
     set status        = case when status = 'generated' then 'shared' else status end,
         -- Collect PI is step 5 again: the shared PO goes there, not to Follow-up.
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
         share_remarks = nullif(p_remarks,''),
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms),
         dispatch_date = p_dispatch_date,
         shared_at     = coalesce(shared_at, now()),
         shared_by     = coalesce(shared_by, auth.uid())
   where id = p_po_id;
end $$;

grant execute on function public.fms_import_share_po(uuid, text, text, text, text, text, date) to authenticated;


create or replace function public.fms_import_update_share_po(
  p_po_id uuid,
  p_payment_terms text,
  p_dispatch_date date,
  p_remarks text default null,
  p_tally_po_no text default null,     -- ignored: captured at the PO stage
  p_document_path text default null,   -- ignored: captured at the PO stage
  p_document_name text default null    -- ignored: captured at the PO stage
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stage     text;
  v_doc       text;
  v_old_terms text;
  v_po_no     text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to edit this PO''s share details';
  end if;

  select current_stage, document_path, payment_terms, po_no
    into v_stage, v_doc, v_old_terms, v_po_no
    from public.fms_import_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  if not public.fms_import_share_po_editable(p_po_id) then
    if v_stage in ('closed','cancelled') then
      raise exception 'This PO is % — its share details can no longer be edited.', v_stage;
    end if;
    raise exception 'The share details can no longer be edited: work has already moved on (a PI, follow-up or goods receipt exists against this PO).';
  end if;

  if p_dispatch_date is null then raise exception 'The expected dispatch date is required'; end if;
  if nullif(p_payment_terms,'') is null
     or p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;
  if nullif(v_doc,'') is null then
    raise exception 'This PO has no PO PDF — add it on the PO stage.';
  end if;

  update public.fms_import_pos
     set share_remarks = nullif(p_remarks,''),
         payment_terms = p_payment_terms,
         dispatch_date = p_dispatch_date,
         -- share_po_editable already proved no PI / follow-up / GRN exists, so
         -- the PO is necessarily still at (or before) Collect PI. Terms do not
         -- drive the stage in Import.
         current_stage = case when current_stage in ('share_po','collect_pi','advance_payment') then 'collect_pi' else current_stage end,
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_po_id;

  perform public.fms_import_announce(
    'po', p_po_id, 'po_share_edited',
    format('Share details edited for %s', coalesce(v_po_no, 'the PO')),
    '{}'::uuid[],
    jsonb_build_object(
      'payment_terms_from', v_old_terms,
      'payment_terms_to', p_payment_terms,
      'dispatch_date', p_dispatch_date
    )
  );
end $$;

grant execute on function public.fms_import_update_share_po(uuid, text, date, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. pi_editable — re-stated for the new step.
--    The old rule locked a PI once a payment landed against it, because the PI
--    used to be the payment's base. There are no payments in Import any more, so
--    the rule is the app's standard one: editable until the NEXT step produces
--    something — a follow-up, or goods arriving.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_pi_editable(p_pi_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_pis pi
     where pi.id = p_pi_id
       and public.fms_import_po_open(pi.po_id)
       and not exists (select 1 from public.fms_import_followups x where x.po_id = pi.po_id)
       and not exists (select 1 from public.fms_import_grns      x where x.po_id = pi.po_id)
  );
$$;
grant execute on function public.fms_import_pi_editable(uuid) to authenticated;

comment on function public.fms_import_pi_editable(uuid) is
  'True while the Collect PI entry may still be corrected: the PO is open and no follow-up or goods receipt exists against it yet.';


-- ---------------------------------------------------------------------------
-- 8. collect_pi — the step itself. Three fields, two of them required.
--
--    ONE PI per PO: the PI is the vendor's proforma for the order, and with no
--    line coverage there is nothing a second one would mean. Enforced here
--    rather than with a unique index so a legacy PO carrying two (from the old
--    per-line flow) is left alone instead of blocking the migration.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_collect_pi(
  p_po_id uuid,
  p_vendor_pi_no text,
  p_document_path text,
  p_document_name text default null,
  p_remarks text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pi_id     uuid;
  v_stage     text;
  v_po_no     text;
  v_shared_at timestamptz;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('collect_pi', auth.uid())) then
    raise exception 'Not authorized to record a PI';
  end if;

  select current_stage, po_no, shared_at into v_stage, v_po_no, v_shared_at
    from public.fms_import_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;
  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % — a PI can no longer be recorded against it.', v_stage;
  end if;
  -- Guards the step ORDER, not just the data: refresh_po walks a PO with a PI
  -- straight to follow_up, so recording one against an unshared PO would skip
  -- Share PO entirely.
  if v_shared_at is null then
    raise exception 'This PO has not been shared with the vendor yet — share it before collecting the PI.';
  end if;

  if nullif(p_vendor_pi_no,'') is null then
    raise exception 'The vendor PI number is required';
  end if;
  if nullif(p_document_path,'') is null then
    raise exception 'The PI document is required';
  end if;
  if exists (select 1 from public.fms_import_pis where po_id = p_po_id) then
    raise exception 'A PI has already been collected against this PO. Use Edit on the Collect PI stage to correct it.';
  end if;

  insert into public.fms_import_pis
    (po_id, vendor_pi_no, document_path, document_name, remarks, created_by)
  values
    (p_po_id, p_vendor_pi_no, nullif(p_document_path,''), nullif(p_document_name,''),
     nullif(p_remarks,''), auth.uid())
  returning id into v_pi_id;

  perform public.fms_import_refresh_po(p_po_id);

  perform public.fms_import_announce('pi', v_pi_id, 'pi_collected',
    format('PI %s collected for %s — follow up on dispatch', p_vendor_pi_no, coalesce(v_po_no, 'the PO')),
    '{}'::uuid[],
    jsonb_build_object('po_id', p_po_id, 'vendor_pi_no', p_vendor_pi_no));

  return v_pi_id;
end $$;

grant execute on function public.fms_import_collect_pi(uuid, text, text, text, text) to authenticated;


create or replace function public.fms_import_update_collect_pi(
  p_pi_id uuid,
  p_vendor_pi_no text,
  p_document_path text default null,   -- null => keep the stored document
  p_document_name text default null,
  p_remarks text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_po  uuid;
  v_doc text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('collect_pi', auth.uid())) then
    raise exception 'Not authorized to edit this PI';
  end if;

  select po_id, document_path into v_po, v_doc
    from public.fms_import_pis where id = p_pi_id for update;
  if v_po is null then raise exception 'PI not found'; end if;

  if not public.fms_import_pi_editable(p_pi_id) then
    if not public.fms_import_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its PI can no longer be edited.';
    end if;
    raise exception 'This PI can no longer be edited: work has already moved on (a follow-up or goods receipt exists against this PO).';
  end if;

  if nullif(p_vendor_pi_no,'') is null then
    raise exception 'The vendor PI number is required';
  end if;
  -- Keeping the stored file is fine; ending up with none is not.
  if nullif(coalesce(nullif(p_document_path,''), v_doc), '') is null then
    raise exception 'The PI document is required';
  end if;

  update public.fms_import_pis
     set vendor_pi_no  = p_vendor_pi_no,
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         remarks       = nullif(p_remarks,''),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_pi_id;

  perform public.fms_import_refresh_po(v_po);

  perform public.fms_import_announce('pi', p_pi_id, 'pi_edited',
    format('PI %s edited', p_vendor_pi_no), '{}'::uuid[],
    jsonb_build_object('po_id', v_po, 'document_replaced',
      (nullif(p_document_path,'') is not null and p_document_path is distinct from v_doc)));
end $$;

grant execute on function public.fms_import_update_collect_pi(uuid, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. NO BACKFILL, on purpose.
--
--    Every PO already past Share PO stays exactly where it is: an order that is
--    mid-flight under the old flow is not dragged back to a step its owners were
--    never asked to do. Only POs shared from now on route through Collect PI.
--
--    This is safe against refresh_po, which would otherwise re-derive such a PO
--    (at `follow_up`, no PI) back to `collect_pi`: the only thing that calls
--    refresh_po for a PO in that state is record_followup, and it calls it AFTER
--    inserting the follow-up — so `v_has_followup` is already true and the PO
--    stays at follow_up. Every other caller (GRN, Tally, QC) is caught by an
--    earlier branch of the CASE.
-- ---------------------------------------------------------------------------

commit;
