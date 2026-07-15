-- Purchase FMS (import) — SINGLE STATE AXIS: current_stage only.
--
-- The PO used to carry two overlapping state fields: current_stage (the
-- fine-grained workflow pointer) and status (generated/shared/receiving/
-- closed/cancelled). status was a lossy compression of current_stage and only
-- uniquely expressed the two TERMINAL states (closed, cancelled). We now drive
-- everything off current_stage, adding those two as terminal stage values.
--
-- current_stage has no CHECK constraint, so no constraint change is needed.
-- The status column is intentionally KEPT (additive-only rule) but is now
-- DORMANT — nothing in the app reads or displays it. This migration:
--   1. Redefines refresh_po so full closure sets current_stage = 'closed'
--      (was 'final_payment') and no longer maintains status.
--   2. Backfills current_stage for any existing closed/cancelled rows.
-- The share_po / add_pi RPCs are left untouched (they still write status
-- harmlessly; their current_stage advances are already correct).

create or replace function public.fms_import_refresh_po(p_po_id uuid)
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

  -- Early-stage signals (advance / follow-up).
  select exists(select 1 from public.fms_import_payments
                 where po_id = p_po_id and kind = 'advance') into v_has_advance;
  select exists(select 1 from public.fms_import_pis
                 where po_id = p_po_id
                   and payment_terms in ('full_advance','partial_advance')) into v_needs_adv;
  select exists(select 1 from public.fms_import_pis where po_id = p_po_id) into v_has_pi;

  -- PI statuses from coverage vs received (unchanged — PI status is kept).
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

  -- current_stage is now the single source of truth. Full closure lands on the
  -- terminal 'closed' stage (previously this branch set current_stage to
  -- 'final_payment' and status to 'closed').
  update public.fms_import_pos
     set advance_paid = v_paid,
         current_stage = case
           -- Receipt-driven stages take priority.
           when coalesce(v_all_recv,false) and v_paid >= v_total and v_total > 0 then 'closed'
           when coalesce(v_all_recv,false) and v_tally then 'final_payment'
           when coalesce(v_all_recv,false) then 'tally'
           when coalesce(v_any_recv,false) then 'inward'
           -- Derived early stages (open, pre-receipt) — never before share/collect.
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_has_advance then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_needs_adv then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and v_has_pi then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- One-time backfill so existing terminal rows detect as terminal under the new
-- stage-only logic (reads the now-dormant status column one last time).
update public.fms_import_pos set current_stage = 'closed'    where status = 'closed'    and current_stage <> 'closed';
update public.fms_import_pos set current_stage = 'cancelled' where status = 'cancelled' and current_stage <> 'cancelled';
