-- ===========================================================================
-- SALES BILL — THE E-WAY BILL TRAVELS WITH THE INVOICE.
--
-- The billing clerk already attaches the Tally invoice at this step. A
-- consignment moving by road above the threshold also carries an e-way bill, and
-- it is generated at the same moment, by the same person — so it is asked for in
-- the same place instead of being mailed around afterwards.
--
-- ⚠ OPTIONAL, AND IT MUST STAY OPTIONAL. Plenty of consignments need no e-way
--   bill at all (below threshold, local delivery, hand-carried). The invoice
--   check below is untouched; nothing new can block a bill from being raised.
--
-- Additive: two nullable columns on the order and two on the round archive, and
-- the three functions that carry the sb_ block are re-stated with them included.
-- ===========================================================================

begin;

alter table public.fms_dispatch_orders
  add column if not exists sb_eway_path text,
  add column if not exists sb_eway_name text;

comment on column public.fms_dispatch_orders.sb_eway_path is
  'Storage object path of the e-way bill in fms-dispatch-docs. OPTIONAL — a consignment below the threshold has none.';
comment on column public.fms_dispatch_orders.sb_eway_name is
  'Original filename of the e-way bill, for display.';

alter table public.fms_dispatch_rounds
  add column if not exists sb_eway_path text,
  add column if not exists sb_eway_name text;

comment on column public.fms_dispatch_rounds.sb_eway_path is
  'The e-way bill AS AT this round. One invoice, one e-way bill — it travels with the sb_ block.';

-- ===========================================================================
-- 1. RECORDING THE BILL. Restated from 20260822120000; the only change is the
--    two sb_eway_ columns in the update. The gate-pass allocation, the invoice
--    and attachment checks and the announcement are byte-for-byte the same.
-- ===========================================================================
create or replace function public.fms_dispatch_record_sales_bill(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_no      text;
  v_round   integer;
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_gp      text;
  v_date    date;
begin
  select status, order_no, round_no, company_id, gp_no
    into v_status, v_no, v_round, v_company, v_gp
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_bill' then raise exception 'This order is not awaiting the sales bill (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to record the sales bill'; end if;
  if coalesce(trim(p->>'sb_invoice_no'), '') = '' then raise exception 'The Tally invoice number is required'; end if;
  if coalesce(trim(p->>'sb_attachment_path'), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;
  -- ⚠ THERE IS NO EQUIVALENT CHECK FOR THE E-WAY BILL, and adding one would stop
  --   every below-threshold consignment at the billing desk.

  -- Resolved here rather than read back out of the row: the number's month has
  -- to match the date this same statement is about to write, and depending on
  -- when a column becomes visible mid-update is how that quietly goes wrong.
  v_date := coalesce(nullif(p->>'sb_actual_date','')::date, current_date);

  -- `is null` guarded because the allocator burns a number on every call. In
  -- practice the status check above already makes a second pass impossible, but
  -- the guard is what makes that a belt AND braces rather than a coincidence.
  if v_gp is null then
    v_gp := public.fms_dispatch_gate_pass_no(v_company, v_date);
  end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = v_date,
    sb_invoice_no      = trim(p->>'sb_invoice_no'),
    sb_attachment_path = nullif(p->>'sb_attachment_path',''),
    sb_attachment_name = nullif(p->>'sb_attachment_name',''),
    sb_eway_path       = nullif(p->>'sb_eway_path',''),
    sb_eway_name       = nullif(p->>'sb_eway_name',''),
    sb_remarks         = nullif(trim(p->>'sb_remarks'), ''),
    sb_at = coalesce(sb_at, now()), sb_by = coalesce(sb_by, v_uid),
    gp_no = coalesce(gp_no, v_gp),
    status = 'awaiting_gate_out', current_step = 'gate_out'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'billed',
    'Sales bill ' || trim(p->>'sb_invoice_no') || ' raised for ' || coalesce(v_no,'an order')
      || ' (round ' || v_round || ') - awaiting the gate outward entry. Gate pass ' || v_gp || '.',
    public.fms_dispatch_step_owner_ids('gate_out'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round,
                       'invoice_no', trim(p->>'sb_invoice_no'), 'gate_pass_no', v_gp)
  );
end $$;

-- ===========================================================================
-- 2. EDITING THE BILL. Restated from 20260810120100 with the same two columns,
--    under the SAME presence-key contract as the invoice: the client omits the
--    key to keep the stored file, sends "" to clear it.
--
-- ⚠ STILL NO gp_no HERE. Correcting a Tally typo is the same invoice, so it must
--   be the same pass — and 20260822120000 asserts that this function never
--   mentions gp_no. Keep it that way.
-- ===========================================================================
create or replace function public.fms_dispatch_update_sales_bill(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_path text;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to edit the sales bill'; end if;
  if not public.fms_dispatch_sb_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its sales bill can no longer be changed.'; end if;
    raise exception 'The sales bill can no longer be edited: the gate outward entry has already been recorded (status %).', v_status;
  end if;
  if p ? 'sb_invoice_no' and coalesce(trim(p->>'sb_invoice_no'), '') = '' then
    raise exception 'The Tally invoice number is required';
  end if;

  -- ⚠ ATTACHMENT CONTRACT. The client OMITS the key when the stored file is being
  --   kept, so the "is it there?" test must ask what the row WOULD hold — not
  --   what the payload carries. Testing the payload makes every remarks-only
  --   edit fail with "attach the sales invoice".
  select case when p ? 'sb_attachment_path' then nullif(p->>'sb_attachment_path','') else o.sb_attachment_path end
    into v_path from public.fms_dispatch_orders o where o.id = p_order;
  if coalesce(trim(v_path), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = coalesce(nullif(p->>'sb_actual_date','')::date, sb_actual_date),
    sb_invoice_no      = coalesce(nullif(trim(p->>'sb_invoice_no'), ''), sb_invoice_no),
    sb_attachment_path = case when p ? 'sb_attachment_path' then nullif(p->>'sb_attachment_path','') else sb_attachment_path end,
    sb_attachment_name = case when p ? 'sb_attachment_name' then nullif(p->>'sb_attachment_name','') else sb_attachment_name end,
    -- Same contract, opposite default: an e-way bill may legitimately be REMOVED,
    -- so "" clears it. Only the absence of the key leaves the stored file alone.
    sb_eway_path       = case when p ? 'sb_eway_path' then nullif(p->>'sb_eway_path','') else sb_eway_path end,
    sb_eway_name       = case when p ? 'sb_eway_name' then nullif(p->>'sb_eway_name','') else sb_eway_name end,
    sb_remarks         = nullif(trim(p->>'sb_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'billed_edited',
    format('Sales bill on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;

-- ===========================================================================
-- 3. THE ARCHIVE. Restated from 20260822120000; the e-way bill joins the sb_
--    block in the insert, the select AND the wipe — a new round raises a new
--    invoice, so it must not inherit the last one's e-way bill either.
-- ===========================================================================
create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id, location_id,
    cc_status, cc_approved_qty, cc_remarks, cc_at, cc_by,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name,
    sb_eway_path, sb_eway_name, sb_remarks, sb_at, sb_by,
    gp_no,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id, o.location_id,
    -- ONLY the decision this round actually made. When credit approved enough to
    -- cover several rounds, the later ones inherit that decision and must archive
    -- NOTHING - otherwise one decision appears once per round it happened to
    -- cover, in the Completed tab and in the register.
    case when o.cc_round_no = o.round_no then o.cc_status       else null end,
    case when o.cc_round_no = o.round_no then o.cc_approved_qty else null end,
    case when o.cc_round_no = o.round_no then o.cc_remarks      else null end,
    case when o.cc_round_no = o.round_no then o.cc_at           else null end,
    case when o.cc_round_no = o.round_no then o.cc_by           else null end,
    o.ms_actual_date, o.ms_tempo_no, o.ms_porter, o.ms_remarks, o.ms_at, o.ms_by,
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name,
    o.sb_eway_path, o.sb_eway_name, o.sb_remarks, o.sb_at, o.sb_by,
    -- Travels with the sb_ block, because it was issued for that invoice.
    o.gp_no,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name,
    ordered_qty, ship_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    coalesce(it.name, 'Item'), li.unit,
    li.quantity, li.ship_qty, li.lot_no
  from public.fms_dispatch_order_items li
  left join public.fms_dispatch_items it on it.id = li.item_id
  where li.order_id = p_order and coalesce(li.ship_qty, 0) > 0
  order by li.line_no;

  -- WIPE.
  --
  -- ⚠ company_id AND location_id ARE BOTH DELIBERATELY ABSENT. Both are chosen
  --   once at intake and are true for every round of the order, so wiping either
  --   would blank it the instant a round closed - and the header, the queues, the
  --   register, the emails and the row-level security predicate all read them.
  --   The archive keeps its own copies above, which is what makes a historic
  --   round self-describing.
  --
  -- ⚠ THE cc_ BLOCK IS ABSENT for a third reason: whether the credit decision
  --   survives into the next round depends on whether any headroom is left, which
  --   only the caller has worked out.
  --
  -- ⚠ gp_no AND THE sb_eway_ PAIR ARE PRESENT, which is the opposite of the two
  --   fields above and easy to get wrong by proximity. A new round raises a NEW
  --   invoice, and one pass and one e-way bill per invoice is the whole rule -
  --   carrying either forward would put two consignments on one document.
  update public.fms_dispatch_orders set
    ms_actual_date = null, ms_tempo_no = null, ms_porter = null,
    ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_eway_path = null, sb_eway_name = null,
    sb_remarks = null, sb_at = null, sb_by = null,
    gp_no = null,
    go_actual_date = null, go_outward_no = null, go_remarks = null, go_at = null, go_by = null,
    dc_actual_date = null, dc_status = null, dc_attachment_path = null,
    dc_attachment_name = null, dc_remarks = null, dc_at = null, dc_by = null,
    edited_at = null, edited_by = null
  where id = p_order;

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end $$;

-- ---------------------------------------------------------------- asserts --
do $check$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_record_sales_bill';
  if v_src not like '%sb_eway_path       = nullif%' then raise exception 'record_sales_bill does not store the e-way bill'; end if;
  -- The e-way bill must never become a second thing that blocks a bill.
  if v_src like '%Attach the e-way%' then raise exception 'record_sales_bill now demands an e-way bill - it is optional'; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_update_sales_bill';
  if v_src not like '%p ? ''sb_eway_path''%' then raise exception 'update_sales_bill does not presence-check the e-way bill'; end if;
  -- Carried forward from 20260822120000 — editing an invoice must not renumber its pass.
  if v_src ~* 'gp_no' then raise exception 'update_sales_bill now writes gp_no'; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_reason text';
  if v_src not like '%o.sb_eway_path, o.sb_eway_name%' then raise exception 'archive_round does not archive the e-way bill'; end if;
  if v_src not like '%sb_eway_path = null%' then raise exception 'archive_round carries the e-way bill into the next round'; end if;
  -- Carried forward: the location and company survive a round, the gate pass does not.
  if v_src like '%location_id = null%' then raise exception 'archive_round wipes location_id'; end if;
  if v_src not like '%gp_no = null%' then raise exception 'archive_round lost the gate pass wipe'; end if;
end $check$;

commit;
