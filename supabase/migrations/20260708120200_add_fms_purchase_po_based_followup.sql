-- ===========================================================================
-- Purchase FMS (procurement) — follow-up is recorded against the PO, and the
-- advance step is driven by the PO's payment terms (not the PI's).
--
--   • fms_purchase_followups.pi_id becomes nullable (data-safe) and gains an
--     optional pi_remarks note. A PO-level follow-up is one row with pi_id null.
--   • record_followup is re-keyed on p_po_id (required); p_pi_id/p_pi_remarks
--     are optional. It no longer touches a single PI's dispatch snapshot — the
--     followups history table is the source of truth for dispatch state.
--   • refresh_po now reads advance-need from fms_purchase_pos.payment_terms and
--     detects "dispatched" from the followups table (falling back to the legacy
--     PI snapshot so existing data keeps working).
--
-- Additive / replace-only (one NOT NULL relaxation, one new nullable column).
-- ===========================================================================

-- 1. followups: relax pi_id, add pi_remarks ---------------------------------
alter table public.fms_purchase_followups alter column pi_id drop not null;
alter table public.fms_purchase_followups add column if not exists pi_remarks text;
create index if not exists fms_purchase_followups_po_idx on public.fms_purchase_followups (po_id);

-- 2. refresh_po — advance need from PO terms, dispatched from followups ------
create or replace function public.fms_purchase_refresh_po(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid         numeric(16,2);
  v_total        numeric(16,2);
  v_all_recv     boolean;
  v_any_recv     boolean;
  v_tally        boolean;
  v_has_advance  boolean;
  v_needs_adv    boolean;
  v_has_pi       boolean;
  v_dispatched   boolean;
begin
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

  -- Any payment made pre-receipt satisfies the advance step (advance OR installment).
  select exists(select 1 from public.fms_purchase_payments where po_id = p_po_id) into v_has_advance;
  -- Advance need now comes from the PO's payment terms (moved off the PI).
  select payment_terms in ('full_advance','partial_advance')
    from public.fms_purchase_pos where id = p_po_id into v_needs_adv;
  select exists(select 1 from public.fms_purchase_pis where po_id = p_po_id) into v_has_pi;
  -- Goods on the way: a PO-level follow-up (or a legacy PI snapshot) says dispatched.
  select exists(select 1 from public.fms_purchase_followups where po_id = p_po_id and dispatch_status = 'dispatched')
      or exists(select 1 from public.fms_purchase_pis where po_id = p_po_id and dispatch_status = 'dispatched')
    into v_dispatched;

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
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'closed'
           when coalesce(v_all_recv,false) and v_tally then 'final_payment'
           when coalesce(v_all_recv,false) then 'tally'
           when coalesce(v_any_recv,false) then 'inward'
           when coalesce(v_dispatched,false) then 'inward'   -- dispatched, awaiting GRN
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- 3. record_followup — PO-based; optional PI reference/remarks ---------------
drop function if exists public.fms_purchase_record_followup(uuid, text, date, text, text, date);
drop function if exists public.fms_purchase_record_followup(uuid, text, date, text, text, date, text);
create or replace function public.fms_purchase_record_followup(
  p_po_id uuid, p_dispatch_status text,
  p_actual_dispatch_date date default null,
  p_lr_no text default '', p_transport text default '', p_revised_dispatch_date date default null,
  p_remarks text default '', p_pi_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('follow_up', auth.uid())) then
    raise exception 'Not authorized to record follow-ups';
  end if;
  if p_dispatch_status not in ('pending','dispatched','delayed') then raise exception 'Invalid dispatch status'; end if;
  if not exists (select 1 from public.fms_purchase_pos where id = p_po_id) then raise exception 'PO not found'; end if;

  -- Append the PO-level history row (one per follow-up event; pi_id stays null).
  insert into public.fms_purchase_followups
    (pi_id, po_id, dispatch_status, actual_dispatch_date, revised_dispatch_date, lr_no, transport_details, remarks, pi_remarks, created_by)
  values
    (null, p_po_id, p_dispatch_status, p_actual_dispatch_date, p_revised_dispatch_date,
     nullif(p_lr_no,''), nullif(p_transport,''), nullif(p_remarks,''), nullif(p_pi_remarks,''), auth.uid());

  -- Re-derive the PO stage so "dispatched" moves it to Inward right away.
  perform public.fms_purchase_refresh_po(p_po_id);
end $$;
grant execute on function public.fms_purchase_record_followup(uuid, text, date, text, text, date, text, text) to authenticated;

-- 4. Heal every PO under the new advance/dispatch rules ----------------------
do $$
declare pid uuid;
begin
  for pid in select id from public.fms_purchase_pos loop
    perform public.fms_purchase_refresh_po(pid);
  end loop;
end $$;
