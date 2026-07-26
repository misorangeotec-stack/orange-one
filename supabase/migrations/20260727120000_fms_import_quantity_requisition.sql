-- ===========================================================================
-- Import Purchase FMS — turn the flow into a PURE QUANTITY REQUISITION.
--
-- The import flow was a money-driven foreign-procurement flow: per-unit rate,
-- FX exchange rate, line/PO value, value-banded approvals, and money-side steps
-- (Collect PI, 100%-advance Payment). The business now wants it stripped to a
-- quantity requisition: NO rate, NO exchange rate, NO value/totals, every
-- request always goes for approval to a single configured approver (or a small
-- list), and the PO closes purely on goods received (GRN) + Tally-booked.
--
-- Additive-only, per the repo rule:
--   * NO column/table is dropped. The money columns (final_rate, line_value,
--     line_value_fx, fx_rate_at_request, total_value, advance_paid, po_items.rate
--     …) all stay and are simply written 0 / left untouched and never rendered.
--   * Every function is CREATE OR REPLACE with its EXACT current argument list —
--     changing a signature would create a PostgREST OVERLOAD, not a replacement.
--     Removed params (p_fx_rate, p_rates, per-line rate) stay in the signature
--     and are ignored.
--   * fms_import_add_pi / fms_import_record_payment are NOT dropped; their bodies
--     are replaced with a raise, so a stale client can no longer create a PI or
--     a payment.
--
-- Import owns a DEDICATED fms_import_* namespace — procurement (fms_purchase_*)
-- is a separate object set and is NOT touched by anything here.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Helper — is this user an ACTIVE approver?
-- Approvals no longer route by value band. Every active row in
-- fms_import_approval_matrix is an eligible approver (a single person, or a
-- small list). This lets the authz check accept any of them.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_is_approver(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_import_approval_matrix
     where active and approver_user_id = p_uid
  );
$$;
grant execute on function public.fms_import_is_approver(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 1. submit_request — quantity only.
--    Base body = 20260719120000_add_fms_import_per_line_category.sql.
--    Deltas: no exchange-rate requirement, no per-line rate; each line is stored
--    with final_rate = 0, line_value(_fx) = 0, fx_rate_at_request = null. The
--    "every line needs a category" rule stays (fms_import_requests.category_id
--    is NOT NULL). Signature is unchanged; p_fx_rate is accepted and ignored.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_submit_request(
  p_company_id  uuid,
  p_vendor_id   uuid,
  p_category_id uuid,
  p_note        text,
  p_currency    text,
  p_fx_rate     numeric,   -- ignored: the flow no longer converts currency
  p_items       jsonb      -- [{item_id, category_id, quantity, unit, line_remark}]
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

  insert into public.fms_import_requests (request_no, company_id, category_id, vendor_id, currency, requester_id, note)
  values (v_no, p_company_id, v_hdr_cat, p_vendor_id, nullif(p_currency,''), auth.uid(), nullif(p_note, ''))
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

grant execute on function public.fms_import_submit_request(uuid, uuid, uuid, text, text, numeric, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. decide_approval_request — always route to a configured approver.
--    Base body = 20260720170000_add_fms_import_request_scoped_approval.sql.
--    Deltas: the band no longer filters on amount (every active matrix row is an
--    eligible approver, ordered deterministically), and the authz check accepts
--    ANY active approver via fms_import_is_approver. The `override` branch is
--    retained but is now UNREACHABLE (the UI no longer offers rate revision).
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_decide_approval_request(
  p_request_id         uuid,
  p_decision           text,       -- approve | override | reject | hold | resume
  p_override_vendor_id uuid default null,   -- unused in Import; kept for signature parity
  p_reason             text default '',
  p_rates              jsonb default null    -- unused; kept for signature parity
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_approver  uuid;
  v_tier      text;
  v_elem      jsonb;
  v_line_id   uuid;
  v_new_rate  numeric(14,2);
  v_val_fx    numeric(16,2);
begin
  perform 1 from public.fms_import_request_items
   where request_id = p_request_id and status in ('approval','on_hold')
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_import_request_items ri
   where ri.request_id = p_request_id and ri.status in ('approval','on_hold');

  if coalesce(v_count,0) = 0 then
    raise exception 'No items on this requisition are awaiting approval';
  end if;

  -- No value banding: the approver is simply the first active configured
  -- approver. The routing is who to STAMP/notify; any active approver may act.
  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or public.fms_import_is_approver(auth.uid())
          or exists (select 1 from public.fms_import_request_items
                      where id = any(v_ids) and assigned_approver_id = auth.uid())) then
    raise exception 'Not authorized to approve this requisition';
  end if;

  if p_decision = 'approve' or p_decision = 'override' then
    if p_decision = 'override' then
      if p_rates is null or jsonb_array_length(p_rates) = 0 then
        raise exception 'No revised rates supplied';
      end if;
      for v_elem in select * from jsonb_array_elements(p_rates) loop
        v_line_id  := (v_elem->>'request_item_id')::uuid;
        v_new_rate := nullif(v_elem->>'rate','')::numeric;
        if v_new_rate is null or v_new_rate < 0 then
          raise exception 'Enter a rate of 0 or more for every revised line';
        end if;
        update public.fms_import_request_items ri
           set final_rate    = v_new_rate,
               line_value_fx = round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2),
               line_value    = round(round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2)
                                     * coalesce(ri.fx_rate_at_request, 1), 2)
         where ri.id = v_line_id
           and ri.request_id = p_request_id
           and ri.status in ('approval','on_hold');
        if not found then
          raise exception 'Line % is not awaiting approval on this requisition', v_line_id;
        end if;
      end loop;
    end if;

    update public.fms_import_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null, approved_at = now()
     where id = any(v_ids);

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           assigned_approver_id = null
     where id = any(v_ids);

  elsif p_decision = 'hold' then
    update public.fms_import_request_items set status = 'on_hold' where id = any(v_ids);

  elsif p_decision = 'resume' then
    update public.fms_import_request_items set status = 'approval', approved_at = null
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  select coalesce(sum(ri.line_value),0) into v_val_fx
    from public.fms_import_request_items ri where ri.id = any(v_ids);

  perform public.fms_import_announce('request', p_request_id, 'approval_' || p_decision,
    format('Approval decision on the requisition (%s), %s item(s)', p_decision, v_count),
    '{}'::uuid[], jsonb_build_object('decision', p_decision, 'lines', v_count, 'total', v_val_fx));
end $$;

grant execute on function public.fms_import_decide_approval_request(uuid, text, uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. update_approval_request — same two deltas as (2).
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_update_approval_request(
  p_request_id         uuid,
  p_decision           text,       -- approve | override | reject
  p_override_vendor_id uuid default null,   -- unused in Import; kept for signature parity
  p_reason             text default '',
  p_rates              jsonb default null    -- unused; kept for signature parity
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_bad       integer;
  v_approver  uuid;
  v_tier      text;
  v_elem      jsonb;
  v_line_id   uuid;
  v_new_rate  numeric(14,2);
begin
  select count(*) into v_bad from public.fms_import_request_items
   where request_id = p_request_id and status = 'po';
  if v_bad > 0 then
    raise exception 'A PO has already been generated for this requisition — the approval can no longer be changed.';
  end if;

  perform 1 from public.fms_import_request_items
   where request_id = p_request_id and status = 'approved_pending_po'
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_import_request_items ri
   where ri.request_id = p_request_id and ri.status = 'approved_pending_po';

  if coalesce(v_count,0) = 0 then
    raise exception 'This requisition has no approved decision awaiting a PO.';
  end if;

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or public.fms_import_is_approver(auth.uid())
          or exists (select 1 from public.fms_import_request_items
                      where id = any(v_ids) and assigned_approver_id = auth.uid())) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' or p_decision = 'override' then
    if p_decision = 'override' then
      if p_rates is null or jsonb_array_length(p_rates) = 0 then
        raise exception 'No revised rates supplied';
      end if;
      for v_elem in select * from jsonb_array_elements(p_rates) loop
        v_line_id  := (v_elem->>'request_item_id')::uuid;
        v_new_rate := nullif(v_elem->>'rate','')::numeric;
        if v_new_rate is null or v_new_rate < 0 then
          raise exception 'Enter a rate of 0 or more for every revised line';
        end if;
        update public.fms_import_request_items ri
           set final_rate    = v_new_rate,
               line_value_fx = round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2),
               line_value    = round(round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2)
                                     * coalesce(ri.fx_rate_at_request, 1), 2)
         where ri.id = v_line_id
           and ri.request_id = p_request_id
           and ri.status = 'approved_pending_po';
        if not found then
          raise exception 'Line % is not an approved line awaiting a PO on this requisition', v_line_id;
        end if;
      end loop;
    end if;

    update public.fms_import_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null, assigned_approver_id = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_import_announce('request', p_request_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision, 'lines', v_count));
end $$;

grant execute on function public.fms_import_update_approval_request(uuid, text, uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. refresh_po — the PO stage machine, money removed.
--    Base body = 20260724130000_fms_import_grn_editable_until_tally.sql.
--    Deltas: no payment/PI signals (v_paid, v_total, v_has_advance, v_needs_adv,
--    v_has_pi and the fms_import_pis status update are gone). A PO closes ONLY on
--    all-goods-received AND Tally-booked. The Collect-PI / Advance-Payment stages
--    no longer exist in the UI, so any early stage walks forward to 'follow_up'.
--    collect_pi/advance_payment stay in the forward-walk IN(...) list only so a
--    stray legacy PO parked there can still advance; nothing routes INTO them.
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

  update public.fms_import_pos
     set current_stage = case
           when coalesce(v_all_recv,false) and coalesce(v_tally,false) and not coalesce(v_unbooked_grn,false) then 'closed'
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           when coalesce(v_unbooked_grn,false) then 'tally'
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $function$;


-- ---------------------------------------------------------------------------
-- 5. share_po / update_share_po — skip Collect-PI and Advance-Payment.
--    Base bodies = 20260719120000_add_fms_import_stage_edits.sql. Only the
--    stage each one advances to changes: straight to 'follow_up'. p_payment_terms
--    stays in the signature (recorded, no longer drives the stage).
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_share_po(
  p_po_id uuid,
  p_document_path text default null,
  p_document_name text default null,
  p_tally_po_no text default null,
  p_remarks text default null,
  p_payment_terms text default null,
  p_dispatch_date date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_shared_at timestamptz;
  v_stage     text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;

  select shared_at, current_stage into v_shared_at, v_stage
    from public.fms_import_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % — it can no longer be shared.', v_stage;
  end if;

  if v_shared_at is not null then
    raise exception 'This PO has already been shared. Use Edit on the Share PO stage to correct its details.';
  end if;

  if nullif(p_document_path,'') is null then
    raise exception 'The PO PDF is required to mark the PO shared';
  end if;
  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required to mark the PO shared';
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
         current_stage = case when current_stage = 'share_po' then 'follow_up' else current_stage end,
         document_path = nullif(p_document_path,''),
         document_name = nullif(p_document_name,''),
         tally_po_no   = nullif(p_tally_po_no,''),
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
  p_tally_po_no text,
  p_payment_terms text,
  p_dispatch_date date,
  p_remarks text default null,
  p_document_path text default null,
  p_document_name text default null
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
    raise exception 'The share details can no longer be edited: work has already moved on (a follow-up or goods receipt exists against this PO).';
  end if;

  if nullif(p_tally_po_no,'') is null then raise exception 'The Tally PO number is required'; end if;
  if p_dispatch_date is null then raise exception 'The expected dispatch date is required'; end if;
  if nullif(p_payment_terms,'') is null
     or p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;
  if nullif(coalesce(nullif(p_document_path,''), v_doc), '') is null then
    raise exception 'The PO PDF is required';
  end if;

  update public.fms_import_pos
     set tally_po_no   = nullif(p_tally_po_no,''),
         share_remarks = nullif(p_remarks,''),
         payment_terms = p_payment_terms,
         dispatch_date = p_dispatch_date,
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         -- Terms no longer drive the stage (no PI / advance step). The editable
         -- guard guarantees the PO is still pre-follow-up, so it stays at follow_up.
         current_stage = case when current_stage in ('share_po','collect_pi','advance_payment') then 'follow_up' else current_stage end,
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_po_id;

  perform public.fms_import_announce(
    'po', p_po_id, 'po_share_edited',
    format('Share details edited for %s', coalesce(v_po_no, 'the PO')),
    '{}'::uuid[],
    jsonb_build_object(
      'tally_po_no', nullif(p_tally_po_no,''),
      'payment_terms_from', v_old_terms,
      'payment_terms_to', p_payment_terms,
      'dispatch_date', p_dispatch_date,
      'document_replaced', (nullif(p_document_path,'') is not null and p_document_path is distinct from v_doc)
    )
  );
end $$;
grant execute on function public.fms_import_update_share_po(uuid, text, text, date, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Neuter the money-side create RPCs. PIs and payments are no longer part of
--    the flow; a stale client that still calls these gets a clear error instead
--    of silently creating an orphan row. Signatures frozen; update_pi /
--    update_payment are left as-is (unreachable, since no rows are ever created).
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_add_pi(
  p_po_id uuid,
  p_vendor_pi_no text,
  p_items jsonb,
  p_payment_terms text default 'on_delivery',
  p_pi_value numeric default 0,
  p_dispatch_date date default null,
  p_document_path text default null,
  p_document_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Import purchase is a quantity requisition — PIs are not part of the flow.';
end $$;
grant execute on function public.fms_import_add_pi(uuid, text, jsonb, text, numeric, date, text, text) to authenticated;

create or replace function public.fms_import_record_payment(
  p_po_id uuid, p_kind text, p_amount numeric,
  p_pi_id uuid default null, p_paid_on date default null, p_utr text default null,
  p_pi_remarks text default null,
  p_currency text default null, p_fx_rate numeric default null,
  p_amount_fx numeric default null, p_details text default null,
  p_advice_path text default null, p_advice_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Import purchase is a quantity requisition — payments are not part of the flow.';
end $$;
grant execute on function public.fms_import_record_payment(uuid, text, numeric, uuid, date, text, text, text, numeric, numeric, text, text, text) to authenticated;

commit;
