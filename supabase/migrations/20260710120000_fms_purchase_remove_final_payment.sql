-- ===========================================================================
-- Purchase FMS (procurement) — remove the Final Payment step. The flow ends at
-- Tally (System Entry).
--
-- Settling the vendor's balance runs on the vendor's credit terms as an accounts
-- activity; it is not a procurement work-item for the process coordinator to
-- chase in a queue. Its presence also made PO closure depend on money, so a PO
-- that was physically complete and fully invoiced sat open awaiting a payment run.
--
-- Balance payments stay RECORDABLE (the PoDetail "Record Payment" button, the
-- fms_purchase_payments table and this RPC all survive) — they are simply no
-- longer a tracked step.
--
-- Replace-only and additive-safe: no table, column or row of business data is
-- touched. Three function bodies are replaced, one config table is pruned, and
-- every PO is re-derived.
--
-- Deploy ordering: apply this BEFORE the frontend that drops the step, or a PO
-- parked at 'final_payment' hits a stage the UI no longer knows. (lib/queues.ts
-- `slaFor` carries a defensive fallback for exactly that window.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. refresh_po — the stage machine. Only the terminal `case` changes.
--    Body carried forward from 20260708120800 (each migration replaces whole).
-- ---------------------------------------------------------------------------
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

  -- A goods receipt still awaiting its Tally invoice.
  select exists(
    select 1 from public.fms_purchase_grns gr
     where gr.po_id = p_po_id
       and not exists (select 1 from public.fms_purchase_tally_bookings t where t.grn_id = gr.id)
  ) into v_unbooked_grn;

  select exists(select 1 from public.fms_purchase_payments where po_id = p_po_id) into v_has_advance;
  select payment_terms in ('full_advance','partial_advance')
    from public.fms_purchase_pos where id = p_po_id into v_needs_adv;
  select exists(select 1 from public.fms_purchase_pis where po_id = p_po_id) into v_has_pi;
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
           -- Terminal. TWO paths, so the re-derive below cannot REOPEN a PO that
           -- is 'closed' today under the old money-based rule:
           --   • everything received and every receipt invoiced in Tally, or
           --   • everything received and fully paid (the legacy rule, retained).
           -- Closure no longer DEPENDS on payment, which is the point of this
           -- change, but history stays closed.
           when coalesce(v_all_recv,false)
                and ( (coalesce(v_tally,false) and not coalesce(v_unbooked_grn,false))
                      or (v_paid >= v_total and v_total > 0) ) then 'closed'
           -- Goods still owed (partially received, or dispatched and awaiting GRN):
           -- receiving is the dominant work, so the stage stays 'inward'. The PO can
           -- still be in the Tally queue for whatever already arrived.
           when not coalesce(v_all_recv,false) and (coalesce(v_any_recv,false) or coalesce(v_dispatched,false)) then 'inward'
           -- Something received, an invoice still to book.
           when coalesce(v_unbooked_grn,false) then 'tally'
           -- Fully received with no GRN at all (e.g. every line qty = 0): park at
           -- Tally, the last step. Pre-existing shape; it parked at 'final_payment'.
           when coalesce(v_all_recv,false) then 'tally'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_advance,false) then 'follow_up'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_needs_adv,false) then 'advance_payment'
           when current_stage in ('share_po','collect_pi','advance_payment','follow_up') and coalesce(v_has_pi,false) then 'follow_up'
           else current_stage end
   where id = p_po_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. record_payment — drop the final_payment owner from the authz clause.
--    Admin or the advance_payment owner may record any payment.
--    7-arg body carried forward from 20260708120100. Signature is UNCHANGED,
--    so database.types.ts needs no regeneration.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_record_payment(
  p_po_id uuid, p_kind text, p_amount numeric,
  p_pi_id uuid default null, p_paid_on date default null, p_utr text default null,
  p_pi_remarks text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_total numeric(16,2);
  v_paid numeric(16,2);
  v_pi_value numeric(16,2);
  v_pi_paid numeric(16,2);
begin
  if not (public.is_admin(auth.uid())
          or public.fms_purchase_is_step_owner('advance_payment', auth.uid())) then
    raise exception 'Not authorized to record payments';
  end if;
  -- 'installment' stays legal: existing rows carry it, and a balance payment is
  -- still recordable from PoDetail even though no step chases it.
  if p_kind not in ('advance','installment') then raise exception 'Invalid payment kind'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be greater than 0'; end if;

  if p_pi_id is not null then
    -- Legacy per-PI cap (kept for backward compatibility; the UI no longer uses it).
    select pi_value into v_pi_value
      from public.fms_purchase_pis
     where id = p_pi_id and po_id = p_po_id
     for update;
    if v_pi_value is null then raise exception 'PI not found for this PO'; end if;
    select coalesce(sum(amount),0) into v_pi_paid
      from public.fms_purchase_payments where pi_id = p_pi_id;
    if v_pi_paid + p_amount > v_pi_value + 0.01 then
      raise exception 'Payment exceeds the PI pending amount';
    end if;
  else
    -- PO-level cap: amount cannot exceed the whole-PO pending.
    select total_value into v_total from public.fms_purchase_pos where id = p_po_id for update;
    select coalesce(sum(amount),0) into v_paid from public.fms_purchase_payments where po_id = p_po_id;
    if v_paid + p_amount > v_total + 0.01 then
      raise exception 'Payment exceeds the pending amount';
    end if;
  end if;

  insert into public.fms_purchase_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, pi_remarks, created_by)
  values (p_po_id, p_pi_id, p_kind, p_amount, coalesce(p_paid_on, current_date), nullif(p_utr,''), nullif(p_pi_remarks,''), auth.uid())
  returning id into v_id;

  perform public.fms_purchase_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_purchase_record_payment(uuid, text, numeric, uuid, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. can_act_po — the second final_payment authz clause.
--    A user whose ONLY step was Final Payment loses PO-side write access. That
--    is intended: the step no longer exists.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_can_act_po(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin(p_uid)
    or public.fms_purchase_is_step_owner('share_po', p_uid)
    or public.fms_purchase_is_step_owner('advance_payment', p_uid)
    or public.fms_purchase_is_step_owner('follow_up', p_uid)
    or public.fms_purchase_is_step_owner('inward', p_uid)
    or public.fms_purchase_is_step_owner('tally', p_uid);
$$;

-- ---------------------------------------------------------------------------
-- 4. Prune the step-owner rows. Config, not business data — an admin can
--    re-create owner rows from Setup → Step Owners at any time.
--
--    Must run AFTER step 3: otherwise there is a window where can_act_po still
--    reads a step whose owner rows are already gone.
-- ---------------------------------------------------------------------------
delete from public.fms_purchase_step_owners where step_key = 'final_payment';

-- ---------------------------------------------------------------------------
-- 5. Re-derive every PO under the new terminal rule. Every PO parked at
--    'final_payment' is by construction fully received with every GRN booked,
--    so it lands on 'closed'.
-- ---------------------------------------------------------------------------
do $$
declare pid uuid;
begin
  for pid in select id from public.fms_purchase_pos loop
    perform public.fms_purchase_refresh_po(pid);
  end loop;
end $$;
