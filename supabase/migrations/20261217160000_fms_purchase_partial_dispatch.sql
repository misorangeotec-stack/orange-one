-- ===========================================================================
-- Purchase (Domestic): PARTIAL DISPATCH at the Follow-up step.
--
-- WHY
--   On a bulk order the vendor often ships in lots. Follow-up could only say
--   "dispatched" (everything left, the PO moves to Inward), so a first lot of 60
--   out of 100 either had to be called a full dispatch or not recorded at all.
--   Asked 2026-09-28: a "Partial Dispatch" choice where the follow-up person
--   enters the quantity dispatched in this lot; it comes off the balance, and
--   the PO stays on the Follow-up page until the balance is zero.
--
-- DECIDED WITH THE USER (2026-09-28)
--   * The follow-up person enters the DISPATCHED quantity per item, per lot,
--     with the date / LR / transport, like a full dispatch.
--   * The goods of a lot can be received (GRN) straight away, while the PO is
--     still on Follow-up - but never more than has been dispatched.
--
-- WHAT THIS ADDS
--   1. 'partial' as a follow-up dispatch_status.
--   2. fms_purchase_followup_items - the quantity per PO line in each lot.
--   3. fms_purchase_record_partial_dispatch - records a lot. The lot that
--      clears the last balance is saved as a normal 'dispatched' follow-up, so
--      everything downstream (Inward, due dates, reports) sees a full dispatch.
--   4. A trigger on fms_purchase_grn_items: while a PO is partially dispatched,
--      a line cannot be received beyond what has been dispatched for it. A
--      trigger rather than a new record_grn, so that live function (and its
--      edit twin) stay byte-identical.
--   5. fms_purchase_refresh_po - carried forward VERBATIM from 20260731120000
--      with one rule added: balance still to dispatch -> stage 'follow_up'.
--      The OD-13 P0c staff guard (20261109140000) that live carries is kept,
--      and its grants are restated.
--
-- A PO with no partial lots behaves exactly as before.
--
-- Reversal:
--   drop trigger if exists fms_purchase_grn_items_dispatch_cap on public.fms_purchase_grn_items;
--   drop function if exists public.fms_purchase_grn_items_dispatch_cap();
--   drop function if exists public.fms_purchase_record_partial_dispatch(uuid, date, text, text, text, jsonb);
--   for fms_purchase_refresh_po, take THIS file's body and delete the two partial
--     blocks from it (the v_partial_open declaration, the select that fills it, and
--     the one `when coalesce(v_partial_open,false) then 'follow_up'` branch).
--
--     ⚠ DO NOT re-run the copy in 20260731120000_fms_purchase_qc_inspection.sql.
--       That body PREDATES the OD-13 P0c staff guard (20261109140000) and does not
--       carry it, so replacing live with it would silently remove the authorization
--       check this migration was careful to keep — the exact trap point 5 above
--       describes, arrived at from the other direction. Verified 28-09-2026: that
--       file's body contains no is_staff call.
--
--     Safer still, read the body off live before changing it, since live is the only
--     record of what has been injected into it:
--       select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public' and p.proname = 'fms_purchase_refresh_po';
--
--   then (only once no row uses it) drop table public.fms_purchase_followup_items
--   and put the dispatch_status check back to ('pending','dispatched','delayed').
-- ===========================================================================

-- 1. 'partial' is a dispatch status ------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
     where con.conrelid = 'public.fms_purchase_followups'::regclass
       and con.contype = 'c'
       and att.attname = 'dispatch_status'
  loop
    execute format('alter table public.fms_purchase_followups drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.fms_purchase_followups
  add constraint fms_purchase_followups_dispatch_status_check
  check (dispatch_status in ('pending','dispatched','delayed','partial'));

-- 2. Quantities per lot -------------------------------------------------------
create table if not exists public.fms_purchase_followup_items (
  id           uuid primary key default gen_random_uuid(),
  followup_id  uuid not null references public.fms_purchase_followups on delete cascade,
  po_item_id   uuid not null references public.fms_purchase_po_items on delete cascade,
  qty          numeric(14,3) not null check (qty > 0),
  created_at   timestamptz not null default now(),
  unique (followup_id, po_item_id)
);

comment on table public.fms_purchase_followup_items is
  'Quantity per PO line dispatched in one Follow-up lot (partial dispatch). The sum per po_item_id is what the vendor has dispatched so far. Written only by fms_purchase_record_partial_dispatch.';

create index if not exists fms_purchase_followup_items_po_item_idx
  on public.fms_purchase_followup_items (po_item_id);

alter table public.fms_purchase_followup_items enable row level security;
drop policy if exists fms_purchase_followup_items_select on public.fms_purchase_followup_items;
create policy fms_purchase_followup_items_select on public.fms_purchase_followup_items
  for select to authenticated using (true);
drop policy if exists fms_purchase_followup_items_write on public.fms_purchase_followup_items;
create policy fms_purchase_followup_items_write on public.fms_purchase_followup_items
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 3. Record a lot -------------------------------------------------------------
create or replace function public.fms_purchase_record_partial_dispatch(
  p_po_id                uuid,
  p_actual_dispatch_date date,
  p_lr_no                text,
  p_transport            text,
  p_remarks              text,
  p_items                jsonb   -- [{po_item_id, qty}]
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stage     text;
  v_fu_id     uuid;
  v_elem      jsonb;
  v_item_id   uuid;
  v_qty       numeric;
  v_ordered   numeric;
  v_item_po   uuid;
  v_sent      numeric;
  v_any       boolean := false;
  v_complete  boolean;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('follow_up', auth.uid())) then
    raise exception 'Not authorized to record follow-ups';
  end if;

  select current_stage into v_stage from public.fms_purchase_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;
  if v_stage in ('closed','cancelled') then raise exception 'This PO is % - nothing more can be dispatched', v_stage; end if;
  if p_actual_dispatch_date is null then raise exception 'Enter the date this lot left the vendor'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Enter the quantity dispatched in this lot'; end if;

  insert into public.fms_purchase_followups
    (pi_id, po_id, dispatch_status, actual_dispatch_date, lr_no, transport_details, remarks, created_by)
  values
    (null, p_po_id, 'partial', p_actual_dispatch_date,
     nullif(btrim(coalesce(p_lr_no,'')),''), nullif(btrim(coalesce(p_transport,'')),''),
     nullif(btrim(coalesce(p_remarks,'')),''), auth.uid())
  returning id into v_fu_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_item_id := nullif(v_elem->>'po_item_id','')::uuid;
    v_qty     := coalesce(nullif(v_elem->>'qty','')::numeric, 0);
    if v_qty <= 0 then continue; end if;

    select qty, po_id into v_ordered, v_item_po from public.fms_purchase_po_items where id = v_item_id;
    if v_item_po is distinct from p_po_id then raise exception 'Line does not belong to this PO'; end if;

    select coalesce(sum(qty),0) into v_sent from public.fms_purchase_followup_items where po_item_id = v_item_id;
    if v_sent + v_qty > v_ordered + 0.0005 then
      raise exception 'Only % is left to dispatch on a line - % was entered', v_ordered - v_sent, v_qty;
    end if;

    insert into public.fms_purchase_followup_items (followup_id, po_item_id, qty)
    values (v_fu_id, v_item_id, v_qty);
    v_any := true;
  end loop;

  if not v_any then raise exception 'Enter a dispatched quantity above zero for at least one item'; end if;

  -- The lot that clears every balance IS the full dispatch: say so, so the PO
  -- moves to Inward and everything that reads 'dispatched' keeps working.
  select not exists (
    select 1 from public.fms_purchase_po_items poi
     where poi.po_id = p_po_id
       and poi.qty > coalesce((select sum(fi.qty) from public.fms_purchase_followup_items fi
                                where fi.po_item_id = poi.id), 0) + 0.0005
  ) into v_complete;
  if v_complete then
    update public.fms_purchase_followups set dispatch_status = 'dispatched' where id = v_fu_id;
  end if;

  perform public.fms_purchase_refresh_po(p_po_id);
end $$;

revoke all on function public.fms_purchase_record_partial_dispatch(uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.fms_purchase_record_partial_dispatch(uuid, date, text, text, text, jsonb) to authenticated;

-- 4. A GRN cannot outrun what has been dispatched ------------------------------
create or replace function public.fms_purchase_grn_items_dispatch_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_po    uuid;
  v_sent  numeric;
  v_recv  numeric;
begin
  select po_id into v_po from public.fms_purchase_po_items where id = new.po_item_id;

  -- Only a PO that is partially dispatched is capped. Once a full dispatch is
  -- on record (or none of it was lot-by-lot) this trigger does nothing.
  if not exists (select 1 from public.fms_purchase_followup_items fi
                   join public.fms_purchase_followups f on f.id = fi.followup_id
                  where f.po_id = v_po)
     or exists (select 1 from public.fms_purchase_followups where po_id = v_po and dispatch_status = 'dispatched')
     or exists (select 1 from public.fms_purchase_pis where po_id = v_po and dispatch_status = 'dispatched') then
    return new;
  end if;

  select coalesce(sum(qty),0) into v_sent from public.fms_purchase_followup_items where po_item_id = new.po_item_id;
  select coalesce(sum(received_qty),0) into v_recv from public.fms_purchase_grn_items
   where po_item_id = new.po_item_id and id is distinct from new.id;

  if v_recv + new.received_qty > v_sent + 0.0005 then
    raise exception 'Only % of this item has been dispatched so far, and % is already received - receive at most %',
      v_sent, v_recv, greatest(v_sent - v_recv, 0);
  end if;
  return new;
end $$;

revoke all on function public.fms_purchase_grn_items_dispatch_cap() from public, anon;

drop trigger if exists fms_purchase_grn_items_dispatch_cap on public.fms_purchase_grn_items;
create trigger fms_purchase_grn_items_dispatch_cap
  before insert or update of received_qty, po_item_id on public.fms_purchase_grn_items
  for each row execute function public.fms_purchase_grn_items_dispatch_cap();

-- 5. Stage: balance still to dispatch keeps the PO on Follow-up -----------------
create or replace function public.fms_purchase_refresh_po(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid          numeric(16,2);
  v_total         numeric(16,2);
  v_all_recv      boolean;
  v_any_recv      boolean;
  v_tally         boolean;
  v_has_advance   boolean;
  v_needs_adv     boolean;
  v_has_pi        boolean;
  v_dispatched    boolean;
  v_unbooked_grn  boolean;
  v_qc_pending    boolean;
  v_return_pending boolean;
  v_gate_pending  boolean;
  v_partial_open  boolean;
begin
  -- OD-13 P0c guard (20261109140000), kept: that sweep injected it into the live
  -- body, and a CREATE OR REPLACE from an older copy would silently drop it.
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  -- Cancellation is absorbing. `closed` is derived and stays re-derivable.
  if (select current_stage from public.fms_purchase_pos where id = p_po_id) = 'cancelled' then
    return;
  end if;

  update public.fms_purchase_po_items pi
     set received_qty = coalesce((
       select sum(gi.received_qty) from public.fms_purchase_grn_items gi where gi.po_item_id = pi.id
     ), 0)
   where pi.po_id = p_po_id;

  select coalesce(sum(amount),0) into v_paid from public.fms_purchase_payments where po_id = p_po_id;
  select total_value into v_total from public.fms_purchase_pos where id = p_po_id;
  select bool_and(received_qty >= qty), bool_or(received_qty > 0)
    into v_all_recv, v_any_recv
    from public.fms_purchase_po_items where po_id = p_po_id;
  select exists(select 1 from public.fms_purchase_tally_bookings where po_id = p_po_id) into v_tally;

  -- A goods receipt still awaiting its Tally invoice.
  select exists(
    select 1 from public.fms_purchase_grns gr
     where gr.po_id = p_po_id
       and not exists (select 1 from public.fms_purchase_tally_bookings t where t.grn_id = gr.id)
  ) into v_unbooked_grn;

  -- A Tally-booked receipt that carries QC-required material and has not been
  -- inspected. Receipts stamped `qc_waived_at` predate the QC step entirely.
  select exists(
    select 1 from public.fms_purchase_grns gr
     join public.fms_purchase_tally_bookings t on t.grn_id = gr.id
     where gr.po_id = p_po_id
       and gr.qc_waived_at is null
       and public.fms_purchase_grn_needs_qc(gr.id)
       and not exists (select 1 from public.fms_purchase_qc_inspections q where q.grn_id = gr.id)
  ) into v_qc_pending;

  select exists(
    select 1 from public.fms_purchase_qc_inspections q
     where q.po_id = p_po_id and q.result = 'rejected' and q.return_tally_ref is null
  ) into v_return_pending;

  select exists(
    select 1 from public.fms_purchase_qc_inspections q
     where q.po_id = p_po_id and q.result = 'rejected'
       and q.return_tally_ref is not null and q.gate_register_no is null
  ) into v_gate_pending;

  select exists(select 1 from public.fms_purchase_payments where po_id = p_po_id) into v_has_advance;
  select payment_terms in ('full_advance','partial_advance')
    from public.fms_purchase_pos where id = p_po_id into v_needs_adv;
  select exists(select 1 from public.fms_purchase_pis where po_id = p_po_id) into v_has_pi;
  select exists(select 1 from public.fms_purchase_followups where po_id = p_po_id and dispatch_status = 'dispatched')
      or exists(select 1 from public.fms_purchase_pis where po_id = p_po_id and dispatch_status = 'dispatched')
    into v_dispatched;

  -- PARTIAL DISPATCH (20261217160000). Lots have been dispatched and some
  -- ordered quantity is still owed by the vendor: the PO stays in Follow-up.
  -- A full "dispatched" follow-up (or PI) ends it, as before.
  select not coalesce(v_dispatched,false)
     and exists (select 1 from public.fms_purchase_followup_items fi
                   join public.fms_purchase_followups f on f.id = fi.followup_id
                  where f.po_id = p_po_id)
     and exists (select 1 from public.fms_purchase_po_items poi
                  where poi.po_id = p_po_id
                    and poi.qty > coalesce((select sum(fi.qty) from public.fms_purchase_followup_items fi
                                             where fi.po_item_id = poi.id), 0) + 0.0005)
    into v_partial_open;

  update public.fms_purchase_pis p
     set status = case
       when not exists (select 1 from public.fms_purchase_pi_items x where x.pi_id = p.id) then p.status
       when (select bool_and(poi.received_qty >= pii.qty)
               from public.fms_purchase_pi_items pii
               join public.fms_purchase_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'received'
       when (select bool_or(poi.received_qty > 0)
               from public.fms_purchase_pi_items pii
               join public.fms_purchase_po_items poi on poi.id = pii.po_item_id
              where pii.pi_id = p.id) then 'partially_received'
       else 'open' end
   where p.po_id = p_po_id;

  update public.fms_purchase_pos
     set advance_paid = v_paid,
         current_stage = case
           when coalesce(v_all_recv,false)
                and ( (coalesce(v_tally,false) and not coalesce(v_unbooked_grn,false))
                      or (v_paid >= v_total and v_total > 0) )
                and not coalesce(v_qc_pending,false)
                and not coalesce(v_return_pending,false)
                and not coalesce(v_gate_pending,false) then 'closed'
           -- Balance still to be dispatched: stay on the Follow-up page.
           when coalesce(v_partial_open,false) then 'follow_up'
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           when coalesce(v_unbooked_grn,false) then 'tally'
           when coalesce(v_qc_pending,false) then 'qc_inspection'
           when coalesce(v_return_pending,false) then 'purchase_return'
           when coalesce(v_gate_pending,false) then 'gate_outward'
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- OD-13 P0c grants, restated: signed-in staff and the service role only.
revoke execute on function public.fms_purchase_refresh_po(uuid) from public;
revoke execute on function public.fms_purchase_refresh_po(uuid) from anon;
grant  execute on function public.fms_purchase_refresh_po(uuid) to authenticated, service_role;
