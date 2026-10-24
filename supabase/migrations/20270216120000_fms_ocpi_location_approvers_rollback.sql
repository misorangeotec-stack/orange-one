-- ===========================================================================
-- ROLLBACK for 20270216120000_fms_ocpi_location_approvers.sql
--
-- Puts every changed function and the deals policy back to the live bodies of
-- 2026-10-24 (approval by the general Approve Quotation list only), then drops
-- the column, the helper, the RPC and the table. Each deal's chosen location is
-- lost.
-- NOT a migration — run by hand only.
-- ===========================================================================
begin;

create or replace function public.fms_ocpi_can_act(
  p_step_key text, p_deal uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select p_uid is not null
     and public.module_can_edit(p_uid, 'ocpi')
     and (
          public.fms_ocpi_is_coordinator(p_uid)
       or public.fms_ocpi_is_step_owner(p_step_key, p_uid)
       or (p_step_key = 'quotation'
           and not exists (
             select 1 from public.fms_ocpi_step_owners o
              where o.step_key = 'quotation' and array_length(o.employee_ids, 1) > 0))
     );
$function$;

comment on function public.fms_ocpi_can_act(text, uuid, uuid) is
  'May this user action this OCPI step? Edit grant + (coordinator or step owner), with the origin step open to any editor while it has no owners. p_deal is accepted for signature parity with the other modules and for future per-deal rules.';

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
    )
  );

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
     and not public.is_admin(p_uid)
     and not public.fms_ocpi_is_coordinator(p_uid)
     and not public.module_is_viewer(p_uid, 'ocpi')
     and not exists (select 1 from public.fms_ocpi_deals d where d.raised_by = p_uid);
$function$;

-- save_draft: the live body of 2026-10-24, verbatim.
CREATE OR REPLACE FUNCTION public.fms_ocpi_save_draft(p jsonb, p_deal uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- submit / decide: swap the location-aware calls back.
do $rb$
declare v_src text;
begin
  select pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure) into v_src;
  v_src := replace(v_src, 'public.fms_ocpi_quotation_approver_ids(p_deal),   -- CHANGED: by location',
                          'public.fms_ocpi_step_owner_ids(''quotation_approval''),');
  execute v_src;

  select pg_get_functiondef('public.fms_ocpi_decide_quotation(uuid,text,text)'::regprocedure) into v_src;
  v_src := replace(v_src, 'public.fms_ocpi_quotation_approver_ids(p_deal);   -- CHANGED: by location',
                          'public.fms_ocpi_step_owner_ids(''quotation_approval'');');
  execute v_src;

  if exists (select 1 from pg_proc
              where proname in ('fms_ocpi_submit_quotation','fms_ocpi_decide_quotation','fms_ocpi_save_draft')
                and (prosrc like '%approval_location%' or prosrc like '%quotation_approver_ids%')) then
    raise exception 'rollback: a function still references the location approvers';
  end if;
end $rb$;

drop function if exists public.fms_ocpi_quotation_approver_ids(uuid);
drop function if exists public.fms_ocpi_set_location_approvers(text, uuid[]);
alter table public.fms_ocpi_deals drop column if exists approval_location;
drop table if exists public.fms_ocpi_approval_locations;

commit;
