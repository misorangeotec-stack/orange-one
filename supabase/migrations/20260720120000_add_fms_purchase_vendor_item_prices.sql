-- ===========================================================================
-- Purchase FMS — VENDOR-ITEM RATE master.
--
-- Sourcing is moving from per-LINE to per-REQUEST: the buyer shortlists up to
-- three vendors, ticks one, and types one rate/GST/lead-days per ITEM. This
-- table is the standing rate card the sourcing grid pre-fills from — a DEFAULT,
-- never a lock: every cell stays editable in the form, and nothing here is
-- consulted again once the line is sourced.
--
-- 'vendor_item_price' is promoted to a first-class master TYPE so it flows
-- through the same Masters CRUD + governance (assigned owner, "request a new
-- rate" → owner approves) as every other purchase master.
--
-- Ported from 20260716130000_add_fms_import_vendor_item_prices.sql with two
-- deliberate differences:
--   • no `currency` — purchase buying is INR-only (import is not);
--   • `lead_time_days` added — the new sourcing grid captures it per item, and
--     the rate card should be able to seed it alongside rate/GST.
--
-- Purely ADDITIVE. Reuses set_updated_at / is_admin / fms_purchase_is_master_manager.
-- Depends on 20260630120000_add_fms_purchase_masters.sql (vendors/items + governance)
-- and 20260713120000_add_fms_purchase_master_request_guard.sql (the pending-dup index).
-- ===========================================================================

-- 1. The rate card -----------------------------------------------------------
create table if not exists public.fms_purchase_vendor_item_prices (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references public.fms_purchase_vendors on delete cascade,
  item_id        uuid not null references public.fms_purchase_items   on delete cascade,
  -- numeric(14,2) deliberately matches fms_purchase_quotations.rate and
  -- fms_purchase_request_items.final_rate. Import uses (16,4); copying that here
  -- would let a master rate silently round on its way into final_rate.
  rate           numeric(14,2) not null check (rate >= 0),
  gst_pct        numeric(6,2),
  lead_time_days integer,
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (vendor_id, item_id)
);

comment on table public.fms_purchase_vendor_item_prices is
  'Standing rate card per (vendor, item) for purchase sourcing. Pre-fills the sourcing grid''s rate/GST/lead days; always editable there. One row per vendor×item.';

create index if not exists fms_purchase_vendor_item_prices_vendor_idx
  on public.fms_purchase_vendor_item_prices (vendor_id);
create index if not exists fms_purchase_vendor_item_prices_item_idx
  on public.fms_purchase_vendor_item_prices (item_id);

drop trigger if exists trg_fms_purchase_vendor_item_prices_updated on public.fms_purchase_vendor_item_prices;
create trigger trg_fms_purchase_vendor_item_prices_updated
  before update on public.fms_purchase_vendor_item_prices
  for each row execute function public.set_updated_at();

-- RLS — read all; write by admin or the 'vendor_item_price' master owner.
alter table public.fms_purchase_vendor_item_prices enable row level security;
drop policy if exists fms_purchase_vendor_item_prices_select on public.fms_purchase_vendor_item_prices;
create policy fms_purchase_vendor_item_prices_select on public.fms_purchase_vendor_item_prices
  for select to authenticated using (true);
drop policy if exists fms_purchase_vendor_item_prices_write on public.fms_purchase_vendor_item_prices;
create policy fms_purchase_vendor_item_prices_write on public.fms_purchase_vendor_item_prices
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_purchase_is_master_manager('vendor_item_price', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_purchase_is_master_manager('vendor_item_price', auth.uid()));

-- 2. Promote 'vendor_item_price' to a valid master type ----------------------
-- Constraint names confirmed against the live DB before writing this.
alter table public.fms_purchase_master_managers
  drop constraint if exists fms_purchase_master_managers_master_type_check;
alter table public.fms_purchase_master_managers
  add constraint fms_purchase_master_managers_master_type_check
  check (master_type in ('company','category','item_group','item','vendor','vendor_item_price'));

alter table public.fms_purchase_master_requests
  drop constraint if exists fms_purchase_master_requests_master_type_check;
alter table public.fms_purchase_master_requests
  add constraint fms_purchase_master_requests_master_type_check
  check (master_type in ('company','category','item_group','item','vendor','vendor_item_price'));

-- Recreate the pending-dup guard so a vendor_item_price request is keyed by its
-- (vendor_id, item_id). It carries no 'name', so the existing name-only key would
-- false-collide EVERY price request into a single slot.
--
-- NOTE: `drop` then a failing `create` would leave the guard silently gone. Live
-- pre-check before writing this: the only pending requests are 2 item_groups with
-- distinct (category_id, name), so the rebuild cannot collide. Re-verify the index
-- exists after applying (see the migration's tail assertion).
drop index if exists public.fms_purchase_master_requests_pending_uniq;
create unique index if not exists fms_purchase_master_requests_pending_uniq
  on public.fms_purchase_master_requests (
    master_type,
    coalesce(proposed_payload->>'category_id',
             proposed_payload->>'item_group_id',
             proposed_payload->>'vendor_id', ''),
    coalesce(proposed_payload->>'item_id',
             lower(coalesce(proposed_payload->>'name', '')))
  )
  where status = 'pending';

-- 3. Resolve RPC — add the vendor_item_price branch --------------------------
-- ⚠ THE SILENT TRAP: fms_purchase_master_requests.proposed_payload is a jsonb
-- blob whose keys come from the frontend's lib/masterFields.ts. This function is
-- the ONLY thing that reads them. A key present in masterFields but missing from
-- the insert below is dropped on approval with NO error — the master row just
-- lands blank. rate / gst_pct / lead_time_days below must stay in lockstep with
-- the 'vendor_item_price' descriptor in lib/masterFields.ts.
--
-- Body carried forward verbatim from the live definition (pg_get_functiondef);
-- the ONLY change is the new elsif branch.
create or replace function public.fms_purchase_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_type      text;
  v_status    text;
  v_payload   jsonb;
  v_new_id    uuid;
begin
  -- Lock the request; capture its type + current status.
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_purchase_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  -- Authorization: admin or the assigned manager of this master type.
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  -- Use the (optionally edited) payload provided by the approver, else the original.
  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'vendor' then
      insert into public.fms_purchase_vendors (name, gstin, contact_name, phone, email, address, created_by)
      values (
        nullif(v_payload->>'name',''), v_payload->>'gstin', v_payload->>'contact_name',
        v_payload->>'phone', v_payload->>'email', v_payload->>'address', auth.uid()
      )
      returning id into v_new_id;
    elsif v_type = 'category' then
      insert into public.fms_purchase_categories (name, created_by)
      values (nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item_group' then
      insert into public.fms_purchase_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item' then
      insert into public.fms_purchase_items (item_group_id, name, unit, created_by)
      values ((v_payload->>'item_group_id')::uuid, nullif(v_payload->>'name',''), coalesce(v_payload->>'unit',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'company' then
      insert into public.fms_purchase_companies (name, location, created_by)
      values (nullif(v_payload->>'name',''), v_payload->>'location', auth.uid())
      returning id into v_new_id;
    elsif v_type = 'vendor_item_price' then
      insert into public.fms_purchase_vendor_item_prices (vendor_id, item_id, rate, gst_pct, lead_time_days, created_by)
      values (
        (v_payload->>'vendor_id')::uuid,
        (v_payload->>'item_id')::uuid,
        coalesce(nullif(v_payload->>'rate','')::numeric, 0),
        nullif(v_payload->>'gst_pct','')::numeric,
        nullif(v_payload->>'lead_time_days','')::integer,
        auth.uid()
      )
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_purchase_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_purchase_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $function$;

grant execute on function public.fms_purchase_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- 4. Assert the dup guard survived the rebuild -------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'fms_purchase_master_requests'
      and indexname  = 'fms_purchase_master_requests_pending_uniq'
  ) then
    raise exception 'fms_purchase_master_requests_pending_uniq is missing — the rebuild failed and pending master requests are now unguarded';
  end if;
end $$;
