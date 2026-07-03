-- Purchase FMS (procurement) — WORKFLOW CORE (Phase 3): Stages 1–4.
--
-- The relational spine for Request → Sourcing → tiered Approval → vendor-wise PO:
--   fms_purchase_requests       — Stage-1 header (buyer company + category)
--   fms_purchase_request_items  — the line-level state machine (Stages 1–4)
--   fms_purchase_quotations     — up to 3 per line; one recommended
--   fms_purchase_pos            — vendor × company PO header
--   fms_purchase_po_items       — approved lines pulled onto a PO (one active PO/line)
--
-- Plus: fms_purchase_is_step_owner(text,uuid) authz helper, fms_purchase_fy_code(date)
-- numbering helper, and the Stage 1–4 transactional RPCs (submit_request,
-- save_sourcing, decide_approval, generate_po, cancel_line). All writes go through
-- these SECURITY DEFINER RPCs which lock rows, re-check authz + state, and keep the
-- line state machine consistent. Tables are select-all (UI scopes per role);
-- direct writes are admin-only.
--
-- Line status machine (fms_purchase_request_items.status):
--   sourcing → approval → approved_pending_po → po
--                approval → on_hold → approval
--                approval → rejected
--   (any non-po, non-terminal) → cancelled
--
-- Purely ADDITIVE. Reuses set_updated_at / is_admin / fms_purchase_next_seq.
-- Reversal: drop the 5 RPCs, the 2 helpers, then tables po_items, pos,
-- quotations, request_items, requests (in that order).

-- ===========================================================================
-- HELPERS
-- ===========================================================================

-- Owner check for a workflow step (reads fms_purchase_step_owners).
create or replace function public.fms_purchase_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_purchase_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;

-- Indian financial-year code for a date, e.g. 2026-06-30 → '2627' (FY 2026-27).
create or replace function public.fms_purchase_fy_code(p_d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_d) >= 4
      then to_char(p_d, 'YY') || to_char((p_d + interval '1 year'), 'YY')
    else to_char((p_d - interval '1 year'), 'YY') || to_char(p_d, 'YY')
  end;
$$;

-- ===========================================================================
-- TABLES
-- ===========================================================================

-- ---- requests (Stage-1 header) -------------------------------------------
create table if not exists public.fms_purchase_requests (
  id            uuid primary key default gen_random_uuid(),
  request_no    text not null unique,
  company_id    uuid not null references public.fms_purchase_companies on delete restrict,
  category_id   uuid not null references public.fms_purchase_categories on delete restrict,
  requester_id  uuid references auth.users on delete set null,
  status        text not null default 'open' check (status in ('open','closed','cancelled')),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists fms_purchase_requests_company_idx on public.fms_purchase_requests (company_id);
create index if not exists fms_purchase_requests_requester_idx on public.fms_purchase_requests (requester_id);

drop trigger if exists trg_fms_purchase_requests_updated on public.fms_purchase_requests;
create trigger trg_fms_purchase_requests_updated before update on public.fms_purchase_requests
  for each row execute function public.set_updated_at();

-- ---- request items (the line state machine) ------------------------------
create table if not exists public.fms_purchase_request_items (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.fms_purchase_requests on delete cascade,
  item_id        uuid not null references public.fms_purchase_items on delete restrict,
  quantity       numeric(14,3) not null check (quantity > 0),
  unit           text not null default '',
  line_remark    text,
  sourcing_reason text,
  final_vendor_id uuid references public.fms_purchase_vendors on delete set null,
  final_qty      numeric(14,3),
  final_rate     numeric(14,2),
  gst_pct        numeric(6,2),
  line_value     numeric(16,2),
  status         text not null default 'sourcing'
                   check (status in ('sourcing','approval','on_hold','approved_pending_po','po','rejected','cancelled')),
  approver_id    uuid references auth.users on delete set null,
  approval_tier  text,
  reject_reason  text,
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fms_purchase_request_items_req_idx on public.fms_purchase_request_items (request_id);
create index if not exists fms_purchase_request_items_status_idx on public.fms_purchase_request_items (status);
create index if not exists fms_purchase_request_items_vendor_idx on public.fms_purchase_request_items (final_vendor_id);

drop trigger if exists trg_fms_purchase_request_items_updated on public.fms_purchase_request_items;
create trigger trg_fms_purchase_request_items_updated before update on public.fms_purchase_request_items
  for each row execute function public.set_updated_at();

-- ---- quotations -----------------------------------------------------------
create table if not exists public.fms_purchase_quotations (
  id              uuid primary key default gen_random_uuid(),
  request_item_id uuid not null references public.fms_purchase_request_items on delete cascade,
  vendor_id       uuid not null references public.fms_purchase_vendors on delete restrict,
  rate            numeric(14,2) not null check (rate >= 0),
  gst_pct         numeric(6,2),
  lead_time_days  integer,
  remark          text,
  is_recommended  boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists fms_purchase_quotations_line_idx on public.fms_purchase_quotations (request_item_id);

-- ---- POs (vendor × company header) ---------------------------------------
create table if not exists public.fms_purchase_pos (
  id            uuid primary key default gen_random_uuid(),
  po_no         text not null unique,
  vendor_id     uuid not null references public.fms_purchase_vendors on delete restrict,
  company_id    uuid not null references public.fms_purchase_companies on delete restrict,
  status        text not null default 'generated' check (status in ('generated','shared','receiving','closed','cancelled')),
  current_stage text not null default 'share_po',
  total_value   numeric(16,2) not null default 0,
  advance_paid  numeric(16,2) not null default 0,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists fms_purchase_pos_vendor_idx on public.fms_purchase_pos (vendor_id);
create index if not exists fms_purchase_pos_company_idx on public.fms_purchase_pos (company_id);

drop trigger if exists trg_fms_purchase_pos_updated on public.fms_purchase_pos;
create trigger trg_fms_purchase_pos_updated before update on public.fms_purchase_pos
  for each row execute function public.set_updated_at();

-- ---- PO items (approved lines pulled onto a PO) --------------------------
create table if not exists public.fms_purchase_po_items (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.fms_purchase_pos on delete cascade,
  request_item_id uuid not null unique references public.fms_purchase_request_items on delete restrict,
  qty             numeric(14,3) not null check (qty > 0),
  rate            numeric(14,2) not null,
  gst_pct         numeric(6,2),
  line_value      numeric(16,2) not null,
  received_qty    numeric(14,3) not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists fms_purchase_po_items_po_idx on public.fms_purchase_po_items (po_id);

-- ===========================================================================
-- RLS — select-all for authenticated; direct writes admin-only (RPCs are definer)
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'fms_purchase_requests','fms_purchase_request_items','fms_purchase_quotations',
    'fms_purchase_pos','fms_purchase_po_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_write_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t||'_write_admin', t);
  end loop;
end $$;

-- ===========================================================================
-- RPCs (Stages 1–4)
-- ===========================================================================

-- Stage 1 — submit a request with one or more item lines. Any authenticated user
-- may raise a request (the entry point); requester_id = caller.
create or replace function public.fms_purchase_submit_request(
  p_company_id  uuid,
  p_category_id uuid,
  p_note        text,
  p_items       jsonb            -- [{item_id, quantity, unit, line_remark}, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_no         text;
  v_seq        integer;
  v_fy         text;
  v_elem       jsonb;
  v_count      integer := 0;
begin
  if p_company_id is null or p_category_id is null then
    raise exception 'Company and category are required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;

  v_fy  := public.fms_purchase_fy_code(current_date);
  v_seq := public.fms_purchase_next_seq('request:' || v_fy);
  v_no  := 'PR-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id, note)
  values (v_no, p_company_id, p_category_id, auth.uid(), nullif(p_note, ''))
  returning id into v_request_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    if coalesce((v_elem->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Each item needs a quantity greater than 0';
    end if;
    insert into public.fms_purchase_request_items (request_id, item_id, quantity, unit, line_remark)
    values (
      v_request_id,
      (v_elem->>'item_id')::uuid,
      (v_elem->>'quantity')::numeric,
      coalesce(v_elem->>'unit', ''),
      nullif(v_elem->>'line_remark', '')
    );
    v_count := v_count + 1;
  end loop;

  return v_request_id;
end $$;
grant execute on function public.fms_purchase_submit_request(uuid, uuid, text, jsonb) to authenticated;

-- Stage 2 — save sourcing for one line: replace its quotations, set the
-- recommendation + final qty/rate/gst, compute the line value, route to approval.
create or replace function public.fms_purchase_save_sourcing(
  p_request_item_id uuid,
  p_quotations      jsonb,       -- [{vendor_id, rate, gst_pct, lead_time_days, remark}, ...]
  p_recommended_vendor_id uuid,
  p_final_qty       numeric,
  p_final_rate      numeric,
  p_gst_pct         numeric default null,
  p_sourcing_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_elem   jsonb;
  v_value  numeric(16,2);
begin
  select status into v_status from public.fms_purchase_request_items
   where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('sourcing','approval','on_hold') then
    raise exception 'This line is not open for sourcing (status %)', v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this line';
  end if;
  if p_recommended_vendor_id is null then raise exception 'A recommended vendor is required'; end if;
  if coalesce(p_final_qty,0) <= 0 or coalesce(p_final_rate,0) < 0 then
    raise exception 'Final qty must be > 0 and rate >= 0';
  end if;

  delete from public.fms_purchase_quotations where request_item_id = p_request_item_id;
  if p_quotations is not null then
    for v_elem in select * from jsonb_array_elements(p_quotations) loop
      insert into public.fms_purchase_quotations
        (request_item_id, vendor_id, rate, gst_pct, lead_time_days, remark, is_recommended)
      values (
        p_request_item_id,
        (v_elem->>'vendor_id')::uuid,
        (v_elem->>'rate')::numeric,
        nullif(v_elem->>'gst_pct','')::numeric,
        nullif(v_elem->>'lead_time_days','')::integer,
        nullif(v_elem->>'remark',''),
        ((v_elem->>'vendor_id')::uuid = p_recommended_vendor_id)
      );
    end loop;
  end if;

  v_value := round(p_final_qty * p_final_rate * (1 + coalesce(p_gst_pct,0)/100.0), 2);

  update public.fms_purchase_request_items
     set final_vendor_id = p_recommended_vendor_id,
         final_qty = p_final_qty,
         final_rate = p_final_rate,
         gst_pct = p_gst_pct,
         line_value = v_value,
         sourcing_reason = nullif(p_sourcing_reason,''),
         status = 'approval',
         reject_reason = null
   where id = p_request_item_id;
end $$;
grant execute on function public.fms_purchase_save_sourcing(uuid, jsonb, uuid, numeric, numeric, numeric, text) to authenticated;

-- Stage 3 — approval decision for one line. Authorized for admin or the approver
-- matched to the line value by the active approval matrix.
create or replace function public.fms_purchase_decide_approval(
  p_request_item_id  uuid,
  p_decision         text,       -- approve | override | reject | hold | resume
  p_override_vendor_id uuid default null,
  p_reason           text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_value    numeric(16,2);
  v_approver uuid;
  v_tier     text;
  v_qrate    numeric(14,2);
  v_qgst     numeric(6,2);
begin
  select status, line_value into v_status, v_value
    from public.fms_purchase_request_items where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('approval','on_hold') then
    raise exception 'This line is not awaiting approval (status %)', v_status;
  end if;

  -- Matched approver for the line value.
  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid()) or (v_approver is not null and v_approver = auth.uid())) then
    raise exception 'Not authorized to approve this line';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null
     where id = p_request_item_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_purchase_quotations
      where request_item_id = p_request_item_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_purchase_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_request_item_id;
    update public.fms_purchase_request_items
       set final_vendor_id = p_override_vendor_id,
           final_rate = v_qrate,
           gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null
     where id = p_request_item_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason
     where id = p_request_item_id;

  elsif p_decision = 'hold' then
    update public.fms_purchase_request_items set status = 'on_hold' where id = p_request_item_id;

  elsif p_decision = 'resume' then
    update public.fms_purchase_request_items set status = 'approval' where id = p_request_item_id;

  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end $$;
grant execute on function public.fms_purchase_decide_approval(uuid, text, uuid, text) to authenticated;

-- Stage 4 — generate a vendor × company PO from chosen approved lines.
create or replace function public.fms_purchase_generate_po(
  p_vendor_id  uuid,
  p_company_id uuid,
  p_request_item_ids uuid[],
  p_po_no      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, created_by)
  values (v_no, p_vendor_id, p_company_id, auth.uid())
  returning id into v_po_id;

  foreach v_id in array p_request_item_ids loop
    select ri.status, ri.final_vendor_id, ri.final_qty, ri.final_rate, ri.gst_pct, ri.line_value, r.company_id
      into v_lstatus, v_vendor, v_fqty, v_frate, v_fgst, v_lval, v_company
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

    insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value)
    values (v_po_id, v_id, v_fqty, v_frate, v_fgst, v_lval);

    update public.fms_purchase_request_items set status = 'po' where id = v_id;
    v_total := v_total + coalesce(v_lval, 0);
  end loop;

  update public.fms_purchase_pos set total_value = v_total where id = v_po_id;
  return v_po_id;
end $$;
grant execute on function public.fms_purchase_generate_po(uuid, uuid, uuid[], text) to authenticated;

-- Cancel a pool/sourcing/approval line (not yet on a PO).
create or replace function public.fms_purchase_cancel_line(
  p_request_item_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  select status into v_status from public.fms_purchase_request_items where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if not (public.is_admin(auth.uid())
          or public.fms_purchase_is_step_owner('po', auth.uid())
          or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to cancel this line';
  end if;
  if v_status in ('po','cancelled','rejected') then
    raise exception 'This line cannot be cancelled (status %)', v_status;
  end if;
  update public.fms_purchase_request_items
     set status = 'cancelled', cancel_reason = nullif(p_reason,'')
   where id = p_request_item_id;
end $$;
grant execute on function public.fms_purchase_cancel_line(uuid, text) to authenticated;
