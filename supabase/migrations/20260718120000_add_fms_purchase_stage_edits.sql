-- ===========================================================================
-- Purchase FMS (procurement) — stage history + edit-until-the-next-step.
--
-- WHY
-- Every stage screen is a pending-only queue: the instant an owner completes
-- their action the row disappears and they can never see, let alone correct,
-- what they did. This migration lays the server foundation for a Completed view
-- ("what I did at this stage") and for editing an entry until the NEXT step has
-- been done.
--
-- WHAT'S HERE (Share PO only — the first stage to ship; the other five follow
-- the same shape once the pattern is signed off)
--   1. Actor columns for the two steps that record WHEN but not WHO.
--   2. updated_at / updated_by on every table an edit will touch.
--   3. share_po / save_sourcing replaced to stamp the new actor columns.
--   4. fms_purchase_share_po_editable() — the lock rule, as one function so the
--      RPC and any future caller cannot drift apart.
--   5. fms_purchase_update_share_po() — the edit itself.
--
-- A NOTE ON WHAT THIS CLOSES
-- fms_purchase_share_po has never guarded re-sharing: it overwrites the PO's
-- document, terms and dispatch date unconditionally, with no check, even after
-- the PI is collected / the advance is paid / the goods have landed. That hole
-- is live today. The new editable() rule is what finally bounds it. share_po
-- itself is deliberately left permissive here (fixing it is a behaviour change
-- beyond this migration's remit) — the UI routes edits through update_share_po.
--
-- Additive / replace-only: no table, column or row of business data is dropped
-- or mutated. Existing rows keep NULL actors — we do NOT guess who did
-- something. They stay visible under "All", just not under "Mine".
--
-- Deploy ordering: apply BEFORE the frontend that reads these columns.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Actor columns.
--
-- Five of the eight steps already record their actor on the domain row
-- (pis.created_by, payments.created_by, grns.received_by,
-- tally_bookings.booked_by, followups.created_by, request_items.approver_id).
-- Exactly two record a timestamp with no actor — added here, mirroring the
-- 20260708120900 precedent that added the timestamps themselves.
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_pos
  add column if not exists shared_by uuid references auth.users on delete set null;
alter table public.fms_purchase_request_items
  add column if not exists sourced_by uuid references auth.users on delete set null;

comment on column public.fms_purchase_pos.shared_by is
  'Who first shared the PO with the vendor. Pairs with shared_at (first share wins). NULL for rows shared before this column existed — deliberately not backfilled.';
comment on column public.fms_purchase_request_items.sourced_by is
  'Who last saved sourcing for this line. Pairs with sourced_at (re-sourcing restarts both). NULL for rows sourced before this column existed.';

-- ---------------------------------------------------------------------------
-- 2. Edit audit columns, on every table a stage edit can touch.
--
-- Deliberately separate from created_by/created_at: "who did this step" and
-- "who last corrected it" are different questions, and the Completed view asks
-- the first one. An edit must never rewrite the original attribution.
--
-- NAMED `edited_*`, NOT `updated_*`, and that is load-bearing. Several of these
-- tables (pos, pis, request_items) already carry an `updated_at` maintained by a
-- `set_updated_at` TRIGGER that fires on EVERY row touch — including the stage
-- machine's own refresh_po() writes. So `updated_at` answers "when was this row
-- last written", which is not the question: pairing it with an actor would
-- display a real editor's name against a timestamp from an unrelated automatic
-- recompute. `edited_at` is written only by the update_* RPCs below, so
-- "edited_by X at edited_at" is always a true statement.
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_pos             add column if not exists edited_at timestamptz,
                                                add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_purchase_pis             add column if not exists edited_at timestamptz,
                                                add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_purchase_payments        add column if not exists edited_at timestamptz,
                                                add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_purchase_followups       add column if not exists edited_at timestamptz,
                                                add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_purchase_grns            add column if not exists edited_at timestamptz,
                                                add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_purchase_tally_bookings  add column if not exists edited_at timestamptz,
                                                add column if not exists edited_by uuid references auth.users on delete set null;
alter table public.fms_purchase_request_items   add column if not exists edited_at timestamptz,
                                                add column if not exists edited_by uuid references auth.users on delete set null;

comment on column public.fms_purchase_pos.edited_at is
  'When a stage entry on this row was last CORRECTED via an update_* RPC. Distinct from updated_at, which a trigger bumps on every write.';

-- ---------------------------------------------------------------------------
-- 3a. save_sourcing — stamp sourced_by.
--     Body carried forward verbatim from 20260708120900 (migrations replace the
--     whole body); the ONLY change is the sourced_by line.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_save_sourcing(
  p_request_item_id uuid, p_quotations jsonb, p_recommended_vendor_id uuid,
  p_final_qty numeric, p_final_rate numeric,
  p_gst_pct numeric default null, p_sourcing_reason text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_elem   jsonb;
  v_value  numeric(16,2);
begin
  select status into v_status from public.fms_purchase_request_items
   where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('sourcing','approval','on_hold') then
    raise exception 'This line is not open for sourcing (status %)', v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this line';
  end if;
  if p_recommended_vendor_id is null then raise exception 'A recommended vendor is required'; end if;
  if coalesce(p_final_qty,0) <= 0 or coalesce(p_final_rate,0) < 0 then
    raise exception 'Final qty must be > 0 and rate >= 0';
  end if;

  delete from public.fms_purchase_quotations where request_item_id = p_request_item_id;
  if p_quotations is not null then
    for v_elem in select * from jsonb_array_elements(p_quotations) loop
      insert into public.fms_purchase_quotations
        (request_item_id, vendor_id, rate, gst_pct, lead_time_days, remark, is_recommended)
      values (
        p_request_item_id,
        (v_elem->>'vendor_id')::uuid,
        (v_elem->>'rate')::numeric,
        nullif(v_elem->>'gst_pct','')::numeric,
        nullif(v_elem->>'lead_time_days','')::integer,
        nullif(v_elem->>'remark',''),
        ((v_elem->>'vendor_id')::uuid = p_recommended_vendor_id)
      );
    end loop;
  end if;

  v_value := round(p_final_qty * p_final_rate * (1 + coalesce(p_gst_pct,0)/100.0), 2);

  update public.fms_purchase_request_items
     set final_vendor_id = p_recommended_vendor_id,
         final_qty = p_final_qty,
         final_rate = p_final_rate,
         gst_pct = p_gst_pct,
         line_value = v_value,
         sourcing_reason = nullif(p_sourcing_reason,''),
         status = 'approval',
         reject_reason = null,
         sourced_at = now(),      -- re-sourcing restarts the approval clock
         sourced_by = auth.uid()  -- ...and re-attributes it to whoever re-sourced
   where id = p_request_item_id;
end $$;
grant execute on function public.fms_purchase_save_sourcing(uuid, jsonb, uuid, numeric, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. share_po — stamp shared_by.
--     Body carried forward verbatim from 20260708120900; the ONLY change is the
--     shared_by line, which mirrors shared_at's coalesce (first share wins, so a
--     re-share never steals attribution from the original sharer).
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_share_po(
  p_po_id uuid,
  p_document_path text default null,
  p_document_name text default null,
  p_tally_po_no text default null,
  p_remarks text default null,
  p_payment_terms text default null,
  p_dispatch_date date default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
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
  update public.fms_purchase_pos
     set status        = case when status = 'generated' then 'shared' else status end,
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
         document_path = nullif(p_document_path,''),
         document_name = nullif(p_document_name,''),
         tally_po_no   = nullif(p_tally_po_no,''),
         share_remarks = nullif(p_remarks,''),
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms),
         dispatch_date = p_dispatch_date,
         shared_at     = coalesce(shared_at, now()),      -- first share wins
         shared_by     = coalesce(shared_by, auth.uid())  -- ...and keeps its author
   where id = p_po_id;
end $$;
grant execute on function public.fms_purchase_share_po(uuid, text, text, text, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The lock rule, as a function.
--
-- Share PO is editable until the NEXT step has been done. "The next step" is
-- NOT simply collect_pi: the flow can legitimately skip ahead (an advance can be
-- paid, or goods can even land, before any PI is collected), and each of those
-- is downstream work that a changed PO document would invalidate. So the rule is
-- "no downstream artifact of any kind exists yet".
--
-- Closed/cancelled is an absolute bar, for a mechanical reason as well as a
-- policy one: fms_purchase_refresh_po short-circuits on terminal POs
-- ("terminal states are absorbing", 20260715120000), so any edit there would
-- silently skip every derived recompute and drift the data.
--
-- STABLE, not immutable: it reads tables.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_share_po_editable(p_po_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.fms_purchase_pos po
     where po.id = p_po_id
       and po.shared_at is not null                       -- the step must be DONE to be edited
       and po.current_stage not in ('closed','cancelled') -- terminal is absorbing
       and not exists (select 1 from public.fms_purchase_pis        x where x.po_id = po.id)
       and not exists (select 1 from public.fms_purchase_payments   x where x.po_id = po.id)
       and not exists (select 1 from public.fms_purchase_followups  x where x.po_id = po.id)
       and not exists (select 1 from public.fms_purchase_grns       x where x.po_id = po.id)
  );
$$;
grant execute on function public.fms_purchase_share_po_editable(uuid) to authenticated;

comment on function public.fms_purchase_share_po_editable(uuid) is
  'True while the Share PO entry may still be corrected: shared, not terminal, and no PI / payment / follow-up / GRN downstream of it yet.';

-- ---------------------------------------------------------------------------
-- 5. update_share_po — correct a Share PO entry.
--
-- Distinct from share_po in three ways that matter:
--   • it REFUSES once the next step is done (share_po never has);
--   • it never touches shared_at / shared_by — the original author and moment of
--     the step are history, not something an edit rewrites;
--   • it logs its own activity row IN THIS TRANSACTION. The client-side announce
--     used elsewhere is best-effort and swallows failures (safeAnnounce), which
--     is not good enough to answer "who changed the terms after I read them".
--
-- p_document_path NULL => keep the existing document (the user didn't pick a new
-- file). Passing a new path does NOT delete the old object: uploads are
-- immutable, timestamp-named keys, and the superseded file is left in place on
-- purpose — document history is the point of the Completed view.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_update_share_po(
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
  v_stage    text;
  v_doc      text;
  v_old_terms text;
  v_po_no    text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to edit this PO''s share details';
  end if;

  -- Lock the row first: two share_po owners editing at once would otherwise
  -- both pass the check below and the last write would win silently.
  select current_stage, document_path, payment_terms, po_no
    into v_stage, v_doc, v_old_terms, v_po_no
    from public.fms_purchase_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  -- The lock rule. Re-checked HERE, on the server: the disabled button in the UI
  -- is a courtesy, never the gate.
  if not public.fms_purchase_share_po_editable(p_po_id) then
    if v_stage in ('closed','cancelled') then
      raise exception 'This PO is % — its share details can no longer be edited.', v_stage;
    end if;
    raise exception 'The share details can no longer be edited: work has already moved on (a PI, payment, follow-up or goods receipt exists against this PO).';
  end if;

  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required';
  end if;
  if p_dispatch_date is null then
    raise exception 'The expected dispatch date is required';
  end if;
  if nullif(p_payment_terms,'') is null
     or p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;
  -- A shared PO must always have its PDF. Keeping the old one is fine; ending up
  -- with none is not.
  if nullif(coalesce(nullif(p_document_path,''), v_doc), '') is null then
    raise exception 'The PO PDF is required';
  end if;

  update public.fms_purchase_pos
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
  perform public.fms_purchase_announce(
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
grant execute on function public.fms_purchase_update_share_po(uuid, text, text, date, text, text, text) to authenticated;
