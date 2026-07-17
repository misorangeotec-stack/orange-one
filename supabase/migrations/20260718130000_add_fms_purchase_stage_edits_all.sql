-- ===========================================================================
-- Purchase FMS — stage history + edit-until-the-next-step for EVERY remaining
-- step. Companion to 20260718120000, which did share_po and set the pattern.
--
-- One `<step>_editable(id)` predicate + one `update_<step>(...)` RPC per step:
--   collect_pi · advance_payment · follow_up · inward · tally · approval · po
-- (`sourcing` needs neither — see section 6.)
--
-- THE RULES THIS ENFORCES, and the three traps they avoid:
--
--  1. TERMINAL IS AN ABSOLUTE BAR. fms_purchase_refresh_po() short-circuits on a
--     closed/cancelled PO ("terminal states are absorbing", 20260715120000), so an
--     edit there would silently skip every derived recompute — received_qty, PI
--     status, advance_paid — and drift the data. Mechanical, not a policy call.
--
--  2. SELF-EXCLUSION. record_payment's cap and record_grn's qty guard both sum
--     EVERY existing row. Reused verbatim for an edit they would double-count the
--     row being edited: nudging a payment 100 -> 101 would count the 100 twice and
--     reject. Every cap below carries `and id <> p_<row>_id`.
--
--  3. ATTRIBUTION IS HISTORY. An edit never rewrites created_by/created_at (or
--     shared_at/shared_by): "who did this step" and "who last corrected it" are
--     different questions. Corrections land in edited_at/edited_by — which is a
--     separate column from updated_at precisely because a set_updated_at TRIGGER
--     bumps that on every write, including refresh_po's own.
--
-- Every RPC: same authz as its create twin · re-checks the lock SERVER-side (the
-- disabled button is a courtesy, never the gate) · takes a row lock (the create
-- twins mostly don't — pre-existing, not re-plumbed here) · calls refresh_po ·
-- and writes its own activity row IN THIS TRANSACTION, because the client-side
-- announce used elsewhere is best-effort and swallows failures.
--
-- Additive / replace-only. Deploy BEFORE the frontend that calls these.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Shared helper: is this PO in a state where ANY edit is safe?
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_po_open(p_po_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_purchase_pos
                  where id = p_po_id and current_stage not in ('closed','cancelled'));
$$;
grant execute on function public.fms_purchase_po_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. COLLECT PI — a PI row.
--    Next step: an advance against THIS PI, or goods arriving at all.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_pi_editable(p_pi_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_pis pi
     where pi.id = p_pi_id
       and public.fms_purchase_po_open(pi.po_id)
       -- Goods received against the PO: the PI is what the receipt was checked
       -- against, so its quantities can no longer move.
       and not exists (select 1 from public.fms_purchase_grns g where g.po_id = pi.po_id)
       -- Money paid specifically against THIS PI.
       and not exists (select 1 from public.fms_purchase_payments x where x.pi_id = pi.id)
  );
$$;
grant execute on function public.fms_purchase_pi_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_pi(
  p_pi_id uuid,
  p_vendor_pi_no text,
  p_items jsonb,                                  -- [{po_item_id, qty}] — replaces the set
  p_payment_terms text default 'on_delivery',
  p_pi_value numeric default 0,
  p_dispatch_date date default null,
  p_document_path text default null,              -- null => keep the existing document
  p_document_name text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_elem jsonb; v_ordered numeric(14,3); v_poid uuid; v_covered numeric(14,3); v_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('collect_pi', auth.uid())) then
    raise exception 'Not authorized to edit PIs';
  end if;
  select po_id into v_po from public.fms_purchase_pis where id = p_pi_id for update;
  if v_po is null then raise exception 'PI not found'; end if;

  if not public.fms_purchase_pi_editable(p_pi_id) then
    if not public.fms_purchase_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its PI can no longer be edited.';
    end if;
    raise exception 'This PI can no longer be edited: work has already moved on (a payment against it, or goods received on this PO).';
  end if;
  if nullif(p_vendor_pi_no,'') is null then raise exception 'Vendor PI number is required'; end if;

  update public.fms_purchase_pis
     set vendor_pi_no  = p_vendor_pi_no,
         payment_terms = coalesce(nullif(p_payment_terms,''),'on_delivery'),
         pi_value      = coalesce(p_pi_value,0),
         dispatch_date = p_dispatch_date,
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_pi_id;

  -- Replace the covered lines wholesale. add_pi does no qty validation at all, so
  -- an over-stated PI silently sat 'open' forever; an edit is the natural place to
  -- stop that, and the cap must ignore THIS PI's own current rows.
  delete from public.fms_purchase_pi_items where pi_id = p_pi_id;
  if p_items is not null then
    for v_elem in select * from jsonb_array_elements(p_items) loop
      if coalesce((v_elem->>'qty')::numeric,0) <= 0 then continue; end if;
      select qty, po_id into v_ordered, v_poid
        from public.fms_purchase_po_items where id = (v_elem->>'po_item_id')::uuid;
      if v_poid is distinct from v_po then raise exception 'Line does not belong to this PO'; end if;
      select coalesce(sum(pii.qty),0) into v_covered
        from public.fms_purchase_pi_items pii
       where pii.po_item_id = (v_elem->>'po_item_id')::uuid and pii.pi_id <> p_pi_id;
      if v_covered + (v_elem->>'qty')::numeric > v_ordered + 0.001 then
        raise exception 'PI qty exceeds the ordered qty for a line';
      end if;
      insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty)
      values (p_pi_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'qty')::numeric);
    end loop;
  end if;

  perform public.fms_purchase_refresh_po(v_po);
  select vendor_pi_no into v_no from public.fms_purchase_pis where id = p_pi_id;
  perform public.fms_purchase_announce('pi', p_pi_id, 'pi_edited',
    format('PI %s edited', coalesce(v_no,'')), '{}'::uuid[],
    jsonb_build_object('po_id', v_po, 'pi_value', coalesce(p_pi_value,0)));
end $$;
grant execute on function public.fms_purchase_update_pi(uuid, text, jsonb, text, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ADVANCE PAYMENT — a payment row.
--    Next step: chasing dispatch, which the vendor only starts once paid.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_payment_editable(p_payment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_payments p
     where p.id = p_payment_id
       and public.fms_purchase_po_open(p.po_id)
       and not exists (select 1 from public.fms_purchase_followups f where f.po_id = p.po_id)
  );
$$;
grant execute on function public.fms_purchase_payment_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_utr text default null,
  p_pi_remarks text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_po uuid; v_pi uuid; v_total numeric(16,2); v_paid numeric(16,2);
  v_pi_value numeric(16,2); v_pi_paid numeric(16,2); v_old numeric(16,2); v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('advance_payment', auth.uid())) then
    raise exception 'Not authorized to edit payments';
  end if;
  select po_id, pi_id, amount into v_po, v_pi, v_old
    from public.fms_purchase_payments where id = p_payment_id for update;
  if v_po is null then raise exception 'Payment not found'; end if;

  if not public.fms_purchase_payment_editable(p_payment_id) then
    if not public.fms_purchase_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its payment can no longer be edited.';
    end if;
    raise exception 'This payment can no longer be edited: a follow-up has already been recorded against this PO.';
  end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be greater than 0'; end if;

  -- The cap, with THIS row excluded from the running total. record_payment's own
  -- version sums every row, which is correct for an insert and wrong for an edit.
  if v_pi is not null then
    select pi_value into v_pi_value from public.fms_purchase_pis where id = v_pi for update;
    select coalesce(sum(amount),0) into v_pi_paid
      from public.fms_purchase_payments where pi_id = v_pi and id <> p_payment_id;
    if v_pi_paid + p_amount > coalesce(v_pi_value,0) + 0.01 then
      raise exception 'Payment exceeds the PI pending amount';
    end if;
  else
    select total_value into v_total from public.fms_purchase_pos where id = v_po for update;
    select coalesce(sum(amount),0) into v_paid
      from public.fms_purchase_payments where po_id = v_po and id <> p_payment_id;
    if v_paid + p_amount > v_total + 0.01 then
      raise exception 'Payment exceeds the pending amount';
    end if;
  end if;

  update public.fms_purchase_payments
     set amount     = p_amount,
         paid_on    = coalesce(p_paid_on, paid_on),
         utr_ref    = nullif(p_utr,''),
         pi_remarks = nullif(p_pi_remarks,''),
         edited_at  = now(),
         edited_by  = auth.uid()
   where id = p_payment_id;

  perform public.fms_purchase_refresh_po(v_po);  -- re-sums pos.advance_paid
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('payment', p_payment_id, 'payment_edited',
    format('Payment on %s edited', coalesce(v_po_no,'the PO')), '{}'::uuid[],
    jsonb_build_object('po_id', v_po, 'amount_from', v_old, 'amount_to', p_amount));
end $$;
grant execute on function public.fms_purchase_update_payment(uuid, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. FOLLOW-UP — one follow-up row.
--    Next step: the goods actually landing.
--
--    ANY follow-up is editable, not just "the latest". There is no reliable
--    ordering to single out a latest one: created_at is now() (identical for two
--    rows written in one transaction) and the id is a random v4 uuid, so "latest"
--    is genuinely ambiguous. Same lock, no ambiguity, less code.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_followup_editable(p_followup_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_followups f
     where f.id = p_followup_id
       and public.fms_purchase_po_open(f.po_id)
       and not exists (select 1 from public.fms_purchase_grns g where g.po_id = f.po_id)
  );
$$;
grant execute on function public.fms_purchase_followup_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_followup(
  p_followup_id uuid,
  p_dispatch_status text,
  p_actual_dispatch_date date default null,
  p_lr_no text default '',
  p_transport text default '',
  p_revised_dispatch_date date default null,
  p_remarks text default '',
  p_pi_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_old text; v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('follow_up', auth.uid())) then
    raise exception 'Not authorized to edit follow-ups';
  end if;
  select po_id, dispatch_status into v_po, v_old
    from public.fms_purchase_followups where id = p_followup_id for update;
  if v_po is null then raise exception 'Follow-up not found'; end if;

  if not public.fms_purchase_followup_editable(p_followup_id) then
    if not public.fms_purchase_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its follow-up can no longer be edited.';
    end if;
    raise exception 'This follow-up can no longer be edited: goods have already been received against this PO.';
  end if;
  if p_dispatch_status not in ('pending','dispatched','delayed') then raise exception 'Invalid dispatch status'; end if;

  update public.fms_purchase_followups
     set dispatch_status       = p_dispatch_status,
         actual_dispatch_date  = p_actual_dispatch_date,
         revised_dispatch_date = p_revised_dispatch_date,
         lr_no                 = nullif(p_lr_no,''),
         transport_details     = nullif(p_transport,''),
         remarks               = nullif(p_remarks,''),
         pi_remarks            = nullif(p_pi_remarks,''),
         edited_at             = now(),
         edited_by             = auth.uid()
   where id = p_followup_id;

  -- Load-bearing: dispatch_status drives the stage, and un-setting 'dispatched'
  -- on the ONLY dispatched follow-up must walk the PO back out of Inward.
  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('po', v_po, 'followup_edited',
    format('Follow-up on %s edited', coalesce(v_po_no,'the PO')), '{}'::uuid[],
    jsonb_build_object('followup_id', p_followup_id, 'status_from', v_old, 'status_to', p_dispatch_status));
end $$;
grant execute on function public.fms_purchase_update_followup(uuid, text, date, text, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. INWARD — a GRN row.
--    Next step: that receipt being invoiced in Tally.
--
--    The riskiest RPC here: the only write that can make received_qty go DOWN.
--    Child rows and the refresh both happen in this one transaction, or a PO is
--    left parked on a stage its quantities no longer justify.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_grn_editable(p_grn_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_grns g
     where g.id = p_grn_id
       and public.fms_purchase_po_open(g.po_id)
       and not exists (select 1 from public.fms_purchase_tally_bookings t where t.grn_id = g.id)
  );
$$;
grant execute on function public.fms_purchase_grn_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_grn(
  p_grn_id uuid,
  p_items jsonb,                       -- [{po_item_id, received_qty, condition}] — replaces the set
  p_gate_register_no text default '',
  p_condition text default 'good',
  p_note text default '',
  p_pi_ref text default '',
  p_po_ref text default '',
  p_photo_path text default '',        -- '' / null => keep the existing photo
  p_photo_name text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_elem jsonb; v_ordered numeric(14,3); v_recv numeric(14,3); v_poid uuid; v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('inward', auth.uid())) then
    raise exception 'Not authorized to edit goods receipts';
  end if;
  select po_id into v_po from public.fms_purchase_grns where id = p_grn_id for update;
  if v_po is null then raise exception 'Goods receipt not found'; end if;

  if not public.fms_purchase_grn_editable(p_grn_id) then
    if not public.fms_purchase_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its goods receipt can no longer be edited.';
    end if;
    raise exception 'This goods receipt can no longer be edited: it has already been booked in Tally.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Record at least one received item'; end if;
  if nullif(p_po_ref,'') is null then raise exception 'The PO reference is required'; end if;

  update public.fms_purchase_grns
     set po_ref           = p_po_ref,
         pi_ref           = nullif(p_pi_ref,''),
         gate_register_no = nullif(p_gate_register_no,''),
         condition        = coalesce(nullif(p_condition,''),'good'),
         note             = nullif(p_note,''),
         photo_path       = coalesce(nullif(p_photo_path,''), photo_path),
         photo_name       = coalesce(nullif(p_photo_name,''), photo_name),
         edited_at        = now(),
         edited_by        = auth.uid()
   where id = p_grn_id;

  delete from public.fms_purchase_grn_items where grn_id = p_grn_id;
  for v_elem in select * from jsonb_array_elements(p_items) loop
    -- grn_items has `check (received_qty > 0)`, so a line edited to 0 is simply
    -- dropped rather than stored as a zero row; refresh_po re-sums from what's left.
    if coalesce((v_elem->>'received_qty')::numeric,0) <= 0 then continue; end if;
    select qty, po_id into v_ordered, v_poid from public.fms_purchase_po_items where id = (v_elem->>'po_item_id')::uuid;
    if v_poid is distinct from v_po then raise exception 'Line does not belong to this PO'; end if;
    -- Self-excluded: the rows for THIS GRN were just deleted, so `v_recv` is what
    -- the OTHER receipts hold. Raising a qty re-checks the ordered cap correctly.
    select coalesce(sum(received_qty),0) into v_recv
      from public.fms_purchase_grn_items where po_item_id = (v_elem->>'po_item_id')::uuid;
    if v_recv + (v_elem->>'received_qty')::numeric > v_ordered + 0.001 then
      raise exception 'Received qty exceeds ordered qty for a line';
    end if;
    insert into public.fms_purchase_grn_items (grn_id, po_item_id, received_qty, condition)
    values (p_grn_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'received_qty')::numeric,
            coalesce(nullif(v_elem->>'condition',''),'good'));
  end loop;

  perform public.fms_purchase_refresh_po(v_po);
  select po_no into v_po_no from public.fms_purchase_pos where id = v_po;
  perform public.fms_purchase_announce('grn', p_grn_id, 'grn_edited',
    format('Goods receipt on %s edited', coalesce(v_po_no,'the PO')), '{}'::uuid[],
    jsonb_build_object('po_id', v_po));
end $$;
grant execute on function public.fms_purchase_update_grn(uuid, jsonb, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. TALLY — a booking row. The last step, so nothing downstream locks it; the
--    PO closing does.
--
--    grn_id is NOT editable, deliberately. Moving a booking between receipts
--    would silently un-book the old one, and book_tally's "already booked" guard
--    would false-positive on the row's own id. Which receipt an invoice belongs to
--    is not a typo — delete and re-book if it is genuinely wrong.
--
--    Known sharp edge: booking the FINAL receipt closes the PO in this same
--    transaction, so that booking's edit window can be nil. Bookings made while
--    goods are still arriving stay editable normally.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_tally_editable(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_tally_bookings t
     where t.id = p_booking_id and public.fms_purchase_po_open(t.po_id)
  );
$$;
grant execute on function public.fms_purchase_tally_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_tally(
  p_booking_id uuid,
  p_tally_pi_no text,
  p_document_path text default null,   -- null => keep the existing invoice document
  p_document_name text default null,
  p_remarks text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_old text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('tally', auth.uid())) then
    raise exception 'Not authorized to edit Tally bookings';
  end if;
  select po_id, tally_pi_no into v_po, v_old
    from public.fms_purchase_tally_bookings where id = p_booking_id for update;
  if v_po is null then raise exception 'Tally booking not found'; end if;

  if not public.fms_purchase_tally_editable(p_booking_id) then
    raise exception 'This PO is closed or cancelled — its Tally booking can no longer be edited.';
  end if;
  if nullif(p_tally_pi_no,'') is null then raise exception 'Tally invoice number is required'; end if;

  update public.fms_purchase_tally_bookings
     set tally_pi_no   = p_tally_pi_no,
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         remarks       = nullif(p_remarks,''),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_booking_id;

  perform public.fms_purchase_refresh_po(v_po);
  perform public.fms_purchase_announce('po', v_po, 'tally_edited',
    format('Tally booking edited to %s', p_tally_pi_no), '{}'::uuid[],
    jsonb_build_object('booking_id', p_booking_id, 'invoice_from', v_old, 'invoice_to', p_tally_pi_no));
end $$;
grant execute on function public.fms_purchase_update_tally(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. SOURCING — a request line's sourcing fields.
--    Next step: the approver deciding.
--
--    NO update RPC: fms_purchase_save_sourcing already IS the edit. It accepts
--    status in ('sourcing','approval','on_hold') and refuses anything further on,
--    which is exactly "editable until approved" — and re-sourcing already restarts
--    sourced_at/sourced_by by design. Only the predicate is new, so the UI can
--    show the same rule the RPC will enforce.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_sourcing_editable(p_line_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_request_items ri
     where ri.id = p_line_id
       and ri.sourced_at is not null            -- the step must be DONE to be edited
       and ri.status in ('approval','on_hold')  -- ...and not yet decided
  );
$$;
grant execute on function public.fms_purchase_sourcing_editable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. APPROVAL — a request line's decision.
--    Next step: the PO being generated.
--
--    Editable ONLY while status = 'approved_pending_po' (approved, no PO yet).
--    Note what is NOT the rule: "locked once approved_at is set" would lock the
--    decision the instant it was made, and "locked once a PO exists" would leave
--    REJECTED lines editable forever, since a rejected line never gets a PO.
--    Rejected/cancelled are terminal here: no un-reject path exists anywhere in
--    the app today, and this migration does not invent one.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_approval_editable(p_line_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_request_items ri
     where ri.id = p_line_id and ri.status = 'approved_pending_po'
  );
$$;
grant execute on function public.fms_purchase_approval_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_approval(
  p_line_id uuid,
  p_decision text,                        -- 'approve' | 'override' | 'reject'
  p_override_vendor_id uuid default null,
  p_reason text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_value numeric(16,2); v_approver uuid; v_tier text;
  v_qrate numeric(14,2); v_qgst numeric(6,2); v_assigned uuid;
begin
  select status, line_value, assigned_approver_id into v_status, v_value, v_assigned
    from public.fms_purchase_request_items where id = p_line_id for update;
  if v_status is null then raise exception 'Line not found'; end if;

  if not public.fms_purchase_approval_editable(p_line_id) then
    if v_status = 'po' then
      raise exception 'The PO has already been generated for this line — the approval can no longer be changed.';
    elsif v_status in ('rejected','cancelled') then
      raise exception 'This line is % — its approval can no longer be changed.', v_status;
    end if;
    raise exception 'This line is not an approved decision awaiting its PO (status %).', v_status;
  end if;

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
          or (v_assigned is not null and v_assigned = auth.uid())) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_purchase_quotations
      where request_item_id = p_line_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_purchase_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_line_id;
    update public.fms_purchase_request_items
       set final_vendor_id = p_override_vendor_id, final_rate = v_qrate, gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;

  elsif p_decision = 'reject' then
    -- Reversing an approval to a rejection. approved_at is cleared: the line is no
    -- longer approved, and leaving a stale stamp would date a decision that was
    -- withdrawn.
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null, assigned_approver_id = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;
  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_purchase_announce('line', p_line_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision));
end $$;
grant execute on function public.fms_purchase_update_approval(uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. PO GENERATION — the PO row itself.
--    Next step: sharing it with the vendor.
--
--    Only po_no is amendable: vendor / company / lines are what the PO IS, and
--    changing them is a cancel-and-regenerate, not a correction.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_po_editable(p_po_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_purchase_pos po
     where po.id = p_po_id
       and po.shared_at is null                          -- not yet sent to the vendor
       and po.current_stage not in ('closed','cancelled')
  );
$$;
grant execute on function public.fms_purchase_po_editable(uuid) to authenticated;

create or replace function public.fms_purchase_update_po_no(p_po_id uuid, p_po_no text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to edit POs';
  end if;
  select po_no into v_old from public.fms_purchase_pos where id = p_po_id for update;
  if v_old is null then raise exception 'PO not found'; end if;

  if not public.fms_purchase_po_editable(p_po_id) then
    raise exception 'This PO has already been shared with the vendor — its number can no longer be changed.';
  end if;
  if nullif(p_po_no,'') is null then raise exception 'PO number is required'; end if;
  if exists (select 1 from public.fms_purchase_pos where po_no = p_po_no and id <> p_po_id) then
    raise exception 'That PO number already exists';
  end if;

  update public.fms_purchase_pos
     set po_no = p_po_no, edited_at = now(), edited_by = auth.uid()
   where id = p_po_id;

  perform public.fms_purchase_announce('po', p_po_id, 'po_no_edited',
    format('PO number changed from %s to %s', v_old, p_po_no), '{}'::uuid[],
    jsonb_build_object('po_no_from', v_old, 'po_no_to', p_po_no));
end $$;
grant execute on function public.fms_purchase_update_po_no(uuid, text) to authenticated;
