-- ===========================================================================
-- Purchase FMS (RM Domestic) — the Tally PO number and the PO PDF move from
-- Step 5 (Share PO) to Step 4 (Generate PO / "PO Workbench").
--
-- WHY
-- The PO Desk is the team that raises the PO in Tally and produces the PDF. The
-- Share PO owner only sends it to the vendor and records the commercial terms.
-- Capturing the number and the file at Share made the sharer chase the PO Desk
-- for two things they never created. From here:
--
--   Step 4  po        — enters tally_po_no + uploads the PO PDF, REQUIRED
--   Step 5  share_po  — SEES both read-only; still owns terms / dispatch / remarks
--
-- NO SCHEMA CHANGE. tally_po_no / document_path / document_name are already
-- columns on fms_purchase_pos (20260701130000); only the RPC that writes them
-- moves. Every existing PO keeps its number and PDF verbatim — there is nothing
-- to backfill.
--
-- THE LOAD-BEARING RULE (learned from 20260728230000, where the production
-- metrics moved to the Log Book): the LOSING step must stop writing the fields
-- ENTIRELY, not merely stop showing them. share_po's UPDATE currently sets
-- `document_path = nullif(p_document_path,'')` unconditionally — the instant the
-- client stops sending it, that would BLANK the PDF the PO stage just attached.
-- So the three columns come out of both share-side UPDATE lists altogether.
--
-- SIGNATURE COMPATIBILITY (deploy ordering)
-- Migrations go out before the frontend, so an in-flight old client must not
-- 404. PostgREST resolves a function by its argument NAMES, not their order, so:
--   • share_po keeps its 7-arg signature; the three moved params are accepted
--     and ignored.
--   • update_share_po is dropped and recreated with the three moved params
--     RE-ORDERED to the tail with defaults, so both a 4-arg new client and a
--     7-arg old client resolve to it. They are accepted and ignored.
--   • generate_po must drop its 4-arg form: the new params are additive, but
--     leaving both arities would make a 4-name call ambiguous.
--
-- Verified before writing: exactly ONE live PO (PO-2627-0016) is unshared with
-- no tally_po_no / document_path. It is NOT stranded — fms_purchase_po_editable
-- is `shared_at is null`, so the PO Desk fills it in from
-- PO Workbench -> Completed -> Edit PO Details (fms_purchase_update_po_details
-- below) and then shares it as normal.
--
-- Reversal: re-apply 20260720140000 (generate_po), 20260718140000 (share_po),
-- 20260718120000 (update_share_po); drop fms_purchase_update_po_details.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. generate_po — now captures the Tally PO number and the PO PDF, and
--    REQUIRES both. Body is 20260720140000's verbatim apart from the two new
--    guards and the three extra INSERT columns.
--
--    The PDF is uploaded to storage BEFORE this is called (the client cannot
--    know the PO id yet, so it writes to `po/new/<requestId>/...`), and the
--    resulting object path is passed in here. That ordering is deliberate: a
--    failed upload then never creates a PO, and this INSERT is atomic — a PO
--    can never exist without the number and the file that justify it.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_purchase_generate_po(uuid, uuid, uuid[], text);

create or replace function public.fms_purchase_generate_po(
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
  v_po_id  uuid;
  v_no     text;
  v_seq    integer;
  v_fy     text;
  v_id     uuid;
  v_total  numeric(16,2) := 0;
  v_fqty   numeric(14,3);
  v_frate  numeric(14,2);
  v_fgst   numeric(6,2);
  v_lval   numeric(16,2);
  v_lead   integer;
  v_vendor uuid;
  v_lstatus text;
  v_company uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to generate POs';
  end if;
  if p_request_item_ids is null or array_length(p_request_item_ids, 1) is null then
    raise exception 'Select at least one line for the PO';
  end if;

  -- NEW — the PO stage now owns these two. Enforced here, not just in the
  -- dialog, so a direct RPC call cannot create a PO that Share PO can never ship.
  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required to generate the PO';
  end if;
  if nullif(p_document_path,'') is null then
    raise exception 'The PO PDF is required to generate the PO';
  end if;

  if p_po_no is not null and exists (select 1 from public.fms_purchase_pos where po_no = p_po_no) then
    raise exception 'PO number % already exists', p_po_no;
  end if;
  if p_po_no is null then
    v_fy  := public.fms_purchase_fy_code(current_date);
    v_seq := public.fms_purchase_next_seq('po:' || v_fy);
    v_no  := 'PO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');
  else
    v_no := p_po_no;
  end if;

  insert into public.fms_purchase_pos
    (po_no, vendor_id, company_id, created_by, tally_po_no, document_path, document_name)
  values
    (v_no, p_vendor_id, p_company_id, auth.uid(),
     nullif(p_tally_po_no,''), nullif(p_document_path,''), nullif(p_document_name,''))
  returning id into v_po_id;

  foreach v_id in array p_request_item_ids loop
    select ri.status, ri.final_vendor_id, ri.final_qty, ri.final_rate, ri.gst_pct,
           ri.line_value, ri.lead_time_days, r.company_id
      into v_lstatus, v_vendor, v_fqty, v_frate, v_fgst, v_lval, v_lead, v_company
    from public.fms_purchase_request_items ri
    join public.fms_purchase_requests r on r.id = ri.request_id
    where ri.id = v_id
    for update of ri;

    if v_lstatus is null then raise exception 'Line % not found', v_id; end if;
    if v_lstatus <> 'approved_pending_po' then
      raise exception 'Line % is not an approved pool line (status %)', v_id, v_lstatus;
    end if;
    if v_vendor is distinct from p_vendor_id then
      raise exception 'Line % is for a different vendor', v_id;
    end if;
    if v_company is distinct from p_company_id then
      raise exception 'Line % belongs to a different company', v_id;
    end if;

    insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, lead_time_days)
    values (v_po_id, v_id, v_fqty, v_frate, v_fgst, v_lval, v_lead);

    update public.fms_purchase_request_items set status = 'po' where id = v_id;
    v_total := v_total + coalesce(v_lval, 0);
  end loop;

  update public.fms_purchase_pos set total_value = v_total where id = v_po_id;
  return v_po_id;
end $function$;

grant execute on function public.fms_purchase_generate_po(uuid, uuid, uuid[], text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. update_po_details — the PO stage's edit, widened from "the PO number" to
--    "everything the PO stage recorded".
--
--    Supersedes fms_purchase_update_po_no, which stays in place but is no longer
--    called (additive-only: functions are not dropped just for being dormant).
--    Same owner, same lock, same fms_purchase_po_editable() gate — so these
--    three stay amendable until, and only until, the PO is shared.
--
--    Omit p_document_path to keep the attached PDF. It can be REPLACED but never
--    removed: a PO without its PDF cannot be shared, so allowing one to be
--    cleared would strand the PO.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_update_po_details(
  p_po_id uuid,
  p_po_no text,
  p_tally_po_no text,
  p_document_path text default null,   -- null => keep the existing document
  p_document_name text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old_no    text;
  v_old_tally text;
  v_doc       text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to edit POs';
  end if;

  select po_no, tally_po_no, document_path
    into v_old_no, v_old_tally, v_doc
    from public.fms_purchase_pos where id = p_po_id for update;
  if v_old_no is null then raise exception 'PO not found'; end if;

  if not public.fms_purchase_po_editable(p_po_id) then
    raise exception 'This PO has already been shared with the vendor — its details can no longer be changed.';
  end if;

  if nullif(p_po_no,'') is null then raise exception 'PO number is required'; end if;
  if exists (select 1 from public.fms_purchase_pos where po_no = p_po_no and id <> p_po_id) then
    raise exception 'That PO number already exists';
  end if;
  if nullif(p_tally_po_no,'') is null then raise exception 'The Tally PO number is required'; end if;
  if nullif(coalesce(nullif(p_document_path,''), v_doc), '') is null then
    raise exception 'The PO PDF is required';
  end if;

  update public.fms_purchase_pos
     set po_no         = p_po_no,
         tally_po_no   = nullif(p_tally_po_no,''),
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_po_id;

  perform public.fms_purchase_announce('po', p_po_id, 'po_no_edited',
    case when p_po_no is distinct from v_old_no
      then format('PO number changed from %s to %s', v_old_no, p_po_no)
      else format('PO details edited for %s', v_old_no) end,
    '{}'::uuid[],
    jsonb_build_object(
      'po_no_from', v_old_no,
      'po_no_to', p_po_no,
      'tally_po_no_from', v_old_tally,
      'tally_po_no_to', nullif(p_tally_po_no,''),
      'document_replaced', (nullif(p_document_path,'') is not null and p_document_path is distinct from v_doc)
    ));
end $$;

grant execute on function public.fms_purchase_update_po_details(uuid, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. share_po — stops writing the Tally PO number and the PO PDF.
--
--    Signature UNCHANGED (see the header note on deploy ordering): the three
--    moved params are still accepted so an in-flight old client resolves, but
--    they are ignored — read the UPDATE below and note that document_path,
--    document_name and tally_po_no are simply absent from it.
--
--    The requirement does not disappear, it MOVES: sharing still demands both,
--    but now checks what is STORED on the PO rather than what the caller sent.
--    A PO that somehow reached this stage without them is refused with a message
--    that names where to fix it.
--
--    Everything else — the one-time-share guard, the dispatch-date requirement,
--    the payment-terms validation, the stage transition to collect_pi and the
--    coalesce'd attribution — is unchanged from 20260718140000.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_share_po(
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
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;

  -- Lock first: the guard below is a check-then-write, so without this two
  -- concurrent shares could both read a null shared_at and both proceed.
  select shared_at, current_stage, tally_po_no, document_path
    into v_shared_at, v_stage, v_tally, v_doc
    from public.fms_purchase_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % — it can no longer be shared.', v_stage;
  end if;

  -- THE GUARD. Sharing is a one-time step; changing what was recorded is an edit.
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

  update public.fms_purchase_pos
     set status        = case when status = 'generated' then 'shared' else status end,
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
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

grant execute on function public.fms_purchase_share_po(uuid, text, text, text, text, text, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. update_share_po — same treatment for the Share PO correction path.
--
--    Dropped and recreated with the three moved params RE-ORDERED to the tail
--    with defaults, so the new 4-arg client and an in-flight 7-arg client both
--    resolve (PostgREST matches on argument NAMES, not position). They are
--    accepted and ignored.
--
--    The "a shared PO must always have its PDF" invariant survives, now asserted
--    against the stored value alone. The stage re-derivation from payment terms
--    is untouched.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_purchase_update_share_po(uuid, text, text, date, text, text, text);

create or replace function public.fms_purchase_update_share_po(
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

  if p_dispatch_date is null then
    raise exception 'The expected dispatch date is required';
  end if;
  if nullif(p_payment_terms,'') is null
     or p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;
  -- A shared PO must always have its PDF. It is the PO stage's to fix now, so
  -- this asserts the stored value rather than accepting a replacement here.
  if nullif(v_doc,'') is null then
    raise exception 'This PO has no PO PDF — add it on the PO stage.';
  end if;

  update public.fms_purchase_pos
     set share_remarks = nullif(p_remarks,''),
         payment_terms = p_payment_terms,
         dispatch_date = p_dispatch_date,
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
      'payment_terms_from', v_old_terms,
      'payment_terms_to', p_payment_terms,
      'dispatch_date', p_dispatch_date
    )
  );
end $$;

grant execute on function public.fms_purchase_update_share_po(uuid, text, date, text, text, text, text) to authenticated;
