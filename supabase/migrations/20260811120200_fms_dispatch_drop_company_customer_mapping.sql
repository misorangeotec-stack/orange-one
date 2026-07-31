-- ===========================================================================
-- ORDER TO DISPATCH — THE CUSTOMER IS NO LONGER MAPPED TO A COMPANY.
--
-- A customer was required to name the company that bills it, and
-- fms_dispatch_submit_order refused to raise an order without that mapping. The
-- only mapping the flow needs is customer→item; there is one selling company, so
-- asking every customer to name it was a required field that never varied and a
-- hard stop on raising an order when someone forgot it.
--
-- ⚠ NOTHING IS DROPPED. `company_id` stays on both tables (both already nullable)
--   and the company master stays — this migration only stops REQUIRING and
--   READING it. Orders already raised keep the company they recorded; new ones
--   simply leave it null. Re-introducing the mapping later is then a UI change,
--   not a data recovery.
-- ===========================================================================

begin;

comment on column public.fms_dispatch_customers.company_id is
  'LEGACY. No longer set or read - the customer-company mapping was retired. Kept so orders raised while it existed still resolve.';
comment on column public.fms_dispatch_orders.company_id is
  'LEGACY. Null on every order raised after the mapping was retired.';

-- ---------------------------------------------------------------------------
-- Raising an order no longer resolves a company.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_submit_order(p jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid; v_no text; v_seq integer;
  v_fy text := public.fms_dispatch_fy_code(current_date);
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p->>'requester_name'), '');
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'Not authorized to raise a sales order';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;
  if coalesce(trim(p->>'customer_id'), '') = '' then raise exception 'Customer is required'; end if;
  v_cust := (p->>'customer_id')::uuid;

  -- No company lookup. The order records WHO is buying and WHAT is going out;
  -- which of our entities invoices it is not something this flow decides.

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, customer_id, order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at
  ) values (
    v_no, v_type, v_cust,
    coalesce(nullif(p->>'order_date','')::date, current_date),
    nullif(trim(p->>'order_remarks'), ''),
    v_uid, v_name,
    'awaiting_credit_check', 'credit_check', now(),
    1, now()
  )
  returning id into v_id;

  perform public.fms_dispatch_replace_lines(v_id, p->'lines');

  perform public.fms_dispatch_announce(
    'order', v_id, 'raised',
    'Sales order ' || v_no || ' raised - awaiting credit-limit confirmation.',
    public.fms_dispatch_step_owner_ids('credit_check'),
    jsonb_build_object('order_no', v_no)
  );

  return v_id;
end $function$;

-- ---------------------------------------------------------------------------
-- Approving a new customer no longer demands a company.
-- ---------------------------------------------------------------------------
do $mig$
declare v_def text; v_before text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_resolve_master_request';
  if v_def is null then raise exception 'fms_dispatch_resolve_master_request not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
$old$      if nullif(trim(v_payload->>'company_id'),'') is null then
        raise exception 'Pick the company that bills this customer before approving';
      end if;
      insert into public.fms_dispatch_customers
        (name, company_id, code, gstin, contact_name, phone, email, created_by)
      values (v_name,
              (v_payload->>'company_id')::uuid,
              nullif(trim(v_payload->>'code'),''),$old$,
$new$      insert into public.fms_dispatch_customers
        (name, code, gstin, contact_name, phone, email, created_by)
      values (v_name,
              nullif(trim(v_payload->>'code'),''),$new$);
  if v_def = v_before then raise exception 'resolve_master_request: customer arm marker not found'; end if;

  execute v_def;
end $mig$;

commit;
