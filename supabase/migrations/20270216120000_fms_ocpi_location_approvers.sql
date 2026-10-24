-- ===========================================================================
-- OCPI · QUOTATION APPROVAL BY LOCATION (Surat / Noida)
--
-- A quotation now carries an APPROVAL LOCATION, picked by the salesperson on the
-- form. Setup → "Who does what" → Approve Quotation gains one approver list per
-- location. A quotation for Surat goes to Surat's approvers; one for Noida goes
-- to Noida's.
--
-- ⚠ THE ORDINARY "Approve Quotation" LIST IS STILL THE FALLBACK, and that is what
--   keeps this safe to ship. A deal with no location, or a location whose list
--   is empty, goes exactly where it went before. The 18 deals waiting for
--   approval on the day this was written have no location, so none of them move.
--
-- ⚠ A LOCATION LIST REPLACES THE GENERAL LIST, IT DOES NOT ADD TO IT. Once Noida
--   names its approver, the general approver can no longer approve Noida's
--   quotations. Admins and process coordinators can still act on anything, as
--   on every other step.
--
-- ⚠ fms_ocpi_deals.location_id IS NOT USED, deliberately. It points at
--   mst_locations, which holds O2D dispatch godowns (NOIDA, SURAT-HOJIWALA,
--   SURAT-SACHIN), not sales locations. Surat is one location for approval.
--
-- Changed:
--   + table fms_ocpi_approval_locations (seeded Surat, Noida) + its write RPC
--   + column fms_ocpi_deals.approval_location
--   + fms_ocpi_quotation_approver_ids(deal)  — location list, else general list
--   ~ fms_ocpi_can_act           — quotation_approval reads the deal's location
--   ~ fms_ocpi_save_draft        — stores approval_location from the form
--   ~ fms_ocpi_submit_quotation  — notifies the location's approvers
--   ~ fms_ocpi_decide_quotation  — "sole approver" judged on the location list
--   ~ fms_ocpi_can_see_deal + fms_ocpi_deals_select — a location approver can
--     see deals (and, through fms_ocpi_can_see_doc, their papers)
--   ~ fms_ocpi_is_service_only   — a location approver is not service-only
-- Bodies copied from live on 2026-10-24; only the marked lines differ.
-- Rollback: 20270216120000_fms_ocpi_location_approvers_rollback.sql
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. The locations and who approves for each.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_ocpi_approval_locations (
  name          text primary key,
  employee_ids  uuid[] not null default '{}',
  sort_order    integer not null default 0,
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users on delete set null
);

comment on table public.fms_ocpi_approval_locations is
  'OCPI quotation approval by location. employee_ids approve quotations whose approval_location is this name; empty = fall back to the Approve Quotation step owners. Written only through fms_ocpi_set_location_approvers.';

insert into public.fms_ocpi_approval_locations (name, sort_order)
values ('Surat', 1), ('Noida', 2)
on conflict (name) do nothing;

alter table public.fms_ocpi_approval_locations enable row level security;

drop policy if exists fms_ocpi_approval_locations_select on public.fms_ocpi_approval_locations;
create policy fms_ocpi_approval_locations_select
  on public.fms_ocpi_approval_locations
  for select
  to authenticated
  using ((select public.is_staff((select auth.uid()))));
-- No write policy: fms_ocpi_set_location_approvers is the only write door.

create or replace function public.fms_ocpi_set_location_approvers(
  p_location text, p_employee_ids uuid[] default '{}'::uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.is_admin(v_uid) then raise exception 'Only an admin can change approvers'; end if;

  update public.fms_ocpi_approval_locations
     set employee_ids = coalesce(p_employee_ids, '{}'),
         updated_at   = now(),
         updated_by   = v_uid
   where name = p_location;
  if not found then raise exception 'Unknown location: %', p_location; end if;
end $fn$;

grant execute on function public.fms_ocpi_set_location_approvers(text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The deal's location.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_deals
  add column if not exists approval_location text
    references public.fms_ocpi_approval_locations (name)
    on update cascade on delete set null;

comment on column public.fms_ocpi_deals.approval_location is
  'Surat / Noida — picks which approvers the quotation goes to (fms_ocpi_quotation_approver_ids). Null = the general Approve Quotation owners.';

-- ---------------------------------------------------------------------------
-- 3. Who approves THIS deal. Not gated on module_can_edit — like
--    fms_ocpi_step_owner_ids, it answers "who should be told".
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_quotation_approver_ids(p_deal uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select l.employee_ids
       from public.fms_ocpi_deals d
       join public.fms_ocpi_approval_locations l on l.name = d.approval_location
      where d.id = p_deal
        and l.active
        and coalesce(array_length(l.employee_ids, 1), 0) > 0),
    public.fms_ocpi_step_owner_ids('quotation_approval')
  );
$fn$;

comment on function public.fms_ocpi_quotation_approver_ids(uuid) is
  'Approvers of one quotation: its approval location''s list when that list has anyone, else the Approve Quotation step owners.';
grant execute on function public.fms_ocpi_quotation_approver_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. fms_ocpi_can_act — quotation_approval on a known deal reads the deal.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_can_act(
  p_step_key text, p_deal uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     and public.module_can_edit(p_uid, 'ocpi')
     and (
          public.fms_ocpi_is_coordinator(p_uid)
       -- CHANGED: approval on a known deal follows the deal's location.
       or (p_step_key = 'quotation_approval' and p_deal is not null
           and p_uid = any(public.fms_ocpi_quotation_approver_ids(p_deal)))
       or (not (p_step_key = 'quotation_approval' and p_deal is not null)
           and public.fms_ocpi_is_step_owner(p_step_key, p_uid))
       or (p_step_key = 'quotation'
           and not exists (
             select 1 from public.fms_ocpi_step_owners o
              where o.step_key = 'quotation'
                and array_length(o.employee_ids, 1) > 0))
     );
$fn$;

comment on function public.fms_ocpi_can_act(text, uuid, uuid) is
  'May this user action this OCPI step? Edit grant + (coordinator or step owner), with the origin step open to any editor while it has no owners. quotation_approval on a given deal uses fms_ocpi_quotation_approver_ids (approval by location).';

-- ---------------------------------------------------------------------------
-- 5. fms_ocpi_save_draft — store approval_location.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_save_draft(p jsonb, p_deal uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid := p_deal;
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if nullif(btrim(p->>'customer_name'), '') is null then
    raise exception 'Enter the customer name before saving';
  end if;

  if v_id is null then
    if not public.fms_ocpi_can_act('quotation', null, v_uid) then
      raise exception 'You are not authorized to raise a quotation';
    end if;
    insert into public.fms_ocpi_deals (raised_by, status, current_step)
    values (v_uid, 'draft', 'quotation')
    returning id into v_id;
  else
    select status, raised_by into v_status, v_owner
      from public.fms_ocpi_deals where id = v_id for update;
    if v_status is null then raise exception 'Quotation not found'; end if;
    if v_status <> 'draft' then
      raise exception 'This quotation has already been submitted - use Edit instead';
    end if;
    if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
      raise exception 'This draft belongs to someone else';
    end if;
  end if;

  -- ORDER IS SEMANTIC: write_oc branches on part-A answers it reads off the
  -- row, so part A must already be written. incl_ink is one of them now -- the
  -- ink shipment row is gated on an answer this call is what stores.
  perform public.fms_ocpi_write_quotation(v_id, p);

  -- CHANGED: approval location. Only when the bag carries the key, so an older
  -- browser tab that does not know the field cannot blank it.
  if p ? 'approval_location' then
    update public.fms_ocpi_deals
       set approval_location = nullif(btrim(p->>'approval_location'), '')
     where id = v_id;
  end if;

  -- THE EASIEST THING IN THIS MODULE TO MISS. write_oc runs ONLY when the bag
  -- carries one of these literal key names. A new part-B field left off this
  -- list is never written at all - no error, no warning, the value simply never
  -- lands. QT-M0037 is what that looks like from outside: 36 keys, none of them
  -- part B, so write_oc never ran and its paper prints a blank total.
  if p ?| array[
       'head_ship_mode', 'head_ship_via', 'head_balance_remarks', 'head_separate_invoice',
       'head_invoice_qty', 'head_invoice_amount',
       'ink_ship_mode', 'ink_ship_via', 'ink_separate_invoice',
       'ink_invoice_qty', 'ink_invoice_amount',
       'dryer_chambers', 'heating_mode', 'dryer_warranty', 'platter_details',
       'dryer_name', 'dryer_included', 'dryer_price',
       'dryer_ship_mode', 'dryer_ship_via', 'dryer_separate_invoice',
       'dryer_invoice_qty', 'dryer_invoice_amount',
       'spares_ship_mode', 'spares_ship_via', 'spares_separate_invoice',
       'spares_invoice_qty', 'spares_invoice_amount',
       'centering_ship_mode', 'centering_ship_via', 'centering_separate_invoice',
       'centering_invoice_qty', 'centering_invoice_amount',
       'air_blade', 'external_centering', 'ink_dust_exhauster', 'chilling_system',
       'other_inclusions',
       'other_commitments', 'printer_warranty', 'head_warranty', 'post_warranty_head_price',
       'consumables_supplier', 'insurance_clause_agreed',
       'ref_no', 'delivery_days', 'trade_term', 'machine_model_no', 'hsn_code',
       'prepared_by', 'approved_by', 'gst_rate', 'machine_value_inr'
     ] then
    perform public.fms_ocpi_write_oc(v_id, p);
  end if;

  return v_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 6. fms_ocpi_submit_quotation — tell THIS deal's approvers.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_submit_quotation(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_no     text;
  v_ver    integer;
  v_missing text;
  d        public.fms_ocpi_deals%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, quotation_no, quotation_version_no
    into v_status, v_owner, v_no, v_ver
    from public.fms_ocpi_deals where id = p_deal for update;

  if v_status is null then raise exception 'Quotation not found'; end if;
  if not public.fms_ocpi_can_act('quotation', p_deal, v_uid) then
    raise exception 'You are not authorized to submit this quotation';
  end if;
  if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
    raise exception 'This quotation belongs to someone else';
  end if;
  if v_status not in ('draft', 'rework') then
    raise exception 'This quotation is already %', replace(v_status, '_', ' ');
  end if;

  -- ⚠ A QUOTATION MUST EXIST BEFORE IT CAN BE APPROVED. Approving a set of form
  --   answers that were never rendered would mean the approver signed off
  --   something nobody has seen as a document.
  if v_no is null or coalesce(v_ver, 0) < 1 then
    raise exception 'Generate the quotation before sending it for approval';
  end if;

  /*
    OCPI-15 · SAY WHAT IS MISSING, IN WORDS.

    Everything below is already enforced by the table CHECK
    fms_ocpi_complete_when_submitted, which fires on this very UPDATE because it
    is written `status = 'draft' OR (…)`. But a CHECK violation names the
    constraint and not the field, so a salesperson who hit it was told
    "new row for relation fms_ocpi_deals violates check constraint" and had
    nothing to act on. This says which answers are missing.

    ⚠ IT MIRRORS THAT CHECK CONJUNCT FOR CONJUNCT AND IS NEVER STRICTER. If this
      list ever asks for more than the constraint does, it refuses deals the
      database would have accepted. It asks for LESS in two places on purpose —
      the print head and the centering inclusion are the form's requirements, not
      the constraint's, and the form refuses those first, by name.

    ⚠ THE NAMES ARE THE FORM'S OWN FIELD LABELS, so a salesperson reading this
      message and a salesperson reading the panel above the form are looking for
      the same words.
  */
  select * into d from public.fms_ocpi_deals where id = p_deal;

  select string_agg(x, ', ') into v_missing from (
    select unnest(array[
      case when nullif(btrim(coalesce(d.customer_name, '')), '') is null
           then 'Customer / party name' end,
      case when nullif(btrim(coalesce(d.salesperson_name, '')), '') is null
           then 'Salesperson' end,
      case when d.machine_id is null    then 'Machine' end,
      case when d.machine_count is null then 'No. of machines' end,

      case when d.incl_ink is null      then 'Deal includes ink' end,
      case when d.incl_ink is true
            and nullif(btrim(coalesce(d.ink_qty_included, '')), '') is null
           then 'Quantity of ink included' end,
      case when d.incl_spares is null   then 'Deal includes spare parts' end,
      case when d.incl_spares is true
            and nullif(btrim(coalesce(d.spare_details, '')), '') is null
           then 'Spare part details and quantity' end,
      case when d.incl_head is null     then 'Deal includes head' end,
      case when d.incl_head is true and d.heads_included is null
           then 'No. of heads included' end,

      case when d.ink_offer_agreed is true and d.ink_offer_qty is null
           then 'Ink — subsidized quantity (litres)' end,
      case when d.ink_offer_agreed is true and d.ink_offer_rate is null
           then 'Ink — subsidized rate (₹ per litre)' end,
      case when d.head_offer_agreed is true and d.head_offer_qty is null
           then 'Head — subsidized quantity (nos.)' end,
      case when d.head_offer_agreed is true and d.head_offer_rate is null
           then 'Head — subsidized rate (₹ per head)' end,

      case when d.transport_terms is null then 'Deal type' end,
      case when d.transport_terms in ('high_seas', 'hss_epcg', 'epcg', 'moowr') and d.high_seas_via is null
           then 'Delivery term' end,
      case when d.transport_terms in ('high_seas', 'hss_epcg', 'epcg', 'moowr') and d.high_seas_cost_by is null
           then 'Shipping cost borne by' end,
      case when d.transport_terms = 'local' and d.local_cost_by is null
           then 'Local delivery cost borne by' end,

      case when d.deal_value_currency is null then 'Currency' end,
      case when d.deal_value_amount is null   then 'Total deal value (excl. GST)' end,
      case when d.fx_rate is null
            and (d.deal_value_currency = 'USD'
              or coalesce(d.transport_terms, '') in ('high_seas', 'hss_epcg', 'epcg', 'moowr'))
           then 'USD to INR rate' end,

      case when nullif(btrim(coalesce(d.payment_terms, '')), '') is null
           then 'Terms of payment' end,
      case when d.delivery_date is null then 'Tentative machine delivery date' end
    ]) as x
  ) t where x is not null;

  if v_missing is not null then
    raise exception 'Still needed before this can be sent for approval: %', v_missing;
  end if;

  update public.fms_ocpi_deals
     set status = 'awaiting_quotation_approval',
         current_step = 'quotation_approval',
         qs_at = now()
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'quotation_submitted',
    v_no || ' sent for approval',
    public.fms_ocpi_quotation_approver_ids(p_deal),   -- CHANGED: by location
    jsonb_build_object('quotation_no', v_no, 'version_no', v_ver));
end $function$;

-- ---------------------------------------------------------------------------
-- 7. fms_ocpi_decide_quotation — the "sole approver" rule reads the deal's list.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_decide_quotation(p_deal uuid, p_decision text, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid(); v_status text; v_owner uuid; v_no text; v_oc text; v_fy text;
  v_next text; v_event text; v_sole boolean; v_owners uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approve','reject','rework') then raise exception 'Unknown decision: %', p_decision; end if;
  select status, raised_by, quotation_no, oc_no into v_status, v_owner, v_no, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Quotation not found'; end if;
  if v_status <> 'awaiting_quotation_approval' then raise exception 'This quotation is not waiting for approval'; end if;
  if not public.fms_ocpi_can_act('quotation_approval', p_deal, v_uid) then raise exception 'You are not an approver for quotations'; end if;
  -- ⚠ coalesce(..., 0) IS THE WHOLE FIX. With no owners named, array_length
  --   returns NULL, v_sole was NULL, and `if v_owner = v_uid and not v_sole`
  --   evaluated to NULL — which plpgsql takes as false, so the guard silently
  --   did not fire.
  v_owners := public.fms_ocpi_quotation_approver_ids(p_deal);   -- CHANGED: by location
  v_sole := (coalesce(array_length(v_owners,1), 0) = 1 and v_owners[1] = v_uid);
  if v_owner = v_uid and not v_sole then raise exception 'You raised this quotation, so somebody else has to approve it'; end if;
  if p_decision in ('reject','rework') and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'Say why, so the salesperson knows what to do next'; end if;
  if p_decision = 'approve' and v_oc is null then
    v_fy := public.fms_ocpi_period_code(public.fms_ocpi_ist_date());
    -- OCPI-36 · the shape lives in fms_ocpi_oc_no now, shared with Generate.
    --   ⚠ STILL REACHED, AND STILL NEEDED. From OCPI-36 the number is normally
    --     minted at Generate, so v_oc is already set and this branch is skipped.
    --     It remains for every deal generated BEFORE that change, which has no
    --     number and would otherwise never get one.
    v_oc := public.fms_ocpi_oc_no(public.fms_ocpi_next_seq('oc:' || v_fy), v_fy);
  end if;
  v_next := case p_decision when 'approve' then 'awaiting_customer_sign' when 'reject' then 'rejected' else 'draft' end;
  v_event := case p_decision when 'approve' then 'quotation_approved' when 'reject' then 'quotation_rejected' else 'quotation_returned' end;
  update public.fms_ocpi_deals set
    status = v_next, current_step = case p_decision when 'approve' then 'customer_signoff' else 'quotation' end,
    oc_no = coalesce(v_oc, oc_no),
    oc_at = case when p_decision='approve' then coalesce(oc_at, now()) else oc_at end,
    oc_by = case when p_decision='approve' then coalesce(oc_by, v_uid) else oc_by end,
    qa_decision = p_decision, qa_note = nullif(btrim(coalesce(p_note,'')),''), qa_at = now(), qa_by = v_uid,
    rejected_at = case when p_decision='reject' then now() else rejected_at end,
    reject_stage = case when p_decision='reject' then 'quotation_approval' else reject_stage end,
    reject_reason = case when p_decision='reject' then nullif(btrim(coalesce(p_note,'')),'') else reject_reason end,
    rework_at = case when p_decision='rework' then now() else rework_at end,
    rework_stage = case when p_decision='rework' then 'quotation_approval' else rework_stage end,
    rework_reason = case when p_decision='rework' then nullif(btrim(coalesce(p_note,'')),'') else rework_reason end,
    rework_count = rework_count + case when p_decision='rework' then 1 else 0 end
  where id = p_deal;
  perform public.fms_ocpi_announce('deal', p_deal, v_event,
    coalesce(v_no,'The quotation') || ' was ' ||
      case p_decision when 'approve' then 'approved — order confirmation ' || coalesce(v_oc,'') || ' issued. Print it and get the customer to sign it.'
                      when 'reject' then 'rejected' else 'sent back for changes' end ||
      case when nullif(btrim(coalesce(p_note,'')),'') is null then '' else ': ' || btrim(p_note) end,
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('decision', p_decision, 'quotation_no', v_no, 'oc_no', v_oc));
end $function$;

-- ---------------------------------------------------------------------------
-- 8. Visibility — a location approver reads deals like a step owner does.
--    fms_ocpi_can_see_deal and the inlined policy must change together.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_can_see_deal(p_uid uuid, p_raised_by uuid, p_status text)
returns boolean
language sql
stable security definer
set search_path = public
as $function$
  select p_uid is not null
     and (p_status is distinct from 'draft' or p_raised_by = p_uid or public.is_admin(p_uid))
     and (
          public.is_admin(p_uid)
       or public.fms_ocpi_is_coordinator(p_uid)
       or p_raised_by = p_uid
       or public.module_is_viewer(p_uid, 'ocpi')
       or exists (select 1 from public.fms_ocpi_step_owners o where p_uid = any(o.employee_ids))
       -- CHANGED
       or exists (select 1 from public.fms_ocpi_approval_locations l where p_uid = any(l.employee_ids))
     );
$function$;

drop policy if exists fms_ocpi_deals_select on public.fms_ocpi_deals;
create policy fms_ocpi_deals_select
  on public.fms_ocpi_deals
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and (fms_ocpi_deals.status is distinct from 'draft'
         or fms_ocpi_deals.raised_by = (select auth.uid())
         or (select public.is_admin((select auth.uid()))))
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_ocpi_is_coordinator((select auth.uid())))
      or fms_ocpi_deals.raised_by = (select auth.uid())
      or (select public.module_is_viewer((select auth.uid()), 'ocpi'))
      or exists (
           select 1 from public.fms_ocpi_step_owners o
            where (select auth.uid()) = any(o.employee_ids)
         )
      or exists (
           select 1 from public.fms_ocpi_approval_locations l
            where (select auth.uid()) = any(l.employee_ids)
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 9. A location approver who also owns Service Check is not service-only.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_is_service_only(p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $function$
  select p_uid is not null
     and exists (select 1 from public.fms_ocpi_step_owners o
                  where o.step_key = 'service_check' and p_uid = any(o.employee_ids))
     and not exists (select 1 from public.fms_ocpi_step_owners o
                      where o.step_key <> 'service_check' and p_uid = any(o.employee_ids))
     -- CHANGED
     and not exists (select 1 from public.fms_ocpi_approval_locations l
                      where p_uid = any(l.employee_ids))
     and not public.is_admin(p_uid)
     and not public.fms_ocpi_is_coordinator(p_uid)
     and not public.module_is_viewer(p_uid, 'ocpi')
     and not exists (select 1 from public.fms_ocpi_deals d where d.raised_by = p_uid);
$function$;

commit;
