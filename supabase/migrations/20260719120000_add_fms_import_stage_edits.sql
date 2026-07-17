-- ===========================================================================
-- Import Purchase FMS — stage history + edit-until-the-next-step.
--
-- WHY
-- Every stage screen is a pending-only queue: the instant an owner completes
-- their action the row disappears and they can never see, let alone correct,
-- what they did. This is the Import twin of the Purchase FMS work that shipped
-- in 20260718120000 / 20260718130000 / 20260718140000, and it lands all three
-- of those at once (Import has no legacy to stage the rollout around).
--
-- WHAT'S HERE
--   1. shared_by — the one step that records WHEN but not WHO.
--   2. edited_at / edited_by on every table an edit can touch.
--   3. share_po replaced: stamps shared_by AND closes the re-share hole.
--   4. One <step>_editable(id) predicate + one update_<step>(...) RPC per step:
--      share_po · collect_pi · advance_payment · follow_up · inward · tally ·
--      approval · po
--
-- WHERE IMPORT DIFFERS FROM PURCHASE — and it is exactly one place:
--   • NO SOURCING STEP. The vendor and rate come from the price master, so a
--     line is born at 'approval' (see 20260716130100). fms_import_save_sourcing
--     still exists but nothing routes to it, so there is no sourcing_editable
--     here — a predicate for a queue that does not exist is dead weight.
--   • THE PAYMENT CAP IS IN THE VENDOR'S CURRENCY, NOT INR. record_payment caps
--     amount_fx against pos.total_value_fx precisely because the FX rate at
--     payment differs from the rate at request, so an INR cap would wrongly
--     reject a full 100% advance whenever the currency has appreciated
--     (20260716130100). update_payment MUST cap the same way. This is the one
--     rule that does not port from Purchase by rename.
-- Everything else is Purchase's logic with the fms_purchase_ -> fms_import_
-- rename: the step graph, the terminal-is-absorbing bar, and the FX/100%-advance
-- differences live in files this feature does not touch.
--
-- THE RULES THIS ENFORCES, and the three traps they avoid:
--
--  1. TERMINAL IS AN ABSOLUTE BAR. fms_import_refresh_po() short-circuits on a
--     closed/cancelled PO ("Terminal states are absorbing", 20260716121000), so
--     an edit there would silently skip every derived recompute — received_qty,
--     advance_paid, the stage itself — and drift the data. Mechanical, not a
--     policy call.
--
--  2. SELF-EXCLUSION. record_payment's cap and record_grn's qty guard both sum
--     EVERY existing row. Reused verbatim for an edit they would double-count
--     the row being edited: nudging a payment USD 100 -> 101 would count the 100
--     twice and reject. Every cap below carries `and id <> p_<row>_id`.
--
--  3. ATTRIBUTION IS HISTORY. An edit never rewrites created_by/created_at (or
--     shared_at/shared_by): "who did this step" and "who last corrected it" are
--     different questions. Corrections land in edited_at/edited_by — a separate
--     column from updated_at precisely because a set_updated_at TRIGGER bumps
--     that on every write, including refresh_po's own.
--
-- Every RPC: same authz as its create twin · re-checks the lock SERVER-side (the
-- disabled button is a courtesy, never the gate) · takes a row lock · calls
-- refresh_po · and writes its own activity row IN THIS TRANSACTION, because the
-- client-side announce used elsewhere is best-effort and swallows failures.
--
-- Additive / replace-only: no table, column or row of business data is dropped
-- or mutated. Existing rows keep NULL actors — we do NOT guess who did
-- something. They stay visible under "All", just not under "Mine".
--
-- Deploy ordering: apply BEFORE the frontend that reads these columns.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Actor column.
--
-- Seven of the eight steps already record their actor on the domain row
-- (pis.created_by, payments.created_by, grns.received_by,
-- tally_bookings.booked_by, followups.created_by, request_items.approver_id,
-- pos.created_by). Exactly one records a timestamp with no actor.
--
-- NOT adding sourced_by: Import has no sourcing step.
-- ---------------------------------------------------------------------------
alter table public.fms_import_pos
  add column if not exists shared_by uuid references auth.users on delete set null;

comment on column public.fms_import_pos.shared_by is
  'Who shared the PO with the vendor. Pairs with shared_at. NULL for rows shared before this column existed — deliberately not backfilled.';

-- ---------------------------------------------------------------------------
-- 2. Edit audit columns, on every table a stage edit can touch.
--
-- NAMED `edited_*`, NOT `updated_*`, and that is load-bearing. Several of these
-- tables already carry an `updated_at` maintained by a `set_updated_at` TRIGGER
-- that fires on EVERY row touch — including refresh_po()'s writes. So
-- `updated_at` answers "when was this row last written", which is not the
-- question: pairing it with an actor would display a real editor's name against
-- a timestamp from an unrelated automatic recompute. `edited_at` is written only
-- by the update_* RPCs below, so "edited_by X at edited_at" is always true.
-- ---------------------------------------------------------------------------
alter table public.fms_import_pos             add column if not exists edited_at timestamptz,
                                              add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_import_pis             add column if not exists edited_at timestamptz,
                                              add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_import_payments        add column if not exists edited_at timestamptz,
                                              add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_import_followups       add column if not exists edited_at timestamptz,
                                              add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_import_grns            add column if not exists edited_at timestamptz,
                                              add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_import_tally_bookings  add column if not exists edited_at timestamptz,
                                              add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_import_request_items   add column if not exists edited_at timestamptz,
                                              add column if not exists edited_by uuid references auth.users on delete set null;

comment on column public.fms_import_pos.edited_at is
  'When a stage entry on this row was last CORRECTED via an update_* RPC. Distinct from updated_at, which a trigger bumps on every write.';

-- ---------------------------------------------------------------------------
-- 3. share_po — stamp shared_by, and close the re-share hole.
--
-- THE BUG (live until this migration, inherited from Purchase's 20260716120300
-- lineage): share_po has never guarded against running twice. Its UPDATE is
-- unconditional on the PO id, so a second call silently overwrites
-- document_path / document_name / tally_po_no / share_remarks / payment_terms /
-- dispatch_date — at ANY point in the PO's life. After the PI is collected.
-- After the advance is paid. After the goods have landed. Nothing stopped it.
--
-- Only `shared_at` was protected (coalesce), which made the damage worse rather
-- than better: the PO's terms could change while its "shared on" stamp still
-- pointed at the original moment, so the record looked untouched.
--
-- No UI reaches this today — both callers gate on current_stage = 'share_po' —
-- so it was reachable via a direct RPC call or a stale client. That is exactly
-- the kind of hole that stays harmless right up until it isn't.
--
-- THE FIX: share_po becomes what its name says — the STEP, performable once.
-- Corrections go through update_share_po below. A clean split:
--   • share_po        — do the step. Once.
--   • update_share_po — amend it, while amending is still safe.
--
-- Also adds the `for update` this function never had: without it, two owners
-- sharing the same PO at once could both pass the new guard.
--
-- Body otherwise carried forward verbatim from 20260716122500.
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

  -- Lock first: the guard below is a check-then-write, so without this two
  -- concurrent shares could both read a null shared_at and both proceed.
  select shared_at, current_stage into v_shared_at, v_stage
    from public.fms_import_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % — it can no longer be shared.', v_stage;
  end if;

  -- THE GUARD. Sharing is a one-time step; changing what was recorded is an edit.
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
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
         document_path = nullif(p_document_path,''),
         document_name = nullif(p_document_name,''),
         tally_po_no   = nullif(p_tally_po_no,''),
         share_remarks = nullif(p_remarks,''),
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms),
         dispatch_date = p_dispatch_date,
         -- Kept as coalesce rather than a bare now()/auth.uid(): the guard above
         -- already makes this the first share, so the two are equivalent — but if
         -- the guard is ever relaxed, these must still not steal attribution.
         shared_at     = coalesce(shared_at, now()),
         shared_by     = coalesce(shared_by, auth.uid())
   where id = p_po_id;
end $$;
grant execute on function public.fms_import_share_po(uuid, text, text, text, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Shared helper: is this PO in a state where ANY edit is safe?
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_po_open(p_po_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_import_pos
                  where id = p_po_id and current_stage not in ('closed','cancelled'));
$$;
grant execute on function public.fms_import_po_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. SHARE PO — the PO's share fields.
--
-- Editable until the NEXT step has been done. "The next step" is NOT simply
-- collect_pi: the flow can legitimately skip ahead (an advance paid, or goods
-- landing, before any PI), and each of those is downstream work that a changed
-- PO document would invalidate. So the rule is "no downstream artifact of any
-- kind exists yet".
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_share_po_editable(p_po_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_pos po
     where po.id = p_po_id
       and po.shared_at is not null                       -- the step must be DONE to be edited
       and po.current_stage not in ('closed','cancelled') -- terminal is absorbing
       and not exists (select 1 from public.fms_import_pis        x where x.po_id = po.id)
       and not exists (select 1 from public.fms_import_payments   x where x.po_id = po.id)
       and not exists (select 1 from public.fms_import_followups  x where x.po_id = po.id)
       and not exists (select 1 from public.fms_import_grns       x where x.po_id = po.id)
  );
$$;
grant execute on function public.fms_import_share_po_editable(uuid) to authenticated;

comment on function public.fms_import_share_po_editable(uuid) is
  'True while the Share PO entry may still be corrected: shared, not terminal, and no PI / payment / follow-up / GRN downstream of it yet.';

-- p_document_path NULL => keep the existing document (the user didn't pick a new
-- file). Passing a new path does NOT delete the old object: uploads are
-- immutable, timestamp-named keys, and the superseded file is left in place on
-- purpose — document history is the point of the Completed view.
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
    raise exception 'The share details can no longer be edited: work has already moved on (a PI, payment, follow-up or goods receipt exists against this PO).';
  end if;

  if nullif(p_tally_po_no,'') is null then raise exception 'The Tally PO number is required'; end if;
  if p_dispatch_date is null then raise exception 'The expected dispatch date is required'; end if;
  if nullif(p_payment_terms,'') is null
     or p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;
  -- A shared PO must always have its PDF. Keeping the old one is fine; ending up
  -- with none is not.
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
         -- Terms drive the stage, so a terms edit must re-derive it. The lock
         -- above guarantees no PI / payment / follow-up / GRN exists, so the PO
         -- is necessarily pre-receipt and the stage is fully determined by the
         -- new terms alone. That is why this is a direct assignment and not a
         -- refresh_po() call: there are no children to recompute, and refresh_po
         -- only ever moves these early stages FORWARD — it could not walk an
         -- advance_payment PO back to collect_pi if the terms lost their advance.
         current_stage = case
           when p_payment_terms in ('full_advance','partial_advance') then 'advance_payment'
           else 'collect_pi' end,
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_po_id;

  -- In-transaction audit. If this fails, the edit fails — by design.
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
-- 6. COLLECT PI — a PI row.
--    Next step: an advance against THIS PI, or goods arriving at all.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_pi_editable(p_pi_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_pis pi
     where pi.id = p_pi_id
       and public.fms_import_po_open(pi.po_id)
       -- Goods received against the PO: the PI is what the receipt was checked
       -- against, so its quantities can no longer move.
       and not exists (select 1 from public.fms_import_grns g where g.po_id = pi.po_id)
       -- Money paid specifically against THIS PI.
       and not exists (select 1 from public.fms_import_payments x where x.pi_id = pi.id)
  );
$$;
grant execute on function public.fms_import_pi_editable(uuid) to authenticated;

create or replace function public.fms_import_update_pi(
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
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('collect_pi', auth.uid())) then
    raise exception 'Not authorized to edit PIs';
  end if;
  select po_id into v_po from public.fms_import_pis where id = p_pi_id for update;
  if v_po is null then raise exception 'PI not found'; end if;

  if not public.fms_import_pi_editable(p_pi_id) then
    if not public.fms_import_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its PI can no longer be edited.';
    end if;
    raise exception 'This PI can no longer be edited: work has already moved on (a payment against it, or goods received on this PO).';
  end if;
  if nullif(p_vendor_pi_no,'') is null then raise exception 'Vendor PI number is required'; end if;

  update public.fms_import_pis
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
  delete from public.fms_import_pi_items where pi_id = p_pi_id;
  if p_items is not null then
    for v_elem in select * from jsonb_array_elements(p_items) loop
      if coalesce((v_elem->>'qty')::numeric,0) <= 0 then continue; end if;
      select qty, po_id into v_ordered, v_poid
        from public.fms_import_po_items where id = (v_elem->>'po_item_id')::uuid;
      if v_poid is distinct from v_po then raise exception 'Line does not belong to this PO'; end if;
      select coalesce(sum(pii.qty),0) into v_covered
        from public.fms_import_pi_items pii
       where pii.po_item_id = (v_elem->>'po_item_id')::uuid and pii.pi_id <> p_pi_id;
      if v_covered + (v_elem->>'qty')::numeric > v_ordered + 0.001 then
        raise exception 'PI qty exceeds the ordered qty for a line';
      end if;
      insert into public.fms_import_pi_items (pi_id, po_item_id, qty)
      values (p_pi_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'qty')::numeric);
    end loop;
  end if;

  perform public.fms_import_refresh_po(v_po);
  select vendor_pi_no into v_no from public.fms_import_pis where id = p_pi_id;
  perform public.fms_import_announce('pi', p_pi_id, 'pi_edited',
    format('PI %s edited', coalesce(v_no,'')), '{}'::uuid[],
    jsonb_build_object('po_id', v_po, 'pi_value', coalesce(p_pi_value,0)));
end $$;
grant execute on function public.fms_import_update_pi(uuid, text, jsonb, text, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. PAYMENT (step_key 'advance_payment', titled "Payment") — a payment row.
--    Next step: chasing dispatch, which the vendor only starts once paid.
--
--    ⚠ THE ONE RULE THAT DOES NOT PORT FROM PURCHASE BY RENAME.
--    The cap is on the FOREIGN amount vs the PO's foreign value, NOT on INR —
--    mirroring record_payment (20260716130100). The FX rate at payment is
--    independent of the rate at request, so an INR cap would wrongly reject a
--    full 100% advance whenever the currency has appreciated since the request.
--    Import always pays whole-PO (p_pi_id is null), so the cap sums by po_id and
--    ignores pi_id, exactly as record_payment does.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_payment_editable(p_payment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_payments p
     where p.id = p_payment_id
       and public.fms_import_po_open(p.po_id)
       and not exists (select 1 from public.fms_import_followups f where f.po_id = p.po_id)
  );
$$;
grant execute on function public.fms_import_payment_editable(uuid) to authenticated;

create or replace function public.fms_import_update_payment(
  p_payment_id uuid,
  p_amount numeric,                     -- INR equivalent
  p_amount_fx numeric default null,     -- the vendor-currency amount actually paid
  p_currency text default null,
  p_fx_rate numeric default null,
  p_paid_on date default null,
  p_utr text default null,
  p_pi_remarks text default null,
  p_details text default null,
  p_advice_path text default null,      -- null/'' => keep the existing advice document
  p_advice_name text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_po uuid; v_total_fx numeric(16,2); v_paid_fx numeric(16,2);
  v_old numeric(16,2); v_old_fx numeric(16,2); v_po_no text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('advance_payment', auth.uid())) then
    raise exception 'Not authorized to edit payments';
  end if;
  select po_id, amount, amount_fx into v_po, v_old, v_old_fx
    from public.fms_import_payments where id = p_payment_id for update;
  if v_po is null then raise exception 'Payment not found'; end if;

  if not public.fms_import_payment_editable(p_payment_id) then
    if not public.fms_import_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its payment can no longer be edited.';
    end if;
    raise exception 'This payment can no longer be edited: a follow-up has already been recorded against this PO.';
  end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be greater than 0'; end if;

  -- The cap, with THIS row excluded from the running total. record_payment's own
  -- version sums every row, which is correct for an insert and wrong for an edit.
  select total_value_fx into v_total_fx from public.fms_import_pos where id = v_po for update;
  select coalesce(sum(amount_fx),0) into v_paid_fx
    from public.fms_import_payments where po_id = v_po and id <> p_payment_id;
  if p_amount_fx is not null and coalesce(v_total_fx,0) > 0
     and v_paid_fx + p_amount_fx > v_total_fx + 0.01 then
    raise exception 'Payment exceeds the PO value (% paid of %)', v_paid_fx + p_amount_fx, v_total_fx;
  end if;

  update public.fms_import_payments
     set amount      = p_amount,
         amount_fx   = coalesce(p_amount_fx, amount_fx),
         currency    = coalesce(nullif(p_currency,''), currency),
         fx_rate     = coalesce(p_fx_rate, fx_rate),
         inr_amount  = p_amount,          -- mirrors record_payment: inr_amount tracks `amount`
         paid_on     = coalesce(p_paid_on, paid_on),
         utr_ref     = nullif(p_utr,''),
         pi_remarks  = nullif(p_pi_remarks,''),
         details     = nullif(p_details,''),
         advice_path = coalesce(nullif(p_advice_path,''), advice_path),
         advice_name = coalesce(nullif(p_advice_name,''), advice_name),
         edited_at   = now(),
         edited_by   = auth.uid()
   where id = p_payment_id;

  perform public.fms_import_refresh_po(v_po);  -- re-sums pos.advance_paid
  select po_no into v_po_no from public.fms_import_pos where id = v_po;
  perform public.fms_import_announce('payment', p_payment_id, 'payment_edited',
    format('Payment on %s edited', coalesce(v_po_no,'the PO')), '{}'::uuid[],
    jsonb_build_object('po_id', v_po, 'amount_from', v_old, 'amount_to', p_amount,
                       'amount_fx_from', v_old_fx, 'amount_fx_to', p_amount_fx));
end $$;
grant execute on function public.fms_import_update_payment(uuid, numeric, numeric, text, numeric, date, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. FOLLOW-UP — one follow-up row.
--    Next step: the goods actually landing.
--
--    ANY follow-up is editable, not just "the latest". There is no reliable
--    ordering to single out a latest one: created_at is now() (identical for two
--    rows written in one transaction) and the id is a random v4 uuid, so "latest"
--    is genuinely ambiguous. Same lock, no ambiguity, less code.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_followup_editable(p_followup_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_followups f
     where f.id = p_followup_id
       and public.fms_import_po_open(f.po_id)
       and not exists (select 1 from public.fms_import_grns g where g.po_id = f.po_id)
  );
$$;
grant execute on function public.fms_import_followup_editable(uuid) to authenticated;

create or replace function public.fms_import_update_followup(
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
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('follow_up', auth.uid())) then
    raise exception 'Not authorized to edit follow-ups';
  end if;
  select po_id, dispatch_status into v_po, v_old
    from public.fms_import_followups where id = p_followup_id for update;
  if v_po is null then raise exception 'Follow-up not found'; end if;

  if not public.fms_import_followup_editable(p_followup_id) then
    if not public.fms_import_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its follow-up can no longer be edited.';
    end if;
    raise exception 'This follow-up can no longer be edited: goods have already been received against this PO.';
  end if;
  if p_dispatch_status not in ('pending','dispatched','delayed') then raise exception 'Invalid dispatch status'; end if;

  update public.fms_import_followups
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
  perform public.fms_import_refresh_po(v_po);
  select po_no into v_po_no from public.fms_import_pos where id = v_po;
  perform public.fms_import_announce('po', v_po, 'followup_edited',
    format('Follow-up on %s edited', coalesce(v_po_no,'the PO')), '{}'::uuid[],
    jsonb_build_object('followup_id', p_followup_id, 'status_from', v_old, 'status_to', p_dispatch_status));
end $$;
grant execute on function public.fms_import_update_followup(uuid, text, date, text, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. INWARD — a GRN row.
--    Next step: that receipt being invoiced in Tally.
--
--    The riskiest RPC here: the only write that can make received_qty go DOWN.
--    Child rows and the refresh both happen in this one transaction, or a PO is
--    left parked on a stage its quantities no longer justify.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_grn_editable(p_grn_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_grns g
     where g.id = p_grn_id
       and public.fms_import_po_open(g.po_id)
       and not exists (select 1 from public.fms_import_tally_bookings t where t.grn_id = g.id)
  );
$$;
grant execute on function public.fms_import_grn_editable(uuid) to authenticated;

create or replace function public.fms_import_update_grn(
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
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('inward', auth.uid())) then
    raise exception 'Not authorized to edit goods receipts';
  end if;
  select po_id into v_po from public.fms_import_grns where id = p_grn_id for update;
  if v_po is null then raise exception 'Goods receipt not found'; end if;

  if not public.fms_import_grn_editable(p_grn_id) then
    if not public.fms_import_po_open(v_po) then
      raise exception 'This PO is closed or cancelled — its goods receipt can no longer be edited.';
    end if;
    raise exception 'This goods receipt can no longer be edited: it has already been booked in Tally.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Record at least one received item'; end if;
  if nullif(p_po_ref,'') is null then raise exception 'The PO reference is required'; end if;

  update public.fms_import_grns
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

  delete from public.fms_import_grn_items where grn_id = p_grn_id;
  for v_elem in select * from jsonb_array_elements(p_items) loop
    -- grn_items has `check (received_qty > 0)`, so a line edited to 0 is simply
    -- dropped rather than stored as a zero row; refresh_po re-sums from what's left.
    if coalesce((v_elem->>'received_qty')::numeric,0) <= 0 then continue; end if;
    select qty, po_id into v_ordered, v_poid from public.fms_import_po_items where id = (v_elem->>'po_item_id')::uuid;
    if v_poid is distinct from v_po then raise exception 'Line does not belong to this PO'; end if;
    -- Self-excluded: the rows for THIS GRN were just deleted, so `v_recv` is what
    -- the OTHER receipts hold. Raising a qty re-checks the ordered cap correctly.
    select coalesce(sum(received_qty),0) into v_recv
      from public.fms_import_grn_items where po_item_id = (v_elem->>'po_item_id')::uuid;
    if v_recv + (v_elem->>'received_qty')::numeric > v_ordered + 0.001 then
      raise exception 'Received qty exceeds ordered qty for a line';
    end if;
    insert into public.fms_import_grn_items (grn_id, po_item_id, received_qty, condition)
    values (p_grn_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'received_qty')::numeric,
            coalesce(nullif(v_elem->>'condition',''),'good'));
  end loop;

  perform public.fms_import_refresh_po(v_po);
  select po_no into v_po_no from public.fms_import_pos where id = v_po;
  perform public.fms_import_announce('grn', p_grn_id, 'grn_edited',
    format('Goods receipt on %s edited', coalesce(v_po_no,'the PO')), '{}'::uuid[],
    jsonb_build_object('po_id', v_po));
end $$;
grant execute on function public.fms_import_update_grn(uuid, jsonb, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. TALLY — a booking row. The last step, so nothing downstream locks it; the
--     PO closing does.
--
--     grn_id is NOT editable, deliberately. Moving a booking between receipts
--     would silently un-book the old one, and book_tally's "already booked" guard
--     would false-positive on the row's own id. Which receipt an invoice belongs
--     to is not a typo — delete and re-book if it is genuinely wrong.
--
--     Known sharp edge: booking the FINAL receipt closes the PO in this same
--     transaction, so that booking's edit window can be nil. Bookings made while
--     goods are still arriving stay editable normally. Same as Purchase's, and
--     accepted there.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_tally_editable(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_tally_bookings t
     where t.id = p_booking_id and public.fms_import_po_open(t.po_id)
  );
$$;
grant execute on function public.fms_import_tally_editable(uuid) to authenticated;

create or replace function public.fms_import_update_tally(
  p_booking_id uuid,
  p_tally_pi_no text,
  p_document_path text default null,   -- null => keep the existing invoice document
  p_document_name text default null,
  p_remarks text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_old text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('tally', auth.uid())) then
    raise exception 'Not authorized to edit Tally bookings';
  end if;
  select po_id, tally_pi_no into v_po, v_old
    from public.fms_import_tally_bookings where id = p_booking_id for update;
  if v_po is null then raise exception 'Tally booking not found'; end if;

  if not public.fms_import_tally_editable(p_booking_id) then
    raise exception 'This PO is closed or cancelled — its Tally booking can no longer be edited.';
  end if;
  if nullif(p_tally_pi_no,'') is null then raise exception 'Tally invoice number is required'; end if;

  update public.fms_import_tally_bookings
     set tally_pi_no   = p_tally_pi_no,
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         remarks       = nullif(p_remarks,''),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_booking_id;

  perform public.fms_import_refresh_po(v_po);
  perform public.fms_import_announce('po', v_po, 'tally_edited',
    format('Tally booking edited to %s', p_tally_pi_no), '{}'::uuid[],
    jsonb_build_object('booking_id', p_booking_id, 'invoice_from', v_old, 'invoice_to', p_tally_pi_no));
end $$;
grant execute on function public.fms_import_update_tally(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. APPROVAL — a request line's decision.
--     Next step: the PO being generated.
--
--     Editable ONLY while status = 'approved_pending_po' (approved, no PO yet).
--     Note what is NOT the rule: "locked once approved_at is set" would lock the
--     decision the instant it was made, and "locked once a PO exists" would leave
--     REJECTED lines editable forever, since a rejected line never gets a PO.
--     Rejected/cancelled are terminal here: no un-reject path exists anywhere in
--     the app today, and this migration does not invent one.
--
--     Import has no sourcing step, so this is the FIRST editable step in the
--     flow — there is no sourcing_editable predicate below (Purchase has one; a
--     predicate for a queue that does not exist would be dead weight).
--
--     NO 'override' DECISION, unlike Purchase's update_approval. Override swaps
--     the line to another QUOTED vendor, and Import has no quotations: the only
--     writer of fms_import_quotations is save_sourcing, which nothing routes to
--     (no Sourcing queue). So the branch cannot succeed — decide_approval's own
--     override already dead-ends on 'Override vendor must be one of the quoted
--     vendors', and the modal's vendor picker renders empty. Import chooses its
--     vendor on the request header from the price master; overriding here was
--     never meaningful.
--
--     Deliberately NOT copied, and NOT silently "fixed" either: decide_approval's
--     override branch predates the FX migration (20260716130100) and recomputes
--     line_value from the FOREIGN formula without applying fx_rate_at_request,
--     and never writes line_value_fx at all. That is a real pre-existing defect,
--     but it lives in unreachable code and fixing it here would make the edit
--     path silently disagree with its create twin. Flagged, not touched.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_approval_editable(p_line_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_request_items ri
     where ri.id = p_line_id and ri.status = 'approved_pending_po'
  );
$$;
grant execute on function public.fms_import_approval_editable(uuid) to authenticated;

create or replace function public.fms_import_update_approval(
  p_line_id uuid,
  p_decision text,                        -- 'approve' | 'reject'
  p_override_vendor_id uuid default null, -- accepted but unused; see the note above
  p_reason text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_value numeric(16,2); v_approver uuid; v_tier text; v_assigned uuid;
begin
  select status, line_value, assigned_approver_id into v_status, v_value, v_assigned
    from public.fms_import_request_items where id = p_line_id for update;
  if v_status is null then raise exception 'Line not found'; end if;

  if not public.fms_import_approval_editable(p_line_id) then
    if v_status = 'po' then
      raise exception 'The PO has already been generated for this line — the approval can no longer be changed.';
    elsif v_status in ('rejected','cancelled') then
      raise exception 'This line is % — its approval can no longer be changed.', v_status;
    end if;
    raise exception 'This line is not an approved decision awaiting its PO (status %).', v_status;
  end if;

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
          or (v_assigned is not null and v_assigned = auth.uid())) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' then
    update public.fms_import_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;

  elsif p_decision = 'override' then
    raise exception 'Import POs have no quoted vendors to override — the vendor comes from the request and the price master. Cancel the line and raise a new request if the vendor is wrong.';

  elsif p_decision = 'reject' then
    -- Reversing an approval to a rejection. approved_at is cleared: the line is no
    -- longer approved, and leaving a stale stamp would date a decision that was
    -- withdrawn.
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null, assigned_approver_id = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;
  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_import_announce('line', p_line_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision));
end $$;
grant execute on function public.fms_import_update_approval(uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. PO GENERATION — the PO row itself.
--     Next step: sharing it with the vendor.
--
--     Only po_no is amendable: vendor / company / lines are what the PO IS, and
--     changing them is a cancel-and-regenerate, not a correction.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_po_editable(p_po_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_import_pos po
     where po.id = p_po_id
       and po.shared_at is null                          -- not yet sent to the vendor
       and po.current_stage not in ('closed','cancelled')
  );
$$;
grant execute on function public.fms_import_po_editable(uuid) to authenticated;

create or replace function public.fms_import_update_po_no(p_po_id uuid, p_po_no text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to edit POs';
  end if;
  select po_no into v_old from public.fms_import_pos where id = p_po_id for update;
  if v_old is null then raise exception 'PO not found'; end if;

  if not public.fms_import_po_editable(p_po_id) then
    raise exception 'This PO has already been shared with the vendor — its number can no longer be changed.';
  end if;
  if nullif(p_po_no,'') is null then raise exception 'PO number is required'; end if;
  if exists (select 1 from public.fms_import_pos where po_no = p_po_no and id <> p_po_id) then
    raise exception 'That PO number already exists';
  end if;

  update public.fms_import_pos
     set po_no = p_po_no, edited_at = now(), edited_by = auth.uid()
   where id = p_po_id;

  perform public.fms_import_announce('po', p_po_id, 'po_no_edited',
    format('PO number changed from %s to %s', v_old, p_po_no), '{}'::uuid[],
    jsonb_build_object('po_no_from', v_old, 'po_no_to', p_po_no));
end $$;
grant execute on function public.fms_import_update_po_no(uuid, text) to authenticated;
