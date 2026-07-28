-- ===========================================================================
-- Import Purchase FMS (RM Import) — the Tally PO number and the PO PDF move
-- from Step 4 (Share PO) to Step 3 (Generate PO / "PO Workbench").
--
-- The exact mirror of 20260804120000 (RM Domestic); read that file's header for
-- the reasoning, the load-bearing rule and the deploy-ordering note. Import
-- differs only in the details that already differed:
--
--   • generate_po carries fx (total_value_fx / currency) and writes no gst_pct
--     or lead_time_days.
--   • share_po advances to `follow_up`, not `collect_pi` — Import has no PI or
--     advance step (20260727120000).
--   • update_share_po forces the stage to `follow_up` rather than deriving it
--     from the payment terms (Import is always 100% advance).
--
-- NO SCHEMA CHANGE — tally_po_no / document_path / document_name already exist
-- on fms_import_pos (20260716120600). Nothing to backfill.
--
-- Verified before writing: NO live import PO is unshared without a
-- tally_po_no / document_path, so nothing is mid-flight here.
--
-- Reversal: re-apply 20260718190000 (generate_po) and 20260727120000
-- (share_po, update_share_po); drop fms_import_update_po_details.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. generate_po — now captures the Tally PO number and the PO PDF, and
--    REQUIRES both. Body is 20260718190000's verbatim apart from the two new
--    guards and the three extra INSERT columns.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_import_generate_po(uuid, uuid, uuid[], text);

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
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('po', auth.uid())) then
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
           ri.line_value, ri.line_value_fx, ri.currency, r.company_id
      into v_lstatus, v_vendor, v_fqty, v_frate, v_lval, v_lvalfx, v_ccy, v_company
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
     set total_value = v_total, total_value_fx = v_totalfx, currency = v_ccy
   where id = v_po_id;
  return v_po_id;
end $function$;

grant execute on function public.fms_import_generate_po(uuid, uuid, uuid[], text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. update_po_details — the PO stage's edit, widened from "the PO number" to
--    "everything the PO stage recorded". Supersedes fms_import_update_po_no,
--    which stays in place but is no longer called.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_update_po_details(
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
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to edit POs';
  end if;

  select po_no, tally_po_no, document_path
    into v_old_no, v_old_tally, v_doc
    from public.fms_import_pos where id = p_po_id for update;
  if v_old_no is null then raise exception 'PO not found'; end if;

  if not public.fms_import_po_editable(p_po_id) then
    raise exception 'This PO has already been shared with the vendor — its details can no longer be changed.';
  end if;

  if nullif(p_po_no,'') is null then raise exception 'PO number is required'; end if;
  if exists (select 1 from public.fms_import_pos where po_no = p_po_no and id <> p_po_id) then
    raise exception 'That PO number already exists';
  end if;
  if nullif(p_tally_po_no,'') is null then raise exception 'The Tally PO number is required'; end if;
  if nullif(coalesce(nullif(p_document_path,''), v_doc), '') is null then
    raise exception 'The PO PDF is required';
  end if;

  update public.fms_import_pos
     set po_no         = p_po_no,
         tally_po_no   = nullif(p_tally_po_no,''),
         document_path = coalesce(nullif(p_document_path,''), document_path),
         document_name = coalesce(nullif(p_document_name,''), document_name),
         edited_at     = now(),
         edited_by     = auth.uid()
   where id = p_po_id;

  perform public.fms_import_announce('po', p_po_id, 'po_no_edited',
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

grant execute on function public.fms_import_update_po_details(uuid, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. share_po — stops writing the Tally PO number and the PO PDF. Signature
--    unchanged; the three moved params are accepted and ignored. The stage
--    transition stays share_po -> follow_up.
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
         current_stage = case when current_stage = 'share_po' then 'follow_up' else current_stage end,
         share_remarks = nullif(p_remarks,''),
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms),
         dispatch_date = p_dispatch_date,
         shared_at     = coalesce(shared_at, now()),
         shared_by     = coalesce(shared_by, auth.uid())
   where id = p_po_id;
end $$;

grant execute on function public.fms_import_share_po(uuid, text, text, text, text, text, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. update_share_po — same treatment. Dropped and recreated with the three
--    moved params re-ordered to the tail with defaults, so both the new 4-arg
--    client and an in-flight 7-arg client resolve. Import's stage forcing to
--    `follow_up` is untouched.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_import_update_share_po(uuid, text, text, date, text, text, text);

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
    raise exception 'The share details can no longer be edited: work has already moved on (a follow-up or goods receipt exists against this PO).';
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
      'payment_terms_from', v_old_terms,
      'payment_terms_to', p_payment_terms,
      'dispatch_date', p_dispatch_date
    )
  );
end $$;

grant execute on function public.fms_import_update_share_po(uuid, text, date, text, text, text, text) to authenticated;
