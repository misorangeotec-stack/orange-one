-- Purchase FMS (import) — PO LIFECYCLE (Phase 4): Stages 5–10.
--
-- Tables:
--   fms_import_pis            — proforma invoices (one PO → many PIs; carries dispatch/follow-up)
--   fms_import_pi_items       — which PO lines/qty a PI covers
--   fms_import_grns           — goods receipts (one PI → many partial GRNs)
--   fms_import_grn_items      — per-item received qty (rolls into po_items.received_qty)
--   fms_import_tally_bookings — Stage 9 Tally PI no.
--   fms_import_payments       — advance + installments
--
-- RPCs (all SECURITY DEFINER, row-locked, authz by step owner or admin):
--   fms_import_share_po, fms_import_add_pi, fms_import_record_payment,
--   fms_import_record_followup, fms_import_record_grn, fms_import_book_tally
--
-- The PO's current_stage advances as work is recorded; status moves
-- generated → shared → receiving → closed. A PO closes when every PO line is
-- fully received AND pending amount = 0. Purely ADDITIVE.

-- ===========================================================================
-- TABLES
-- ===========================================================================
create table if not exists public.fms_import_pis (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.fms_import_pos on delete cascade,
  vendor_pi_no    text not null,
  payment_terms   text not null default 'on_delivery'
                    check (payment_terms in ('full_advance','partial_advance','credit','on_delivery')),
  pi_value        numeric(16,2) not null default 0,
  dispatch_date   date,
  status          text not null default 'open' check (status in ('open','partially_received','received')),
  dispatch_status text not null default 'pending' check (dispatch_status in ('pending','dispatched','delayed')),
  actual_dispatch_date date,
  lr_no           text,
  transport_details text,
  revised_dispatch_date date,
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists fms_import_pis_po_idx on public.fms_import_pis (po_id);
drop trigger if exists trg_fms_import_pis_updated on public.fms_import_pis;
create trigger trg_fms_import_pis_updated before update on public.fms_import_pis
  for each row execute function public.set_updated_at();

create table if not exists public.fms_import_pi_items (
  id         uuid primary key default gen_random_uuid(),
  pi_id      uuid not null references public.fms_import_pis on delete cascade,
  po_item_id uuid not null references public.fms_import_po_items on delete restrict,
  qty        numeric(14,3) not null check (qty > 0),
  created_at timestamptz not null default now()
);
create index if not exists fms_import_pi_items_pi_idx on public.fms_import_pi_items (pi_id);

create table if not exists public.fms_import_grns (
  id               uuid primary key default gen_random_uuid(),
  po_id            uuid not null references public.fms_import_pos on delete cascade,
  pi_id            uuid references public.fms_import_pis on delete set null,
  gate_register_no text,
  condition        text not null default 'good' check (condition in ('good','damaged','partial_damage')),
  note             text,
  received_by      uuid references auth.users on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists fms_import_grns_po_idx on public.fms_import_grns (po_id);

create table if not exists public.fms_import_grn_items (
  id           uuid primary key default gen_random_uuid(),
  grn_id       uuid not null references public.fms_import_grns on delete cascade,
  po_item_id   uuid not null references public.fms_import_po_items on delete restrict,
  received_qty numeric(14,3) not null check (received_qty > 0),
  condition    text not null default 'good' check (condition in ('good','damaged','partial_damage')),
  created_at   timestamptz not null default now()
);
create index if not exists fms_import_grn_items_grn_idx on public.fms_import_grn_items (grn_id);

create table if not exists public.fms_import_tally_bookings (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references public.fms_import_pos on delete cascade,
  grn_id      uuid references public.fms_import_grns on delete set null,
  tally_pi_no text not null,
  booked_by   uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists fms_import_tally_po_idx on public.fms_import_tally_bookings (po_id);

create table if not exists public.fms_import_payments (
  id         uuid primary key default gen_random_uuid(),
  po_id      uuid not null references public.fms_import_pos on delete cascade,
  pi_id      uuid references public.fms_import_pis on delete set null,
  kind       text not null check (kind in ('advance','installment')),
  amount     numeric(16,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  utr_ref    text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fms_import_payments_po_idx on public.fms_import_payments (po_id);

-- ===========================================================================
-- RLS — select-all; direct writes admin-only (RPCs are definer).
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'fms_import_pis','fms_import_pi_items','fms_import_grns','fms_import_grn_items',
    'fms_import_tally_bookings','fms_import_payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_write_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t||'_write_admin', t);
  end loop;
end $$;

-- ===========================================================================
-- Internal helper — recompute a PO's received roll-up + advance + stage/status.
-- ===========================================================================
create or replace function public.fms_import_refresh_po(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid       numeric(16,2);
  v_total      numeric(16,2);
  v_all_recv   boolean;
  v_any_recv   boolean;
  v_tally      boolean;
begin
  -- received_qty per po_item from GRNs.
  update public.fms_import_po_items pi
     set received_qty = coalesce((
       select sum(gi.received_qty) from public.fms_import_grn_items gi where gi.po_item_id = pi.id
     ), 0)
   where pi.po_id = p_po_id;

  select coalesce(sum(amount),0) into v_paid from public.fms_import_payments where po_id = p_po_id;
  select total_value into v_total from public.fms_import_pos where id = p_po_id;
  select bool_and(received_qty >= qty), bool_or(received_qty > 0)
    into v_all_recv, v_any_recv
    from public.fms_import_po_items where po_id = p_po_id;
  select exists(select 1 from public.fms_import_tally_bookings where po_id = p_po_id) into v_tally;

  -- PI statuses from coverage vs received.
  update public.fms_import_pis p
     set status = case
       when not exists (select 1 from public.fms_import_pi_items x where x.pi_id = p.id) then p.status
       when (select bool_and(poi.received_qty >= pii.qty)
               from public.fms_import_pi_items pii
               join public.fms_import_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'received'
       when (select bool_or(poi.received_qty > 0)
               from public.fms_import_pi_items pii
               join public.fms_import_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'partially_received'
       else 'open' end
   where p.po_id = p_po_id;

  update public.fms_import_pos
     set advance_paid = v_paid,
         status = case
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'closed'
           when coalesce(v_any_recv,false) then 'receiving'
           else status end,
         current_stage = case
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'final_payment'
           when coalesce(v_all_recv,false) and v_tally then 'final_payment'
           when coalesce(v_all_recv,false) then 'tally'
           when coalesce(v_any_recv,false) then 'inward'
           else current_stage end
   where id = p_po_id;
end $$;

-- ===========================================================================
-- RPCs (Stages 5–10)
-- ===========================================================================

-- Authz helper: admin OR owner of any PO-side step (share/advance/follow/inward/tally/final).
create or replace function public.fms_import_can_act_po(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin(p_uid)
    or public.fms_import_is_step_owner('share_po', p_uid)
    or public.fms_import_is_step_owner('advance_payment', p_uid)
    or public.fms_import_is_step_owner('follow_up', p_uid)
    or public.fms_import_is_step_owner('inward', p_uid)
    or public.fms_import_is_step_owner('tally', p_uid)
    or public.fms_import_is_step_owner('final_payment', p_uid);
$$;

-- Stage 5a — mark PO shared.
create or replace function public.fms_import_share_po(p_po_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;
  update public.fms_import_pos
     set status = case when status = 'generated' then 'shared' else status end,
         current_stage = case when current_stage = 'share_po' then 'share_po' else current_stage end
   where id = p_po_id;
end $$;
grant execute on function public.fms_import_share_po(uuid) to authenticated;

-- Stage 5b — add a PI (with covered po-lines/qty).
drop function if exists public.fms_import_add_pi(uuid, text, text, numeric, date, jsonb);
create or replace function public.fms_import_add_pi(
  p_po_id uuid,
  p_vendor_pi_no text,
  p_items jsonb,           -- [{po_item_id, qty}]
  p_payment_terms text default 'on_delivery',
  p_pi_value numeric default 0,
  p_dispatch_date date default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pi_id uuid; v_elem jsonb;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to add PIs';
  end if;
  if nullif(p_vendor_pi_no,'') is null then raise exception 'Vendor PI number is required'; end if;

  insert into public.fms_import_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, created_by)
  values (p_po_id, p_vendor_pi_no, coalesce(nullif(p_payment_terms,''),'on_delivery'), coalesce(p_pi_value,0), p_dispatch_date, auth.uid())
  returning id into v_pi_id;

  if p_items is not null then
    for v_elem in select * from jsonb_array_elements(p_items) loop
      if coalesce((v_elem->>'qty')::numeric,0) > 0 then
        insert into public.fms_import_pi_items (pi_id, po_item_id, qty)
        values (v_pi_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'qty')::numeric);
      end if;
    end loop;
  end if;

  update public.fms_import_pos set status = case when status='generated' then 'shared' else status end where id = p_po_id;
  return v_pi_id;
end $$;
grant execute on function public.fms_import_add_pi(uuid, text, jsonb, text, numeric, date) to authenticated;

-- Stage 6 / 10 — record a payment (advance or installment).
drop function if exists public.fms_import_record_payment(uuid, uuid, text, numeric, date, text);
create or replace function public.fms_import_record_payment(
  p_po_id uuid, p_kind text, p_amount numeric,
  p_pi_id uuid default null, p_paid_on date default null, p_utr text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_total numeric(16,2); v_paid numeric(16,2);
begin
  if not (public.is_admin(auth.uid())
          or public.fms_import_is_step_owner('advance_payment', auth.uid())
          or public.fms_import_is_step_owner('final_payment', auth.uid())) then
    raise exception 'Not authorized to record payments';
  end if;
  if p_kind not in ('advance','installment') then raise exception 'Invalid payment kind'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be greater than 0'; end if;

  select total_value into v_total from public.fms_import_pos where id = p_po_id for update;
  select coalesce(sum(amount),0) into v_paid from public.fms_import_payments where po_id = p_po_id;
  if v_paid + p_amount > v_total + 0.01 then
    raise exception 'Payment exceeds the pending amount';
  end if;

  insert into public.fms_import_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, created_by)
  values (p_po_id, p_pi_id, p_kind, p_amount, coalesce(p_paid_on, current_date), nullif(p_utr,''), auth.uid())
  returning id into v_id;

  perform public.fms_import_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_import_record_payment(uuid, text, numeric, uuid, date, text) to authenticated;

-- Stage 7 — dispatch follow-up on a PI.
drop function if exists public.fms_import_record_followup(uuid, text, date, text, text, date);
create or replace function public.fms_import_record_followup(
  p_pi_id uuid, p_dispatch_status text,
  p_actual_dispatch_date date default null,
  p_lr_no text default '', p_transport text default '', p_revised_dispatch_date date default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('follow_up', auth.uid())) then
    raise exception 'Not authorized to record follow-ups';
  end if;
  if p_dispatch_status not in ('pending','dispatched','delayed') then raise exception 'Invalid dispatch status'; end if;
  update public.fms_import_pis
     set dispatch_status = p_dispatch_status,
         actual_dispatch_date = p_actual_dispatch_date,
         lr_no = nullif(p_lr_no,''),
         transport_details = nullif(p_transport,''),
         revised_dispatch_date = p_revised_dispatch_date
   where id = p_pi_id;
end $$;
grant execute on function public.fms_import_record_followup(uuid, text, date, text, text, date) to authenticated;

-- Stage 8 — record a GRN (partial receipts allowed).
drop function if exists public.fms_import_record_grn(uuid, uuid, text, text, text, jsonb);
create or replace function public.fms_import_record_grn(
  p_po_id uuid,
  p_items jsonb,            -- [{po_item_id, received_qty, condition}]
  p_pi_id uuid default null, p_gate_register_no text default '', p_condition text default 'good', p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_grn_id uuid; v_elem jsonb; v_ordered numeric(14,3); v_recv numeric(14,3); v_poid uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('inward', auth.uid())) then
    raise exception 'Not authorized to record receipts';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Record at least one received item'; end if;

  insert into public.fms_import_grns (po_id, pi_id, gate_register_no, condition, note, received_by)
  values (p_po_id, p_pi_id, nullif(p_gate_register_no,''), coalesce(nullif(p_condition,''),'good'), nullif(p_note,''), auth.uid())
  returning id into v_grn_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    if coalesce((v_elem->>'received_qty')::numeric,0) <= 0 then continue; end if;
    -- guard: cannot receive more than the ordered qty across all GRNs.
    select qty, po_id into v_ordered, v_poid from public.fms_import_po_items where id = (v_elem->>'po_item_id')::uuid;
    if v_poid is distinct from p_po_id then raise exception 'Line does not belong to this PO'; end if;
    select coalesce(sum(received_qty),0) into v_recv from public.fms_import_grn_items where po_item_id = (v_elem->>'po_item_id')::uuid;
    if v_recv + (v_elem->>'received_qty')::numeric > v_ordered + 0.001 then
      raise exception 'Received qty exceeds ordered qty for a line';
    end if;
    insert into public.fms_import_grn_items (grn_id, po_item_id, received_qty, condition)
    values (v_grn_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'received_qty')::numeric, coalesce(nullif(v_elem->>'condition',''),'good'));
  end loop;

  perform public.fms_import_refresh_po(p_po_id);
  return v_grn_id;
end $$;
grant execute on function public.fms_import_record_grn(uuid, jsonb, uuid, text, text, text) to authenticated;

-- Stage 9 — Tally booking.
drop function if exists public.fms_import_book_tally(uuid, uuid, text);
create or replace function public.fms_import_book_tally(
  p_po_id uuid, p_tally_pi_no text, p_grn_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('tally', auth.uid())) then
    raise exception 'Not authorized to book in Tally';
  end if;
  if nullif(p_tally_pi_no,'') is null then raise exception 'Tally PI number is required'; end if;
  insert into public.fms_import_tally_bookings (po_id, grn_id, tally_pi_no, booked_by)
  values (p_po_id, p_grn_id, p_tally_pi_no, auth.uid())
  returning id into v_id;
  perform public.fms_import_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_import_book_tally(uuid, text, uuid) to authenticated;
