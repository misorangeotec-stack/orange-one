-- ===========================================================================
-- ORDER TO DISPATCH FMS — RESHAPE, PART 3 of 4: MASTERS, 18 DOWN TO 5.
--
-- The reshaped flow picks from almost nothing. Delivery address, order source,
-- payment term, godown, gate, invoice series, vehicle, driver, transporter,
-- shortfall reason, packing type and LOT were each read by exactly one field
-- that no longer exists; the mail template belonged to the customer auto-mail,
-- which is retired. What survives is what the flow actually uses:
--
--   company · customer · item · unit · category
--
-- ⚠ ORDERING INSIDE THIS FILE IS LOAD-BEARING. `drop table … cascade` NEVER
--   errors — it silently takes dependent columns with it. The customer's
--   `default_transporter_id` is dropped BEFORE fms_dispatch_transporters, so
--   every collateral drop is one we wrote down rather than one we discovered.
--   (Migration 1 already released the order-side FKs for the same reason.)
-- ===========================================================================

do $$
declare v_o bigint; v_m bigint;
begin
  select count(*) into v_o from public.fms_dispatch_orders;
  if v_o > 0 then
    raise exception 'Order to Dispatch holds % order(s). This migration DROPS master tables and is written for the never-seeded module.', v_o;
  end if;

  -- Zero orders does NOT imply zero masters: someone can load a transporter list
  -- through Masters -> Import without ever raising an order. Count the doomed
  -- tables too. fms_dispatch_mail_templates legitimately carries the one row the
  -- foundations migration seeded, so only anything BEYOND that counts.
  select
      (select count(*) from public.fms_dispatch_ship_to)
    + (select count(*) from public.fms_dispatch_order_sources)
    + (select count(*) from public.fms_dispatch_payment_terms)
    + (select count(*) from public.fms_dispatch_godowns)
    + (select count(*) from public.fms_dispatch_gates)
    + (select count(*) from public.fms_dispatch_invoice_series)
    + (select count(*) from public.fms_dispatch_vehicles)
    + (select count(*) from public.fms_dispatch_drivers)
    + (select count(*) from public.fms_dispatch_transporters)
    + (select count(*) from public.fms_dispatch_shortfall_reasons)
    + (select count(*) from public.fms_dispatch_packing_types)
    + (select count(*) from public.fms_dispatch_lots)
    + (select count(*) from public.fms_dispatch_mail_templates where code is distinct from 'dispatch_plan')
    into v_m;
  if v_m > 0 then
    raise exception 'Order to Dispatch holds % row(s) in the master tables this migration DROPS. Export them first (Masters -> Export) if they are worth keeping.', v_m;
  end if;
end $$;

-- ===========================================================================
-- 1. THE CUSTOMER MASTER
-- ===========================================================================

-- `company_id` was added in migration 1 (fms_dispatch_submit_order reads it).
-- Nothing else on the customer survives the cut: the credit fields backed a
-- credit step that now records one decision, the billing address was never
-- rendered, and the two defaults fed intake fields that are gone.
alter table public.fms_dispatch_customers
  drop column if exists billing_address,
  drop column if exists credit_limit,
  drop column if exists credit_days,
  drop column if exists default_type,
  drop column if exists default_transporter_id;

comment on table public.fms_dispatch_customers is
  'A customer of the dispatch flow. `company_id` is the company↔customer mapping: it decides which of our companies bills this customer, and is required, because the sales order no longer asks.';
comment on column public.fms_dispatch_customers.email is
  'Contact e-mail. Stored for reference only — this module sends no mail to customers.';

-- ===========================================================================
-- 2. THE MASTER GOVERNANCE LISTS
-- ===========================================================================
delete from public.fms_dispatch_master_managers
 where master_type not in ('company','customer','item','unit','category');
delete from public.fms_dispatch_master_requests
 where master_type not in ('company','customer','item','unit','category');

-- Both CHECKs were declared inline, so they carry Postgres's generated names.
alter table public.fms_dispatch_master_managers
  drop constraint if exists fms_dispatch_master_managers_master_type_check;
alter table public.fms_dispatch_master_managers
  add constraint fms_dispatch_master_managers_master_type_check
    check (master_type in ('company','customer','item','unit','category'));

alter table public.fms_dispatch_master_requests
  drop constraint if exists fms_dispatch_master_requests_master_type_check;
alter table public.fms_dispatch_master_requests
  add constraint fms_dispatch_master_requests_master_type_check
    check (master_type in ('company','customer','item','unit','category'));

-- ===========================================================================
-- 3. THE APPROVAL CHAIN — five arms.
--
-- ⚠ WIRE CONTRACT with frontend/src/apps/order-to-dispatch/lib/masterFields.ts:
--   every key read below is a key of `proposed_payload`, produced by that file's
--   field list. A field added there and not here is SILENTLY DROPPED on approve
--   — no error, the row just saves without it.
-- ===========================================================================
create or replace function public.fms_dispatch_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_type text; v_status text; v_payload jsonb; v_new_id uuid; v_name text;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_dispatch_master_requests where id = p_request_id for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);
  v_name    := nullif(trim(v_payload->>'name'), '');

  if p_approve then
    if v_name is null then raise exception 'A name is required to approve a master request'; end if;

    if v_type = 'company' then
      insert into public.fms_dispatch_companies (name, gstin, address, created_by)
      values (v_name, nullif(trim(v_payload->>'gstin'),''), nullif(trim(v_payload->>'address'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer' then
      if nullif(trim(v_payload->>'company_id'),'') is null then
        raise exception 'Pick the company that bills this customer before approving';
      end if;
      insert into public.fms_dispatch_customers
        (name, company_id, code, gstin, contact_name, phone, email, created_by)
      values (v_name,
              (v_payload->>'company_id')::uuid,
              nullif(trim(v_payload->>'code'),''),
              nullif(trim(v_payload->>'gstin'),''),
              nullif(trim(v_payload->>'contact_name'),''),
              nullif(trim(v_payload->>'phone'),''),
              nullif(trim(v_payload->>'email'),''),
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'item' then
      insert into public.fms_dispatch_items (name, code, category_id, unit_id, hsn_code, created_by)
      values (v_name, nullif(trim(v_payload->>'code'),''), nullif(v_payload->>'category_id','')::uuid,
              nullif(v_payload->>'unit_id','')::uuid, nullif(trim(v_payload->>'hsn_code'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'unit' then
      insert into public.fms_dispatch_units (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'category' then
      insert into public.fms_dispatch_categories (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_dispatch_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_dispatch_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
comment on function public.fms_dispatch_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real master row) or reject an Order to Dispatch master request. Admin or the master type''s owner only. Five master types survive the 2026-08 reshape: company, customer, item, unit, category.';
grant execute on function public.fms_dispatch_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ===========================================================================
-- 4. THE CUSTOMER AUTO-MAIL — retired.
--
-- Its only input (a planned dispatch date on the material-status step) is gone,
-- it was switched off by default and was never used. The `email` column on the
-- customer master is kept as a contact detail, but nothing reads it.
-- ⚠ supabase/functions/send-email still carries the matching template branch.
--   It is payload-driven so it cannot break — no row of that kind will ever be
--   enqueued again — but it is dead code and should be deleted with the app.
-- Note: 20260801120300 relaxed email_outbox.to_user_id to NULL for this feature.
--   Deliberately NOT reverted: harmless, and reverting is riskier than keeping.
-- ===========================================================================
drop function if exists public.fms_dispatch_mail_customer(uuid);
drop function if exists public.fms_dispatch_render_mail_template(uuid, uuid);

-- ===========================================================================
-- 5. DROP THE THIRTEEN
-- ===========================================================================
drop table if exists public.fms_dispatch_ship_to           cascade;
drop table if exists public.fms_dispatch_order_sources     cascade;
drop table if exists public.fms_dispatch_payment_terms     cascade;
drop table if exists public.fms_dispatch_godowns           cascade;
drop table if exists public.fms_dispatch_gates             cascade;
drop table if exists public.fms_dispatch_invoice_series    cascade;
drop table if exists public.fms_dispatch_vehicles          cascade;
drop table if exists public.fms_dispatch_drivers           cascade;
drop table if exists public.fms_dispatch_transporters      cascade;
drop table if exists public.fms_dispatch_shortfall_reasons cascade;
drop table if exists public.fms_dispatch_packing_types     cascade;
drop table if exists public.fms_dispatch_lots              cascade;
drop table if exists public.fms_dispatch_mail_templates    cascade;
