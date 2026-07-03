-- Purchase FMS (procurement) — PER-PI ADVANCE / PAYMENT.
--
-- Advances (and installments) are paid against a specific vendor PI, not the
-- whole PO. A PO can be split into several partial PIs (different value + cover
-- qty), each with its own advance→balance cycle. This replaces the payment
-- cap in fms_purchase_record_payment so that when a p_pi_id is supplied the
-- amount is capped at THAT PI's pending (pi_value − payments tagged to the PI)
-- instead of the whole-PO pending. The PO-level cap is kept as the fallback for
-- payments not tied to a PI (e.g. a final settlement recorded against the PO).
--
-- Additive / replace-only: no schema change (fms_purchase_payments.pi_id has
-- existed since the po-lifecycle migration); this only redefines the function.

create or replace function public.fms_purchase_record_payment(
  p_po_id uuid, p_kind text, p_amount numeric,
  p_pi_id uuid default null, p_paid_on date default null, p_utr text default null
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
          or public.fms_purchase_is_step_owner('advance_payment', auth.uid())
          or public.fms_purchase_is_step_owner('final_payment', auth.uid())) then
    raise exception 'Not authorized to record payments';
  end if;
  if p_kind not in ('advance','installment') then raise exception 'Invalid payment kind'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be greater than 0'; end if;

  if p_pi_id is not null then
    -- Per-PI cap: amount cannot exceed this PI's pending (pi_value − paid-so-far).
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
    -- PO-level cap (payment not tied to a PI).
    select total_value into v_total from public.fms_purchase_pos where id = p_po_id for update;
    select coalesce(sum(amount),0) into v_paid from public.fms_purchase_payments where po_id = p_po_id;
    if v_paid + p_amount > v_total + 0.01 then
      raise exception 'Payment exceeds the pending amount';
    end if;
  end if;

  insert into public.fms_purchase_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, created_by)
  values (p_po_id, p_pi_id, p_kind, p_amount, coalesce(p_paid_on, current_date), nullif(p_utr,''), auth.uid())
  returning id into v_id;

  perform public.fms_purchase_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_purchase_record_payment(uuid, text, numeric, uuid, date, text) to authenticated;
