-- ===========================================================================
-- ORDER TO DISPATCH FMS — THE ORDER + THE WORKFLOW (Phase 2).
--
-- A header + lines shape (like fms_purchase_requests / fms_purchase_request_items),
-- because one customer order genuinely carries several items — but with the
-- case-style discipline of fms_production_requests on the header:
-- ONE AUTHORITATIVE TIMESTAMP COLUMN PER STEP.
--
-- A STRICTLY LINEAR chain of seven steps:
--   sales_order → credit_check → material_status → lot_confirm →
--   sales_bill → gate_out → dispatch_confirm → closed
-- `sales_order` is the origin (raising the order); steps 2–7 each own a queue.
-- Queue membership is STATUS-DRIVEN, so a held / closed / cancelled order leaves
-- every queue.
--
-- WHAT IS *NOT* HERE, ON PURPOSE
--   There is no `awaiting_production` status. When the store keeper finds stock
--   short, the agreed behaviour is RECORD AND CONTINUE: `ms_status` becomes
--   'production_required' on a step that has COMPLETED, and the order moves on to
--   LOT confirmation, where the shortfall is expressed as a per-line final_qty.
--   It is a data value, not a workflow state. Do not add a status for it later.
--
-- Helpers:
--   fms_dispatch_can_act(step, order, uid)  — the authorization gate
--   fms_dispatch_resume_status(order)       — where a held order goes back to
--
-- RPCs (all SECURITY DEFINER; lock the row, validate status, re-check authz,
-- stamp the step's own timestamp + captured data, then advance status/current_step):
--   fms_dispatch_submit_order, fms_dispatch_update_order,
--   fms_dispatch_record_credit_check, _record_material_status, _record_lot_confirm,
--   _record_sales_bill, _record_gate_out, _record_dispatch_confirm,
--   _hold_order, _cancel_order, _peek_order_no
--
-- ⚠ NEVER INFER A STEP'S COMPLETION FROM THE ACTIVITY TRAIL — announce() is
--   best-effort and swallowed. Every step stamps its own column here.
--
-- Purely ADDITIVE. Reverses (in order): drop the RPCs, then resume_status,
-- can_act, then fms_dispatch_order_items, then fms_dispatch_orders.
-- ===========================================================================

create table if not exists public.fms_dispatch_orders (
  id                    uuid primary key default gen_random_uuid(),
  order_no              text not null unique,          -- SO-2627-0001

  -- ---- step 1: sales order intake --------------------------------------
  dispatch_type         text not null check (dispatch_type in ('local','transport')),
  company_id            uuid references public.fms_dispatch_companies on delete restrict,
  customer_id           uuid not null references public.fms_dispatch_customers on delete restrict,
  ship_to_id            uuid references public.fms_dispatch_ship_to on delete restrict,
  order_source_id       uuid references public.fms_dispatch_order_sources on delete restrict,

  -- THREE DATES, three different meanings — do not collapse them.
  --   order_date    : when the customer's order was received. The anchor for the
  --                   credit step's SLA AND for the material-status 12PM cut-off.
  --   promised_date : the dispatch date COMMITTED TO THE CUSTOMER (the sheet's
  --                   "Planned" column). Customer-facing; drives the TAT-breached
  --                   tile. Deliberately NOT the internal step SLA — otherwise one
  --                   late internal step silently rewrites what the customer was told.
  --   tat_days      : the sheet's "TAT for Material Dispatch". Whichever of
  --                   promised_date / tat_days is entered, the client derives the other.
  order_date            date not null default current_date,
  promised_date         date,
  tat_days              numeric(6,2),

  customer_ref          text,                          -- the customer's own PO number
  order_remarks         text,

  raised_by             uuid references auth.users on delete set null,
  requester_name        text not null,

  -- STATUSES ARE NOT STEP KEYS. on_hold / cancelled / closed live here only.
  status                text not null check (status in (
                          'awaiting_credit_check','awaiting_material_status',
                          'awaiting_lot_confirm','awaiting_sales_bill',
                          'awaiting_gate_out','awaiting_dispatch_confirm',
                          'closed','on_hold','cancelled')),
  current_step          text not null,

  submitted_at          timestamptz not null default now(),

  -- ---- step 2: credit_check (cc) --------------------------------------
  cc_actual_date        date,
  cc_status             text check (cc_status is null or cc_status in ('credit_available','payment_required')),
  cc_payment_term_id    uuid references public.fms_dispatch_payment_terms on delete restrict,
  -- Snapshots of the customer master AT THE MOMENT OF THE DECISION, so the
  -- decision stays auditable after the master changes.
  cc_credit_limit       numeric(16,2),
  cc_outstanding_amount numeric(16,2),
  cc_payment_ref        text,
  cc_payment_amount     numeric(16,2),
  cc_remarks            text,
  cc_at                 timestamptz,
  cc_by                 uuid references auth.users on delete set null,

  -- ---- step 3: material_status (ms) -----------------------------------
  ms_actual_date        date,
  ms_status             text check (ms_status is null or ms_status in ('available_for_dispatch','production_required')),
  ms_godown_id          uuid references public.fms_dispatch_godowns on delete restrict,
  ms_planned_dispatch_date date,
  ms_remarks            text,
  -- customer auto-mail bookkeeping (see migration 5)
  ms_mail_template_id   uuid references public.fms_dispatch_mail_templates on delete set null,
  ms_mail_to            text,
  ms_mail_subject       text,
  ms_mail_queued_at     timestamptz,
  ms_mail_outbox_id     uuid,
  ms_mail_skipped_reason text,
  ms_at                 timestamptz,
  ms_by                 uuid references auth.users on delete set null,

  -- ---- step 4: lot_confirm (lc) — lot + final qty are PER LINE ---------
  lc_actual_date        date,
  lc_status             text,
  lc_remarks            text,
  lc_at                 timestamptz,
  lc_by                 uuid references auth.users on delete set null,

  -- ---- step 5: sales_bill (sb) ----------------------------------------
  sb_actual_date        date,
  sb_status             text,
  sb_company_id         uuid references public.fms_dispatch_companies on delete restrict,
  sb_invoice_series_id  uuid references public.fms_dispatch_invoice_series on delete restrict,
  sb_invoice_no         text,                          -- generated by Tally — free text on purpose
  sb_invoice_date       date,
  sb_invoice_value      numeric(16,2),
  sb_attachment_path    text,   -- storage object path in fms-dispatch-docs
  sb_attachment_name    text,   -- original filename for display
  sb_remarks            text,
  sb_at                 timestamptz,
  sb_by                 uuid references auth.users on delete set null,

  -- ---- step 6: gate_out (go) ------------------------------------------
  go_actual_date        date,
  go_status             text,
  go_gate_pass_no       text unique,                   -- GENERATED, never typed
  go_gate_id            uuid references public.fms_dispatch_gates on delete restrict,
  go_godown_id          uuid references public.fms_dispatch_godowns on delete restrict,
  go_vehicle_id         uuid references public.fms_dispatch_vehicles on delete restrict,
  go_driver_id          uuid references public.fms_dispatch_drivers on delete restrict,
  go_out_at             timestamptz,
  go_remarks            text,
  go_at                 timestamptz,
  go_by                 uuid references auth.users on delete set null,

  -- ---- step 7: dispatch_confirm (dc) — closes the order ---------------
  dc_actual_date        date,
  dc_status             text check (dc_status is null or dc_status in ('delivered','partially_delivered','returned')),
  dc_receiver_name      text,                          -- whoever signed at the dock
  dc_received_at        timestamptz,
  dc_driver_id          uuid references public.fms_dispatch_drivers on delete restrict,
  dc_transporter_id     uuid references public.fms_dispatch_transporters on delete restrict,
  dc_lr_no              text,
  dc_lr_date            date,
  dc_freight_amount     numeric(14,2),
  dc_attachment_path    text,
  dc_attachment_name    text,
  dc_remarks            text,
  dc_at                 timestamptz,
  dc_by                 uuid references auth.users on delete set null,
  closed_at             timestamptz,

  -- edit audit (one pair — an order sits at one step at a time)
  edited_at             timestamptz,
  edited_by             uuid references auth.users on delete set null,

  hold_at               timestamptz,
  hold_reason           text,
  cancelled_at          timestamptz,
  cancel_reason         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- The Local/Transport branch, enforced in the DATA and not only in the RPC.
  -- Both CHECKs are vacuous until dc_at is stamped, so they can never block an
  -- in-flight order — they only guarantee a CONFIRMED dispatch carries the
  -- evidence its type requires.
  constraint fms_dispatch_orders_transport_lr_ck
    check (dc_at is null or dispatch_type <> 'transport' or nullif(btrim(dc_lr_no), '') is not null),
  constraint fms_dispatch_orders_local_receiver_ck
    check (dc_at is null or dispatch_type <> 'local' or nullif(btrim(dc_receiver_name), '') is not null)
);

comment on table public.fms_dispatch_orders is
  'One customer sales order. Carries the intake and one authoritative timestamp + captured data per step through a strictly linear seven-step chain to delivery. Read is open to every granted user (the app is per-user granted); writes go through the RPCs.';

create index if not exists fms_dispatch_orders_status_idx   on public.fms_dispatch_orders (status);
create index if not exists fms_dispatch_orders_step_idx     on public.fms_dispatch_orders (current_step);
create index if not exists fms_dispatch_orders_customer_idx on public.fms_dispatch_orders (customer_id);
create index if not exists fms_dispatch_orders_raised_idx   on public.fms_dispatch_orders (raised_by);

drop trigger if exists trg_fms_dispatch_orders_updated on public.fms_dispatch_orders;
create trigger trg_fms_dispatch_orders_updated
  before update on public.fms_dispatch_orders
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- ORDER LINES — the multi-item half. Modelled on fms_purchase_request_items:
-- the ordered quantity is intake; the per-line outcomes are filled in later by
-- the material-status (step 3) and LOT-confirmation (step 4) steps.
-- ===========================================================================
create table if not exists public.fms_dispatch_order_items (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.fms_dispatch_orders on delete cascade,
  line_no                integer not null,
  item_id                uuid not null references public.fms_dispatch_items on delete restrict,
  quantity               numeric(14,3) not null check (quantity > 0),
  unit_id                uuid references public.fms_dispatch_units on delete restrict,
  line_remark            text,

  -- step 3, per line: partial availability lives here, not in a workflow status.
  ms_line_status         text check (ms_line_status is null or ms_line_status in ('available_for_dispatch','production_required')),
  ms_available_qty       numeric(14,3),
  ms_shortfall_reason_id uuid references public.fms_dispatch_shortfall_reasons on delete restrict,

  -- step 4, per line: the sheet's "LOT No. Use for Dispatch" + "Final Dispatch Qty".
  lot_id                 uuid references public.fms_dispatch_lots on delete restrict,
  -- The lot label AT CONFIRMATION TIME. A later rename of the master must never
  -- rewrite what was actually dispatched.
  lot_no_snapshot        text,
  final_qty              numeric(14,3),
  final_unit_id          uuid references public.fms_dispatch_units on delete restrict,
  packing_type_id        uuid references public.fms_dispatch_packing_types on delete restrict,
  packs                  numeric(12,2),
  lc_shortfall_reason_id uuid references public.fms_dispatch_shortfall_reasons on delete restrict,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (order_id, line_no)
);

comment on table public.fms_dispatch_order_items is
  'One item line on a sales order. Ordered qty is intake; ms_* is the step-3 availability check and lot_id / final_qty is the step-4 confirmation. lot_no_snapshot freezes the lot label so history survives a master rename.';

create index if not exists fms_dispatch_order_items_order_idx on public.fms_dispatch_order_items (order_id);
create index if not exists fms_dispatch_order_items_item_idx  on public.fms_dispatch_order_items (item_id);

drop trigger if exists trg_fms_dispatch_order_items_updated on public.fms_dispatch_order_items;
create trigger trg_fms_dispatch_order_items_updated
  before update on public.fms_dispatch_order_items
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- THE gate every workflow RPC calls: admin / coordinator / the step's owner.
--
-- ⚠ dispatch_confirm has ONE EXTRA ARM. The person who actually delivered is the
--   driver named on the gate-out entry. If that driver is mapped to a portal user
--   (fms_dispatch_drivers.user_id) they may confirm their own delivery without
--   being a configured step owner — otherwise the last step of the workflow is
--   unreachable by the only person who can honestly complete it.
create or replace function public.fms_dispatch_can_act(p_step_key text, p_order uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_dispatch_is_coordinator(p_uid)
      or public.fms_dispatch_is_step_owner(p_step_key, p_uid)
      or (
        p_step_key = 'dispatch_confirm'
        and exists (
          select 1
          from public.fms_dispatch_orders o
          join public.fms_dispatch_drivers d
            on d.id = coalesce(o.dc_driver_id, o.go_driver_id)
          where o.id = p_order
            and d.user_id = p_uid
        )
      );
$$;
grant execute on function public.fms_dispatch_can_act(text, uuid, uuid) to authenticated;

-- Where a held order goes back to — derived from its own timestamps (linear chain).
create or replace function public.fms_dispatch_resume_status(p_order uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when o.dc_at is not null then 'closed'
    when o.go_at is not null then 'awaiting_dispatch_confirm'
    when o.sb_at is not null then 'awaiting_gate_out'
    when o.lc_at is not null then 'awaiting_sales_bill'
    when o.ms_at is not null then 'awaiting_lot_confirm'
    when o.cc_at is not null then 'awaiting_material_status'
    else 'awaiting_credit_check'
  end
  from public.fms_dispatch_orders o where o.id = p_order;
$$;
grant execute on function public.fms_dispatch_resume_status(uuid) to authenticated;

-- May this user raise an order? No owners configured on `sales_order` ⇒ every
-- granted user may; owners configured ⇒ only them plus admins/coordinators.
create or replace function public.fms_dispatch_can_raise(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select cardinality(o.employee_ids) = 0 or p_uid = any(o.employee_ids)
       from public.fms_dispatch_step_owners o where o.step_key = 'sales_order'),
    true
  ) or public.fms_dispatch_is_coordinator(p_uid);
$$;
grant execute on function public.fms_dispatch_can_raise(uuid) to authenticated;

-- ===========================================================================
-- RLS — read open to every granted user; every write goes through the RPCs.
-- ===========================================================================
alter table public.fms_dispatch_orders enable row level security;
drop policy if exists fms_dispatch_orders_select on public.fms_dispatch_orders;
create policy fms_dispatch_orders_select on public.fms_dispatch_orders
  for select to authenticated using (true);
drop policy if exists fms_dispatch_orders_write_admin on public.fms_dispatch_orders;
create policy fms_dispatch_orders_write_admin on public.fms_dispatch_orders
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_dispatch_order_items enable row level security;
drop policy if exists fms_dispatch_order_items_select on public.fms_dispatch_order_items;
create policy fms_dispatch_order_items_select on public.fms_dispatch_order_items
  for select to authenticated using (true);
drop policy if exists fms_dispatch_order_items_write_admin on public.fms_dispatch_order_items;
create policy fms_dispatch_order_items_write_admin on public.fms_dispatch_order_items
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- LINE HELPERS — shared by submit / update / the two per-line steps.
-- ===========================================================================

-- Replace an order's whole line set from a jsonb array. Used by submit + update
-- only, i.e. while the order is still at the origin step.
create or replace function public.fms_dispatch_replace_lines(p_order uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l      jsonb;
  v_n    integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'At least one item line is required';
  end if;

  delete from public.fms_dispatch_order_items where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    -- Skip the trailing blank row the shared LineGrid always keeps at the bottom.
    if coalesce(trim(l->>'item_id'), '') = '' then continue; end if;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then
      raise exception 'Every item line needs a quantity greater than zero';
    end if;

    v_n := v_n + 1;
    insert into public.fms_dispatch_order_items (order_id, line_no, item_id, quantity, unit_id, line_remark)
    values (
      p_order, v_n,
      (l->>'item_id')::uuid,
      (l->>'quantity')::numeric,
      nullif(l->>'unit_id','')::uuid,
      nullif(trim(l->>'line_remark'), '')
    );
  end loop;

  if v_n = 0 then raise exception 'At least one item line is required'; end if;
  return v_n;
end $$;
grant execute on function public.fms_dispatch_replace_lines(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — raise a sales order. THE ORIGIN OF THE WORKFLOW.
-- ===========================================================================
drop function if exists public.fms_dispatch_submit_order(jsonb);
create or replace function public.fms_dispatch_submit_order(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_no   text;
  v_seq  integer;
  v_fy   text := public.fms_dispatch_fy_code(current_date);
  v_uid  uuid := auth.uid();
  v_name text := nullif(trim(p->>'requester_name'), '');
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'Not authorized to raise a sales order';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;
  if coalesce(trim(p->>'customer_id'), '') = '' then raise exception 'Customer is required'; end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, customer_id, ship_to_id, order_source_id,
    order_date, promised_date, tat_days, customer_ref, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no, v_type,
    nullif(p->>'company_id','')::uuid,
    (p->>'customer_id')::uuid,
    nullif(p->>'ship_to_id','')::uuid,
    nullif(p->>'order_source_id','')::uuid,
    coalesce(nullif(p->>'order_date','')::date, current_date),
    nullif(p->>'promised_date','')::date,
    nullif(p->>'tat_days','')::numeric,
    nullif(trim(p->>'customer_ref'), ''),
    nullif(trim(p->>'order_remarks'), ''),
    v_uid, v_name,
    'awaiting_credit_check', 'credit_check', now()
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
end $$;
grant execute on function public.fms_dispatch_submit_order(jsonb) to authenticated;

-- Peek the next order number without consuming it (for the New Order screen).
create or replace function public.fms_dispatch_peek_order_no()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'SO-' || public.fms_dispatch_fy_code(current_date) || '-' ||
         lpad((coalesce(
           (select last_value from public.fms_dispatch_counters
             where scope = 'order:' || public.fms_dispatch_fy_code(current_date)), 0) + 1)::text, 4, '0');
$$;
grant execute on function public.fms_dispatch_peek_order_no() to authenticated;

-- ===========================================================================
-- RPC — edit the intake, while the order is still at the origin step.
-- Mirrors production's canEditRequest: raiser / admin / coordinator, and only
-- before the first downstream step has been recorded.
-- ===========================================================================
drop function if exists public.fms_dispatch_update_order(uuid, jsonb);
create or replace function public.fms_dispatch_update_order(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_cc      timestamptz;
  v_raiser  uuid;
  v_no      text;
  v_uid     uuid := auth.uid();
  v_type    text := lower(coalesce(trim(p->>'dispatch_type'), ''));
begin
  select status, cc_at, raised_by, order_no
    into v_status, v_cc, v_raiser, v_no
  from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_credit_check' or v_cc is not null then
    raise exception 'This order can no longer be edited - the credit check has already been recorded';
  end if;
  if not (v_raiser = v_uid or public.fms_dispatch_is_coordinator(v_uid)) then
    raise exception 'Only the person who raised this order (or a coordinator) may edit it';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;

  update public.fms_dispatch_orders set
    dispatch_type   = v_type,
    company_id      = nullif(p->>'company_id','')::uuid,
    customer_id     = coalesce(nullif(p->>'customer_id','')::uuid, customer_id),
    ship_to_id      = nullif(p->>'ship_to_id','')::uuid,
    order_source_id = nullif(p->>'order_source_id','')::uuid,
    order_date      = coalesce(nullif(p->>'order_date','')::date, order_date),
    promised_date   = nullif(p->>'promised_date','')::date,
    tat_days        = nullif(p->>'tat_days','')::numeric,
    customer_ref    = nullif(trim(p->>'customer_ref'), ''),
    order_remarks   = nullif(trim(p->>'order_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  if p ? 'lines' then
    perform public.fms_dispatch_replace_lines(p_order, p->'lines');
  end if;

  perform public.fms_dispatch_announce(
    'order', p_order, 'order_edited',
    'Sales order ' || coalesce(v_no, '') || ' was edited.',
    '{}'::uuid[],
    jsonb_build_object('order_no', v_no)
  );
end $$;
grant execute on function public.fms_dispatch_update_order(uuid, jsonb) to authenticated;

-- ===========================================================================
-- Each record RPC is spelled out (PL/pgSQL has no macro). They all share the
-- shape: lock row · check status · check authz · stamp the step's own *_at/*_by
-- + captured data · advance · announce to the next step's owners.
-- ===========================================================================

-- step 2 → 3 : credit_check
drop function if exists public.fms_dispatch_record_credit_check(uuid, jsonb);
create or replace function public.fms_dispatch_record_credit_check(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_cc text := nullif(trim(p->>'cc_status'), '');
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_credit_check' then raise exception 'This order is not awaiting credit confirmation (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('credit_check', p_order, v_uid) then raise exception 'Not authorized to confirm the credit limit'; end if;
  if v_cc is null or v_cc not in ('credit_available','payment_required') then
    raise exception 'Record the credit outcome: Credit Available or Payment Required';
  end if;

  update public.fms_dispatch_orders set
    cc_actual_date        = coalesce(nullif(p->>'cc_actual_date','')::date, current_date),
    cc_status             = v_cc,
    cc_payment_term_id    = nullif(p->>'cc_payment_term_id','')::uuid,
    cc_credit_limit       = nullif(p->>'cc_credit_limit','')::numeric,
    cc_outstanding_amount = nullif(p->>'cc_outstanding_amount','')::numeric,
    cc_payment_ref        = nullif(trim(p->>'cc_payment_ref'), ''),
    cc_payment_amount     = nullif(p->>'cc_payment_amount','')::numeric,
    cc_remarks            = nullif(trim(p->>'cc_remarks'), ''),
    cc_at = coalesce(cc_at, now()), cc_by = coalesce(cc_by, v_uid),
    status = 'awaiting_material_status', current_step = 'material_status'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'credit_checked',
    'Credit confirmed on ' || coalesce(v_no,'an order') || ' - awaiting the material-status check.',
    public.fms_dispatch_step_owner_ids('material_status'),
    jsonb_build_object('order_no', v_no, 'cc_status', v_cc)
  );
end $$;
grant execute on function public.fms_dispatch_record_credit_check(uuid, jsonb) to authenticated;

-- Apply the per-line half of the material-status check.
create or replace function public.fms_dispatch_apply_ms_lines(p_order uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(l->>'id'), '') = '' then continue; end if;
    update public.fms_dispatch_order_items set
      ms_line_status         = nullif(trim(l->>'ms_line_status'), ''),
      ms_available_qty       = nullif(l->>'ms_available_qty','')::numeric,
      ms_shortfall_reason_id = nullif(l->>'ms_shortfall_reason_id','')::uuid
    where id = (l->>'id')::uuid and order_id = p_order;
  end loop;
end $$;
grant execute on function public.fms_dispatch_apply_ms_lines(uuid, jsonb) to authenticated;

-- step 3 → 4 : material_status
-- 'production_required' does NOT park the order — it is recorded and the order
-- continues (the shortfall reappears as a per-line final_qty at step 4).
drop function if exists public.fms_dispatch_record_material_status(uuid, jsonb);
create or replace function public.fms_dispatch_record_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_ms text := nullif(trim(p->>'ms_status'), '');
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_material_status' then raise exception 'This order is not awaiting the material-status check (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to record the material status'; end if;
  if v_ms is null or v_ms not in ('available_for_dispatch','production_required') then
    raise exception 'Record the material status: Available for Dispatch or Production Required';
  end if;

  update public.fms_dispatch_orders set
    ms_actual_date           = coalesce(nullif(p->>'ms_actual_date','')::date, current_date),
    ms_status                = v_ms,
    ms_godown_id             = nullif(p->>'ms_godown_id','')::uuid,
    ms_planned_dispatch_date = nullif(p->>'ms_planned_dispatch_date','')::date,
    ms_remarks               = nullif(trim(p->>'ms_remarks'), ''),
    ms_at = coalesce(ms_at, now()), ms_by = coalesce(ms_by, v_uid),
    status = 'awaiting_lot_confirm', current_step = 'lot_confirm'
  where id = p_order;

  perform public.fms_dispatch_apply_ms_lines(p_order, p->'lines');

  perform public.fms_dispatch_announce(
    'order', p_order, 'material_checked',
    'Material status recorded on ' || coalesce(v_no,'an order') || ' - awaiting LOT no. and final quantity.',
    public.fms_dispatch_step_owner_ids('lot_confirm'),
    jsonb_build_object('order_no', v_no, 'ms_status', v_ms)
  );
end $$;
grant execute on function public.fms_dispatch_record_material_status(uuid, jsonb) to authenticated;

-- Apply the per-line half of LOT confirmation. Snapshots the lot label so a
-- later master rename cannot rewrite what was dispatched.
create or replace function public.fms_dispatch_apply_lc_lines(p_order uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l jsonb; v_lot uuid; v_label text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(l->>'id'), '') = '' then continue; end if;
    v_lot   := nullif(l->>'lot_id','')::uuid;
    v_label := case when v_lot is null then null
                    else (select name from public.fms_dispatch_lots where id = v_lot) end;
    update public.fms_dispatch_order_items set
      lot_id                 = v_lot,
      lot_no_snapshot        = coalesce(v_label, lot_no_snapshot),
      final_qty              = nullif(l->>'final_qty','')::numeric,
      final_unit_id          = nullif(l->>'final_unit_id','')::uuid,
      packing_type_id        = nullif(l->>'packing_type_id','')::uuid,
      packs                  = nullif(l->>'packs','')::numeric,
      lc_shortfall_reason_id = nullif(l->>'lc_shortfall_reason_id','')::uuid
    where id = (l->>'id')::uuid and order_id = p_order;
  end loop;
end $$;
grant execute on function public.fms_dispatch_apply_lc_lines(uuid, jsonb) to authenticated;

-- step 4 → 5 : lot_confirm
drop function if exists public.fms_dispatch_record_lot_confirm(uuid, jsonb);
create or replace function public.fms_dispatch_record_lot_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_filled integer;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_lot_confirm' then raise exception 'This order is not awaiting LOT confirmation (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('lot_confirm', p_order, v_uid) then raise exception 'Not authorized to confirm LOT and final quantity'; end if;

  perform public.fms_dispatch_apply_lc_lines(p_order, p->'lines');

  -- At least one line must actually be going out, or there is nothing to bill.
  select count(*) into v_filled
    from public.fms_dispatch_order_items
   where order_id = p_order and coalesce(final_qty, 0) > 0;
  if v_filled = 0 then
    raise exception 'Confirm a final dispatch quantity on at least one line before continuing';
  end if;

  update public.fms_dispatch_orders set
    lc_actual_date = coalesce(nullif(p->>'lc_actual_date','')::date, current_date),
    lc_status      = nullif(trim(p->>'lc_status'), ''),
    lc_remarks     = nullif(trim(p->>'lc_remarks'), ''),
    lc_at = coalesce(lc_at, now()), lc_by = coalesce(lc_by, v_uid),
    status = 'awaiting_sales_bill', current_step = 'sales_bill'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'lot_confirmed',
    'LOT and final quantity confirmed on ' || coalesce(v_no,'an order') || ' - the sales bill can be raised.',
    public.fms_dispatch_step_owner_ids('sales_bill'),
    jsonb_build_object('order_no', v_no)
  );
end $$;
grant execute on function public.fms_dispatch_record_lot_confirm(uuid, jsonb) to authenticated;

-- step 5 → 6 : sales_bill
drop function if exists public.fms_dispatch_record_sales_bill(uuid, jsonb);
create or replace function public.fms_dispatch_record_sales_bill(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_bill' then raise exception 'This order is not awaiting the sales bill (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to record the sales bill'; end if;
  if coalesce(trim(p->>'sb_invoice_no'), '') = '' then raise exception 'The sales invoice number is required'; end if;

  update public.fms_dispatch_orders set
    sb_actual_date       = coalesce(nullif(p->>'sb_actual_date','')::date, current_date),
    sb_status            = nullif(trim(p->>'sb_status'), ''),
    sb_company_id        = nullif(p->>'sb_company_id','')::uuid,
    sb_invoice_series_id = nullif(p->>'sb_invoice_series_id','')::uuid,
    sb_invoice_no        = trim(p->>'sb_invoice_no'),
    sb_invoice_date      = nullif(p->>'sb_invoice_date','')::date,
    sb_invoice_value     = nullif(p->>'sb_invoice_value','')::numeric,
    -- ATTACHMENT CONTRACT: the key is ABSENT on an edit that keeps the existing
    -- file, so `p ? 'sb_attachment_path'` — never a blank-string test — decides.
    sb_attachment_path   = case when p ? 'sb_attachment_path'
                                then nullif(p->>'sb_attachment_path','') else sb_attachment_path end,
    sb_attachment_name   = case when p ? 'sb_attachment_name'
                                then nullif(p->>'sb_attachment_name','') else sb_attachment_name end,
    sb_remarks           = nullif(trim(p->>'sb_remarks'), ''),
    sb_at = coalesce(sb_at, now()), sb_by = coalesce(sb_by, v_uid),
    status = 'awaiting_gate_out', current_step = 'gate_out'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'billed',
    'Sales bill raised for ' || coalesce(v_no,'an order') || ' - awaiting the gate-out entry.',
    public.fms_dispatch_step_owner_ids('gate_out'),
    jsonb_build_object('order_no', v_no, 'invoice_no', trim(p->>'sb_invoice_no'))
  );
end $$;
grant execute on function public.fms_dispatch_record_sales_bill(uuid, jsonb) to authenticated;

-- step 6 → 7 : gate_out. The gate pass number is GENERATED here, never typed.
drop function if exists public.fms_dispatch_record_gate_out(uuid, jsonb);
create or replace function public.fms_dispatch_record_gate_out(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_pass text; v_existing text; v_fy text := public.fms_dispatch_fy_code(current_date);
begin
  select status, order_no, go_gate_pass_no into v_status, v_no, v_existing
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_gate_out' then raise exception 'This order is not awaiting the gate-out entry (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to record the gate-out entry'; end if;

  -- Re-running the step (after a hold, say) must not burn a second pass number.
  v_pass := coalesce(v_existing,
    'DGP-' || v_fy || '-' || lpad(public.fms_dispatch_next_seq('gatepass:' || v_fy)::text, 4, '0'));

  update public.fms_dispatch_orders set
    go_actual_date  = coalesce(nullif(p->>'go_actual_date','')::date, current_date),
    go_status       = nullif(trim(p->>'go_status'), ''),
    go_gate_pass_no = v_pass,
    go_gate_id      = nullif(p->>'go_gate_id','')::uuid,
    go_godown_id    = coalesce(nullif(p->>'go_godown_id','')::uuid, ms_godown_id),
    go_vehicle_id   = nullif(p->>'go_vehicle_id','')::uuid,
    go_driver_id    = nullif(p->>'go_driver_id','')::uuid,
    go_out_at       = nullif(p->>'go_out_at','')::timestamptz,
    go_remarks      = nullif(trim(p->>'go_remarks'), ''),
    go_at = coalesce(go_at, now()), go_by = coalesce(go_by, v_uid),
    status = 'awaiting_dispatch_confirm', current_step = 'dispatch_confirm'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'gate_out',
    'Gate-out recorded for ' || coalesce(v_no,'an order') || ' (' || v_pass || ') - awaiting delivery confirmation.',
    public.fms_dispatch_step_owner_ids('dispatch_confirm'),
    jsonb_build_object('order_no', v_no, 'gate_pass_no', v_pass)
  );
end $$;
grant execute on function public.fms_dispatch_record_gate_out(uuid, jsonb) to authenticated;

-- step 7 : dispatch_confirm — CLOSES the order. Type-branched validation.
drop function if exists public.fms_dispatch_record_dispatch_confirm(uuid, jsonb);
create or replace function public.fms_dispatch_record_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_type text; v_raiser uuid; v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
begin
  select status, order_no, dispatch_type, raised_by
    into v_status, v_no, v_type, v_raiser
  from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_dispatch_confirm' then raise exception 'This order is not awaiting delivery confirmation (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('dispatch_confirm', p_order, v_uid) then raise exception 'Not authorized to confirm the dispatch'; end if;
  if v_dc is null or v_dc not in ('delivered','partially_delivered','returned') then
    raise exception 'Record the delivery outcome: Delivered, Partially Delivered or Returned';
  end if;

  -- THE Local/Transport branch. Mirrored by two table CHECKs, but raised here so
  -- the person gets a sentence instead of a constraint name.
  if v_type = 'transport' then
    if coalesce(trim(p->>'dc_lr_no'), '') = '' then
      raise exception 'LR number is required for a Transport dispatch';
    end if;
    if coalesce(trim(p->>'dc_transporter_id'), '') = '' then
      raise exception 'Transporter is required for a Transport dispatch';
    end if;
  else
    if coalesce(trim(p->>'dc_receiver_name'), '') = '' then
      raise exception 'Receiver name is required for a Local dispatch';
    end if;
  end if;

  update public.fms_dispatch_orders set
    dc_actual_date    = coalesce(nullif(p->>'dc_actual_date','')::date, current_date),
    dc_status         = v_dc,
    dc_receiver_name  = nullif(trim(p->>'dc_receiver_name'), ''),
    dc_received_at    = nullif(p->>'dc_received_at','')::timestamptz,
    dc_driver_id      = coalesce(nullif(p->>'dc_driver_id','')::uuid, go_driver_id),
    dc_transporter_id = nullif(p->>'dc_transporter_id','')::uuid,
    dc_lr_no          = nullif(trim(p->>'dc_lr_no'), ''),
    dc_lr_date        = nullif(p->>'dc_lr_date','')::date,
    dc_freight_amount = nullif(p->>'dc_freight_amount','')::numeric,
    dc_attachment_path = case when p ? 'dc_attachment_path'
                              then nullif(p->>'dc_attachment_path','') else dc_attachment_path end,
    dc_attachment_name = case when p ? 'dc_attachment_name'
                              then nullif(p->>'dc_attachment_name','') else dc_attachment_name end,
    dc_remarks        = nullif(trim(p->>'dc_remarks'), ''),
    dc_at = coalesce(dc_at, now()), dc_by = coalesce(dc_by, v_uid),
    status = 'closed', current_step = 'dispatch_confirm', closed_at = coalesce(closed_at, now())
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order,
    case when v_dc = 'returned' then 'dispatch_returned' else 'dispatched' end,
    case when v_dc = 'returned'
         then 'Order ' || coalesce(v_no,'') || ' came back - the consignment was returned.'
         else 'Order ' || coalesce(v_no,'') || ' delivered and closed.' end,
    array_remove(array[v_raiser], null),
    jsonb_build_object('order_no', v_no, 'dc_status', v_dc)
  );
end $$;
grant execute on function public.fms_dispatch_record_dispatch_confirm(uuid, jsonb) to authenticated;

-- ===========================================================================
-- LIFECYCLE — hold / resume / cancel.
-- ===========================================================================
drop function if exists public.fms_dispatch_hold_order(uuid, boolean, text);
create or replace function public.fms_dispatch_hold_order(p_order uuid, p_hold boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid(); v_next text;
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then raise exception 'Only a coordinator or admin can hold or resume an order'; end if;
  if v_status = 'cancelled' then raise exception 'This order was cancelled'; end if;

  if p_hold then
    if v_status = 'on_hold' then return; end if;
    if v_status = 'closed' then raise exception 'This order is already closed'; end if;
    update public.fms_dispatch_orders
       set status = 'on_hold', hold_at = now(), hold_reason = nullif(trim(p_reason), '')
     where id = p_order;
    perform public.fms_dispatch_announce('order', p_order, 'held',
      'Order ' || coalesce(v_no,'') || ' put on hold.', array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'reason', nullif(trim(p_reason), '')));
  else
    if v_status <> 'on_hold' then return; end if;
    v_next := public.fms_dispatch_resume_status(p_order);
    update public.fms_dispatch_orders
       set status = v_next,
           current_step = case v_next
             when 'awaiting_credit_check'     then 'credit_check'
             when 'awaiting_material_status'  then 'material_status'
             when 'awaiting_lot_confirm'      then 'lot_confirm'
             when 'awaiting_sales_bill'       then 'sales_bill'
             when 'awaiting_gate_out'         then 'gate_out'
             when 'awaiting_dispatch_confirm' then 'dispatch_confirm'
             else 'dispatch_confirm' end,
           hold_at = null, hold_reason = null
     where id = p_order;
    perform public.fms_dispatch_announce('order', p_order, 'resumed',
      'Order ' || coalesce(v_no,'') || ' taken off hold.',
      public.fms_dispatch_step_owner_ids(
        case v_next
          when 'awaiting_credit_check'     then 'credit_check'
          when 'awaiting_material_status'  then 'material_status'
          when 'awaiting_lot_confirm'      then 'lot_confirm'
          when 'awaiting_sales_bill'       then 'sales_bill'
          when 'awaiting_gate_out'         then 'gate_out'
          else 'dispatch_confirm' end),
      jsonb_build_object('order_no', v_no));
  end if;
end $$;
grant execute on function public.fms_dispatch_hold_order(uuid, boolean, text) to authenticated;

drop function if exists public.fms_dispatch_cancel_order(uuid, text);
create or replace function public.fms_dispatch_cancel_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then raise exception 'Only a coordinator or admin can cancel an order'; end if;
  if v_status = 'closed' then raise exception 'This order is already closed'; end if;
  if v_status = 'cancelled' then return; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A cancellation reason is required'; end if;

  update public.fms_dispatch_orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'cancelled',
    'Order ' || coalesce(v_no,'') || ' cancelled.', array_remove(array[v_raiser], null),
    jsonb_build_object('order_no', v_no, 'reason', trim(p_reason)));
end $$;
grant execute on function public.fms_dispatch_cancel_order(uuid, text) to authenticated;
