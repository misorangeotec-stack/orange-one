-- ===========================================================================
-- Import Purchase FMS — VENDOR-ITEM PRICE master + a per-vendor default currency.
--
-- Import buying has fixed vendors with a fixed, agreed price per item (in the
-- vendor's foreign currency). This adds the standing catalogue the new-request
-- form reads to auto-fill a line's rate, plus a `default_currency` on the vendor
-- so a request/PO is single-currency. It also promotes 'vendor_item_price' to a
-- first-class master TYPE so it flows through the same Masters CRUD + governance
-- (assigned managers, "request a new price" → owner approves) as every other
-- import master.
--
-- Purely ADDITIVE. Reuses set_updated_at / is_admin / fms_import_is_master_manager.
-- Depends on 20260716120000_add_fms_import_masters.sql (vendors/items + governance).
-- ===========================================================================

-- 1. Per-vendor default currency (import vendors quote in one currency) -------
alter table public.fms_import_vendors
  add column if not exists default_currency text;

-- 2. Vendor-item price catalogue --------------------------------------------
create table if not exists public.fms_import_vendor_item_prices (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.fms_import_vendors on delete cascade,
  item_id     uuid not null references public.fms_import_items   on delete cascade,
  currency    text not null default 'USD',
  rate        numeric(16,4) not null check (rate >= 0),
  gst_pct     numeric(6,2),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vendor_id, item_id)
);

comment on table public.fms_import_vendor_item_prices is
  'Fixed agreed price per (vendor, item) for import buying. Auto-fills the request line rate; editable there. One row per vendor×item.';

create index if not exists fms_import_vendor_item_prices_vendor_idx
  on public.fms_import_vendor_item_prices (vendor_id);
create index if not exists fms_import_vendor_item_prices_item_idx
  on public.fms_import_vendor_item_prices (item_id);

drop trigger if exists trg_fms_import_vendor_item_prices_updated on public.fms_import_vendor_item_prices;
create trigger trg_fms_import_vendor_item_prices_updated
  before update on public.fms_import_vendor_item_prices
  for each row execute function public.set_updated_at();

-- RLS — read all; write by admin or the 'vendor_item_price' master manager.
alter table public.fms_import_vendor_item_prices enable row level security;
drop policy if exists fms_import_vendor_item_prices_select on public.fms_import_vendor_item_prices;
create policy fms_import_vendor_item_prices_select on public.fms_import_vendor_item_prices
  for select to authenticated using (true);
drop policy if exists fms_import_vendor_item_prices_write on public.fms_import_vendor_item_prices;
create policy fms_import_vendor_item_prices_write on public.fms_import_vendor_item_prices
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('vendor_item_price', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('vendor_item_price', auth.uid()));

-- 3. Promote 'vendor_item_price' to a valid master type ----------------------
alter table public.fms_import_master_managers
  drop constraint if exists fms_import_master_managers_master_type_check;
alter table public.fms_import_master_managers
  add constraint fms_import_master_managers_master_type_check
  check (master_type in ('company','category','item_group','item','vendor','vendor_item_price'));

alter table public.fms_import_master_requests
  drop constraint if exists fms_import_master_requests_master_type_check;
alter table public.fms_import_master_requests
  add constraint fms_import_master_requests_master_type_check
  check (master_type in ('company','category','item_group','item','vendor','vendor_item_price'));

-- Recreate the pending-dup guard so a vendor_item_price request is keyed by its
-- (vendor_id, item_id) — it carries no 'name', so the name-only key would false-
-- collide every price request into one slot.
drop index if exists public.fms_import_master_requests_pending_uniq;
create unique index if not exists fms_import_master_requests_pending_uniq
  on public.fms_import_master_requests (
    master_type,
    coalesce(proposed_payload->>'category_id',
             proposed_payload->>'item_group_id',
             proposed_payload->>'vendor_id', ''),
    coalesce(proposed_payload->>'item_id',
             lower(coalesce(proposed_payload->>'name', '')))
  )
  where status = 'pending';

-- 4. Resolve RPC — add the vendor_item_price branch --------------------------
-- (Body carried forward from 20260716120000; only the new elsif is added.)
create or replace function public.fms_import_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_import_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_import_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'vendor' then
      insert into public.fms_import_vendors (name, gstin, contact_name, phone, email, address, default_currency, created_by)
      values (
        nullif(v_payload->>'name',''), v_payload->>'gstin', v_payload->>'contact_name',
        v_payload->>'phone', v_payload->>'email', v_payload->>'address',
        nullif(v_payload->>'default_currency',''), auth.uid()
      )
      returning id into v_new_id;
    elsif v_type = 'category' then
      insert into public.fms_import_categories (name, created_by)
      values (nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item_group' then
      insert into public.fms_import_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item' then
      insert into public.fms_import_items (item_group_id, name, unit, created_by)
      values ((v_payload->>'item_group_id')::uuid, nullif(v_payload->>'name',''), coalesce(v_payload->>'unit',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'company' then
      insert into public.fms_import_companies (name, location, created_by)
      values (nullif(v_payload->>'name',''), v_payload->>'location', auth.uid())
      returning id into v_new_id;
    elsif v_type = 'vendor_item_price' then
      insert into public.fms_import_vendor_item_prices (vendor_id, item_id, currency, rate, gst_pct, created_by)
      values (
        (v_payload->>'vendor_id')::uuid,
        (v_payload->>'item_id')::uuid,
        coalesce(nullif(v_payload->>'currency',''), 'USD'),
        coalesce((v_payload->>'rate')::numeric, 0),
        nullif(v_payload->>'gst_pct','')::numeric,
        auth.uid()
      )
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_import_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_import_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

grant execute on function public.fms_import_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;
