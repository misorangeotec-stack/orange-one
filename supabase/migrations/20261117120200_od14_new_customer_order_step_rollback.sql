-- ===========================================================================
-- ROLLBACK OF 20261117120200_od14_new_customer_order_step.sql
--
-- ⚠ ROLL THE FRONTEND BACK FIRST. `DispatchStatus` in the OD-14 build carries
--   `awaiting_order_completion` and its nav, queue and labels all read it. Undeploy,
--   then run this.
--
-- ⚠ THE ORDER OF THE FIRST TWO STEPS IS LOAD-BEARING. Every order still sitting at
--   `awaiting_order_completion` has to be moved BEFORE the CHECK constraint is
--   narrowed, or the ALTER fails validating the very rows it is meant to retire —
--   the same trap the OD-9 masters migration wrote up. They go back to
--   `awaiting_credit_check` / `credit_check`, which is exactly where they were
--   before Phase 3 and where the restored credit-check panel expects them.
--
-- ⚠ WHAT THIS COSTS: any customer order written up under OD-14 keeps its company,
--   site, dispatch type and `intake_completed_at`, so the restored panel simply
--   never appears for it — correct, it IS complete. Nothing is lost. But an order
--   still waiting when this runs goes back to being invisible-as-such: a
--   credit-check row with a blank company and "Not yet decided" for its type.
-- ===========================================================================

begin;

-- 1 · the waiting orders come back to the credit-check queue (BEFORE the CHECK)
update public.fms_dispatch_orders
   set status = 'awaiting_credit_check',
       current_step = 'credit_check'
 where status = 'awaiting_order_completion';

-- 2 · the status goes away again
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_status_check;
alter table public.fms_dispatch_orders add constraint fms_dispatch_orders_status_check
  check (status = any (array[
    'awaiting_credit_check',
    'awaiting_material_status',
    'awaiting_sales_bill',
    'awaiting_gate_out',
    'awaiting_dispatch_confirm',
    'awaiting_sales_return',
    'closed', 'on_hold', 'cancelled']));

-- 3 · the edit window forgets the new status
create or replace function public.fms_dispatch_customer_window_open(p_order uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.fms_dispatch_orders o
     where o.id = p_order
       and o.intake_source = 'customer'
       and o.status = 'awaiting_credit_check'
       and o.cc_decided_at is null
       and not exists (select 1 from public.fms_dispatch_rounds r where r.order_id = o.id)
  );
$fn$;

-- 4 · a placed order goes straight to credit check again
--
-- NOTE: this keeps OD-14 PHASE 2's shape — the customer still picks the company —
-- because Phase 2 is a separate migration with its own rollback. Run that one too
-- if the whole of OD-14 is coming out.
create or replace function public.fms_dispatch_submit_customer_order(p jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_g       public.fms_dispatch_customer_orgs%rowtype;
  v_company uuid := nullif(trim(p->>'company_id'), '')::uuid;
  v_party   uuid;
  v_id      uuid;
  v_no      text;
  v_seq     integer;
  v_fy      text := public.fms_dispatch_fy_code(current_date);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  v_org := public.fms_dispatch_customer_org_of(v_uid);
  if v_org is null then raise exception 'This login is not set up to place orders'; end if;
  if not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'This login is not allowed to place orders';
  end if;

  select * into v_g from public.fms_dispatch_customer_orgs where id = v_org;

  if v_company is null then
    select c.company_id into v_company
      from public.fms_dispatch_customer_org_companies(v_org) c limit 1;
    if v_company is null then
      raise exception 'Your account is not finished being set up. Please call us.';
    end if;
  end if;

  select mp.id into v_party
    from public.mst_parties mp
   where mp.id = any (v_g.party_ids) and mp.company_id = v_company;
  if v_party is null then
    raise exception 'Sorry - we cannot take an order for that company on your account. Please call us.';
  end if;
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'Sorry - we cannot take an order for that company just now. Please call us.';
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, location_id, customer_id,
    customer_location, order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at, intake_source
  ) values (
    v_no, null, v_company, null, v_party,
    v_g.customer_location, current_date, nullif(trim(p->>'order_remarks'), ''),
    v_uid, v_g.display_name,
    'awaiting_credit_check', 'credit_check', now(),
    1, now(), 'customer'
  ) returning id into v_id;

  perform public.fms_dispatch_replace_customer_lines(v_id, p->'lines');

  perform public.fms_dispatch_announce(
    'order', v_id, 'raised',
    'New order ' || v_no || ' from ' || v_g.display_name ||
    ' - fill in the dispatch site and dispatch type, then run the credit check.',
    v_g.notify_user_ids,
    jsonb_build_object('order_no', v_no)
  );

  return v_id;
end
$fn$;

-- 5 · the completion RPC goes
--
-- `fms_dispatch_complete_customer_intake` was never dropped, so the restored
-- credit-check panel has its counterpart waiting for it.
drop function if exists public.fms_dispatch_complete_customer_order(uuid, jsonb);

commit;
