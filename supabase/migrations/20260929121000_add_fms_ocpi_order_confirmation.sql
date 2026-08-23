-- ===========================================================================
-- OCPI FMS — the order confirmation (part B).
--
--   fms_ocpi_write_oc(deal, jsonb)     internal — part-B columns ONLY
--   fms_ocpi_save_oc_draft(deal, jsonb) save without submitting
--   fms_ocpi_submit_oc(deal)            mint OTPL/OC/<fy>/<nnnn>, send for approval
--
-- ⚠ A SEPARATE WRITER FROM THE QUOTATION'S, AND THAT IS THE WHOLE POINT.
--   fms_ocpi_write_quotation touches only part-A columns; this touches only
--   part-B. If one writer overwrote the row from a payload, saving the order
--   confirmation would blank every quotation answer the OC form does not
--   render — the machine, the price, the delivery terms — silently, because a
--   form that does not show a field also does not send it. The two halves live
--   on one row precisely so nothing has to be re-entered; separate writers are
--   what keeps that safe.
--
-- ⚠ THE BRANCH RULES ARE ENFORCED HERE TOO. Say the deal includes a head,
--   answer "separate shipment" and "via HSS", then change your mind and say the
--   deal includes no head: without this the row would still carry a shipment
--   route for a head that is not being sold, and it would print on a contract.
--   Every field a branch hides is nulled on write, exactly as part A does.
--
-- ⚠ THE OC NUMBER IS FY-SCOPED AND MINTED ON SUBMIT, NOT ON SAVE.
--   `OTPL/OC/2627/0001`, matching the prefix every PowerPoint deck already
--   prints. A part-B draft that is abandoned burns nothing, for the same reason
--   an abandoned quotation draft burns no QT number.
--
-- ⚠ THE GST FIGURES ARE STORED, NOT DERIVED AT PRINT TIME. The rate can be
--   changed per deal, and a contract must keep the arithmetic it was signed
--   under — recomputing from a rate someone edits later would silently restate
--   a signed total.
--
-- Purely ADDITIVE: three functions.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_submit_oc(uuid);
--   drop function if exists public.fms_ocpi_save_oc_draft(uuid, jsonb);
--   drop function if exists public.fms_ocpi_write_oc(uuid, jsonb);
-- ===========================================================================

begin;

create or replace function public.fms_ocpi_write_oc(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incl_head boolean;
  v_dryer     text;
  v_ship_mode text := nullif(btrim(p->>'head_ship_mode'), '');
begin
  -- Read the PART-A answers this form branches on. They are not in the payload —
  -- the OC form does not own them — so they come from the row.
  select incl_head, dryer_type into v_incl_head, v_dryer
    from public.fms_ocpi_deals where id = p_deal;

  update public.fms_ocpi_deals set
    -- ---- head shipment (only when a head is actually included) ------------
    head_ship_mode        = case when v_incl_head is distinct from true then null else v_ship_mode end,
    -- BRANCH: shipped with the machine ⇒ there is no separate route to state.
    head_ship_via         = case when v_incl_head is distinct from true or v_ship_mode is distinct from 'separate'
                                 then null else nullif(btrim(p->>'head_ship_via'), '') end,
    head_balance_remarks  = case when v_incl_head is distinct from true then null
                                 else nullif(btrim(p->>'head_balance_remarks'), '') end,
    head_separate_invoice = case when v_incl_head is distinct from true then null
                                 else (p->>'head_separate_invoice')::boolean end,

    -- ---- dryer (only when one is being supplied) --------------------------
    dryer_chambers = case when v_dryer is null or v_dryer = 'Not Applicable' then null
                          else nullif(btrim(p->>'dryer_chambers'), '') end,
    heating_mode   = case when v_dryer is null or v_dryer = 'Not Applicable' then null
                          else nullif(btrim(p->>'heating_mode'), '') end,
    dryer_warranty = case when v_dryer is null or v_dryer = 'Not Applicable' then null
                          else nullif(btrim(p->>'dryer_warranty'), '') end,
    platter_details = nullif(btrim(p->>'platter_details'), ''),

    -- ---- options -----------------------------------------------------------
    air_blade           = (p->>'air_blade')::boolean,
    external_centering  = (p->>'external_centering')::boolean,
    ink_dust_exhauster  = (p->>'ink_dust_exhauster')::boolean,
    chilling_system     = (p->>'chilling_system')::boolean,

    -- ---- warranty & commitments -------------------------------------------
    other_commitments       = nullif(btrim(p->>'other_commitments'), ''),
    printer_warranty        = nullif(btrim(p->>'printer_warranty'), ''),
    head_warranty           = nullif(btrim(p->>'head_warranty'), ''),
    post_warranty_head_price = nullif(p->>'post_warranty_head_price', '')::numeric,
    consumables_supplier    = nullif(btrim(p->>'consumables_supplier'), ''),
    insurance_clause_agreed = (p->>'insurance_clause_agreed')::boolean,

    -- ---- order-confirmation only ------------------------------------------
    ref_no            = nullif(btrim(p->>'ref_no'), ''),
    delivery_days     = nullif(btrim(p->>'delivery_days'), ''),
    trade_term        = nullif(btrim(p->>'trade_term'), ''),
    machine_model_no  = nullif(btrim(p->>'machine_model_no'), ''),
    prepared_by       = nullif(btrim(p->>'prepared_by'), ''),
    approved_by       = nullif(btrim(p->>'approved_by'), ''),
    gst_rate          = nullif(p->>'gst_rate', '')::numeric,
    machine_value_inr = nullif(p->>'machine_value_inr', '')::numeric,
    gst_amount_inr    = nullif(p->>'gst_amount_inr', '')::numeric,
    total_inr         = nullif(p->>'total_inr', '')::numeric
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_oc(uuid, jsonb) is
  'Write the part-B (order confirmation) columns, nulling whatever the branch rules hide. Touches NO part-A column — see the migration header.';

-- ---------------------------------------------------------------------------
-- Save the order confirmation without submitting it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_save_oc_draft(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by into v_status, v_owner
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;

  if not public.fms_ocpi_can_act('order_confirmation', p_deal, v_uid)
     and v_owner is distinct from v_uid then
    raise exception 'You are not authorized to fill this order confirmation';
  end if;

  -- Fillable while it is owed, and again if an approver sends it back.
  if v_status not in ('awaiting_order_confirmation', 'rework') then
    raise exception 'This order confirmation cannot be edited while the deal is %',
      replace(v_status, '_', ' ');
  end if;

  perform public.fms_ocpi_write_oc(p_deal, p);
end $$;

comment on function public.fms_ocpi_save_oc_draft(uuid, jsonb) is
  'Save part-B answers in place, without submitting. Mints no number.';
grant execute on function public.fms_ocpi_save_oc_draft(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Mark the order confirmation complete and send it for approval.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_submit_oc(p_deal uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_owner   uuid;
  v_oc      text;
  v_machine uuid;
  v_has_tpl boolean;
  v_name    text;
  v_missing text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, oc_no, machine_id
    into v_status, v_owner, v_oc, v_machine
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;

  if not public.fms_ocpi_can_act('order_confirmation', p_deal, v_uid)
     and v_owner is distinct from v_uid then
    raise exception 'You are not authorized to submit this order confirmation';
  end if;
  if v_status not in ('awaiting_order_confirmation', 'rework') then
    raise exception 'This deal is not at the order-confirmation step';
  end if;

  -- ⚠ A MACHINE WITHOUT A TEMPLATE STOPS HERE, BY NAME. Fifteen of the models
  --   on the old form have no order-confirmation template; a quotation against
  --   one is fine, but there is nothing to print here, and a vague failure would
  --   read as a bug rather than as the missing content it is.
  select has_template, name into v_has_tpl, v_name
    from public.fms_ocpi_machines where id = v_machine;
  if v_machine is null then
    raise exception 'This deal has no machine, so there is nothing to confirm';
  end if;
  if v_has_tpl is not true then
    raise exception 'There is no order-confirmation template for % yet. An admin can build one in Administration → Machines.', v_name;
  end if;

  select string_agg(x, ', ') into v_missing from (
    select unnest(array[
      case when (select machine_value_inr from public.fms_ocpi_deals where id = p_deal) is null
           then 'the machine value in rupees' end,
      case when (select nullif(btrim(coalesce(printer_warranty,'')),'') from public.fms_ocpi_deals where id = p_deal) is null
           then 'the printer warranty period' end,
      case when (select nullif(btrim(coalesce(delivery_days,'')),'') from public.fms_ocpi_deals where id = p_deal) is null
           then 'the delivery days' end,
      case when (select nullif(btrim(coalesce(trade_term,'')),'') from public.fms_ocpi_deals where id = p_deal) is null
           then 'the delivery term' end
    ]) as x
  ) t where x is not null;
  if v_missing is not null then
    raise exception 'Still needed on the order confirmation: %', v_missing;
  end if;

  if v_oc is null then
    v_oc := 'OTPL/OC/' || public.fms_ocpi_fy_code(current_date) || '/' ||
            lpad(public.fms_ocpi_next_seq('oc:' || public.fms_ocpi_fy_code(current_date))::text, 4, '0');
  end if;

  update public.fms_ocpi_deals
     set oc_no        = v_oc,
         status       = 'awaiting_oc_approval',
         current_step = 'oc_approval',
         oc_at        = now(),
         oc_by        = v_uid,
         rework_stage = null,
         rework_reason = null
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'oc_submitted',
    v_oc || ' sent for approval',
    public.fms_ocpi_step_owner_ids('oc_approval'),
    jsonb_build_object('oc_no', v_oc));

  return v_oc;
end $$;

comment on function public.fms_ocpi_submit_oc(uuid) is
  'Mint OTPL/OC/<fy>/<nnnn> and send the order confirmation for approval. Refuses a machine with no template, naming it.';
grant execute on function public.fms_ocpi_submit_oc(uuid) to authenticated;

commit;
