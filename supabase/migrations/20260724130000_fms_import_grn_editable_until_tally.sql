-- Import FMS — a goods receipt is editable until it is booked in Tally, even if
-- the PO has already "closed".
--
-- Why this was needed: fms_import_refresh_po closes a PO the moment its goods are
-- all received AND it is fully paid — Tally bookkeeping is allowed to lag. But the
-- GRN edit-gate keyed off "PO is open" (current_stage not in closed/cancelled), so
-- the instant that payment-path close fired, the still-unbooked receipt froze. The
-- user could no longer correct a received quantity the next stage (Tally) had not
-- yet captured. "closed" is a DERIVED state here, not a manual terminal decision;
-- only cancellation is truly irreversible.
--
-- Two changes, both CREATE OR REPLACE (no table or data change):
--  1. fms_import_grn_editable: gate on "PO not cancelled" + "not booked in Tally",
--     instead of "PO open" — so a closed-but-unbooked receipt stays editable.
--  2. fms_import_refresh_po: make ONLY 'cancelled' absorbing. A closed PO can now
--     be re-derived, so editing a GRN on a closed PO recomputes received_qty and
--     re-opens the PO to 'inward' if the correction drops it below fully-received.
--     Re-derivation is idempotent for a genuinely-closed PO (it computes 'closed'
--     again), so nothing reopens without an actual change to its facts.

create or replace function public.fms_import_grn_editable(p_grn_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.fms_import_grns g
      join public.fms_import_pos po on po.id = g.po_id
     where g.id = p_grn_id
       and po.current_stage <> 'cancelled'
       and not exists (select 1 from public.fms_import_tally_bookings t where t.grn_id = g.id)
  );
$function$;

create or replace function public.fms_import_refresh_po(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
begin
  -- Only cancellation is absorbing. 'closed' is derived and re-derivable: a GRN
  -- edit on a closed PO must be free to recompute quantities and, if the goods are
  -- no longer fully received, walk the PO back to 'inward'.
  if (select current_stage from public.fms_import_pos where id = p_po_id) = 'cancelled' then
    return;
  end if;

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

  -- A goods receipt still awaiting its Tally invoice.
  select exists(
    select 1 from public.fms_import_grns gr
     where gr.po_id = p_po_id
       and not exists (select 1 from public.fms_import_tally_bookings t where t.grn_id = gr.id)
  ) into v_unbooked_grn;

  select exists(select 1 from public.fms_import_payments where po_id = p_po_id) into v_has_advance;
  select payment_terms in ('full_advance','partial_advance')
    from public.fms_import_pos where id = p_po_id into v_needs_adv;
  select exists(select 1 from public.fms_import_pis where po_id = p_po_id) into v_has_pi;
  select exists(select 1 from public.fms_import_followups where po_id = p_po_id and dispatch_status = 'dispatched')
      or exists(select 1 from public.fms_import_pis where po_id = p_po_id and dispatch_status = 'dispatched')
    into v_dispatched;

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
         current_stage = case
           when coalesce(v_all_recv,false)
                and ( (coalesce(v_tally,false) and not coalesce(v_unbooked_grn,false))
                      or (v_paid >= v_total and v_total > 0) ) then 'closed'
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           when coalesce(v_unbooked_grn,false) then 'tally'
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $function$;
